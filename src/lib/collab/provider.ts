import "client-only";
import {
  type Message,
  TERMINAL_CLOSE_CODES,
  CLOSE_DELETED,
  decodeMessage,
  encodeAwareness,
  encodeSyncStep1,
  encodeSyncStep2,
  encodeUpdate,
} from "@brahma/protocol";
import {
  type Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import type * as Y from "yjs";
import { applyUpdate } from "yjs";

/**
 * What the top bar shows:
 *   connecting    first connection, before the initial sync completes
 *   saved         connected, synced, every local edit acknowledged
 *   saving        an acknowledgement has been outstanding for over a second
 *   reconnecting  connection lost while online; retrying with backoff
 *   offline       the browser reports no network
 *   deleted       the document was deleted (terminal)
 *   not-found     the document does not exist (terminal)
 */
export type SyncStatus = "connecting" | "saved" | "saving" | "reconnecting" | "offline" | "deleted" | "not-found";

export const SAVING_AFTER_MS = 1_000;
export const BACKOFF_BASE_MS = 500;
export const BACKOFF_MAX_MS = 10_000;

/** The parts of the browser the provider needs; replaced by fakes in tests. */
export interface ProviderEnvironment {
  createSocket(url: string): WebSocket;
  isOnline(): boolean;
  /** Subscribe to online/offline changes. Returns an unsubscribe function. */
  onConnectivityChange(listener: () => void): () => void;
  random(): number;
}

export const browserEnvironment: ProviderEnvironment = {
  createSocket: (url) => new WebSocket(url),
  isOnline: () => navigator.onLine,
  onConnectivityChange: (listener) => {
    window.addEventListener("online", listener);
    window.addEventListener("offline", listener);
    return () => {
      window.removeEventListener("online", listener);
      window.removeEventListener("offline", listener);
    };
  },
  random: Math.random,
};

interface ProviderOptions {
  url: string;
  doc: Y.Doc;
  awareness: Awareness;
  environment?: ProviderEnvironment;
}

type Listener = () => void;

/**
 * WebSocket provider for the Brahma sync protocol.
 *
 * Connection: the client sends Step 1 on open; the server answers with
 * Step 2 and sends its own Step 1, which the client answers with Step 2.
 * That reply carries any edits made while disconnected. After that both
 * sides exchange Updates.
 *
 * Acknowledgement: the server acks with the number of document messages
 * (Step 2 and Update) it has stored from this connection. Comparing that
 * with the number sent tells the client whether its edits are durable.
 *
 * Remote updates are applied with this provider as the transaction origin.
 * Undo managers track only local origins, so Mod+Z never undoes a
 * collaborator's edit.
 */
export class SyncProvider {
  private readonly env: ProviderEnvironment;
  private socket: WebSocket | null = null;
  private status: SyncStatus = "connecting";
  private pending = false;
  private listeners = new Set<Listener>();
  private ackListeners = new Set<Listener>();

  private everSynced = false;
  private synced = false;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private savingTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private terminal: "deleted" | "not-found" | null = null;

  // Acknowledgement bookkeeping, per connection.
  private sent = 0;
  private acked = 0;
  private oldestUnackedAt: number | null = null;
  private sentStep2 = false;
  /** Local edits made while not connected; delivered by the next Step 2. */
  private offlineEdits = false;
  /** Local edits sent since the last time everything was acknowledged. */
  private editsAwaitingAck = false;

  private readonly unsubscribeConnectivity: () => void;

  constructor(private readonly options: ProviderOptions) {
    this.env = options.environment ?? browserEnvironment;
    options.doc.on("update", this.onDocUpdate);
    options.awareness.on("update", this.onAwarenessUpdate);
    this.unsubscribeConnectivity = this.env.onConnectivityChange(this.onConnectivityChange);
    this.connect();
  }

  // Public API

  getStatus(): SyncStatus {
    return this.status;
  }

  /** Called when the status or hasUnconfirmedChanges changes. Returns an unsubscribe function. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Called when the server has acknowledged local edits (not just the handshake). */
  onAllAcked(listener: Listener): () => void {
    this.ackListeners.add(listener);
    return () => this.ackListeners.delete(listener);
  }

  /** Local edits exist that the server has not confirmed. */
  get hasUnconfirmedChanges(): boolean {
    return this.offlineEdits || this.sent > this.acked;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const { doc, awareness } = this.options;
    doc.off("update", this.onDocUpdate);
    awareness.off("update", this.onAwarenessUpdate);
    this.unsubscribeConnectivity();
    this.clearTimers();
    // Tell peers we left before the socket goes away.
    removeAwarenessStates(awareness, [doc.clientID], "local");
    this.socket?.close(1000, "Leaving");
    this.socket = null;
  }

  // Connection lifecycle

  private connect(): void {
    if (this.destroyed || this.terminal || this.socket) return;
    const socket = this.env.createSocket(this.options.url);
    socket.binaryType = "arraybuffer";
    socket.onopen = () => this.onOpen(socket);
    socket.onmessage = (event) => this.onMessage(socket, event);
    socket.onclose = (event) => this.onClose(socket, event.code);
    socket.onerror = () => {
      // onclose follows and handles reconnecting.
    };
    this.socket = socket;
    this.updateStatus();
  }

  private onOpen(socket: WebSocket): void {
    if (socket !== this.socket) return;
    this.sent = 0;
    this.acked = 0;
    this.oldestUnackedAt = null;
    this.sentStep2 = false;
    const { doc, awareness } = this.options;
    socket.send(encodeSyncStep1(doc));
    if (awareness.getLocalState() !== null) {
      socket.send(encodeAwareness(encodeAwarenessUpdate(awareness, [doc.clientID])));
    }
    this.updateStatus();
  }

  private onClose(socket: WebSocket, code: number): void {
    if (socket !== this.socket) return;
    this.socket = null;
    this.synced = false;
    if (this.sent > this.acked) this.offlineEdits = true;
    this.clearSavingTimer();

    // Everyone else's presence is stale now.
    const { doc, awareness } = this.options;
    const others = [...awareness.getStates().keys()].filter((id) => id !== doc.clientID);
    removeAwarenessStates(awareness, others, this);

    if (TERMINAL_CLOSE_CODES.has(code)) {
      this.terminal = code === CLOSE_DELETED ? "deleted" : "not-found";
      this.updateStatus();
      return;
    }
    this.scheduleReconnect();
    this.updateStatus();
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.terminal || this.reconnectTimer) return;
    if (!this.env.isOnline()) return; // onConnectivityChange reconnects.
    const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** this.attempts);
    // Full jitter between half and all of the ceiling spreads out reconnects.
    const delay = ceiling / 2 + this.env.random() * (ceiling / 2);
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private onConnectivityChange = (): void => {
    if (this.env.isOnline() && !this.socket) {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      this.attempts = 0;
      this.connect();
    }
    this.updateStatus();
  };

  // Messages

  private onMessage(socket: WebSocket, event: MessageEvent): void {
    if (socket !== this.socket || !(event.data instanceof ArrayBuffer)) return;
    let message: Message;
    try {
      message = decodeMessage(new Uint8Array(event.data));
    } catch (error) {
      console.warn("Ignoring a malformed message from the sync server", error);
      return;
    }
    const { doc, awareness } = this.options;

    switch (message.type) {
      case "sync-step-1":
        // The server tells us what it has; send everything it lacks,
        // including edits made while we were disconnected.
        this.sendDocumentMessage(encodeSyncStep2(doc, message.stateVector));
        this.sentStep2 = true;
        break;
      case "sync-step-2":
        applyUpdate(doc, message.update, this);
        this.synced = true;
        this.everSynced = true;
        this.attempts = 0;
        break;
      case "update":
        applyUpdate(doc, message.update, this);
        break;
      case "awareness":
        applyAwarenessUpdate(awareness, message.update, this);
        break;
      case "query-awareness":
        if (awareness.getLocalState() !== null) {
          socket.send(encodeAwareness(encodeAwarenessUpdate(awareness, [doc.clientID])));
        }
        break;
      case "ack":
        this.acked = Math.max(this.acked, message.count);
        if (this.acked >= this.sent) {
          this.oldestUnackedAt = null;
          this.clearSavingTimer();
          const hadEdits = this.editsAwaitingAck || (this.offlineEdits && this.sentStep2);
          if (this.sentStep2) this.offlineEdits = false;
          this.editsAwaitingAck = false;
          if (hadEdits) this.ackListeners.forEach((listener) => listener());
        }
        break;
    }
    this.updateStatus();
  }

  private sendDocumentMessage(message: Uint8Array): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(message);
    this.sent += 1;
    if (this.oldestUnackedAt === null) {
      this.oldestUnackedAt = Date.now();
      this.savingTimer = setTimeout(() => {
        this.savingTimer = null;
        this.updateStatus();
      }, SAVING_AFTER_MS);
    }
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === this) return; // Came from the server.
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.sendDocumentMessage(encodeUpdate(update));
      this.editsAwaitingAck = true;
    } else {
      this.offlineEdits = true;
    }
    this.updateStatus();
  };

  private onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    if (origin === this) return;
    const changed = [...added, ...updated, ...removed];
    if (changed.length === 0 || this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeAwareness(encodeAwarenessUpdate(this.options.awareness, changed)));
  };

  // Status

  private computeStatus(): SyncStatus {
    if (this.terminal) return this.terminal;
    if (!this.env.isOnline()) return "offline";
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.synced) {
      return this.everSynced ? "reconnecting" : "connecting";
    }
    if (this.oldestUnackedAt !== null && Date.now() - this.oldestUnackedAt >= SAVING_AFTER_MS) return "saving";
    return "saved";
  }

  private updateStatus(): void {
    const next = this.computeStatus();
    const pending = this.hasUnconfirmedChanges;
    if (next === this.status && pending === this.pending) return;
    this.status = next;
    this.pending = pending;
    this.listeners.forEach((listener) => listener());
  }

  private clearSavingTimer(): void {
    if (this.savingTimer) clearTimeout(this.savingTimer);
    this.savingTimer = null;
  }

  private clearTimers(): void {
    this.clearSavingTimer();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}
