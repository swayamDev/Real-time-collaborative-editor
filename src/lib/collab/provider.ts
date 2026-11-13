import "client-only";
import {
  BATCH_TARGET_BYTES,
  CLOSE_DELETED,
  CLOSE_MALFORMED,
  CLOSE_TOO_LARGE,
  type Message,
  TERMINAL_CLOSE_CODES,
  decodeMessage,
  encodeAwareness,
  encodeSyncStep1,
  encodeUpdate,
} from "@brahma/protocol";
import {
  type Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import * as Y from "yjs";
import { type LocalDocument, type LocalEdit, type PendingEntry, REMOTE_ORIGIN } from "./local-document";
import { encodeStateVectorMap } from "./state-vector";
import { type SyncStatus, computeStatus } from "./status";

export type { SyncStatus };

export const BACKOFF_BASE_MS = 500;
export const BACKOFF_MAX_MS = 10_000;
/** Rounds of "send what the server lacks" before giving up and halting. */
export const MAX_CONVERGENCE_ROUNDS = 3;

const OPEN = 1;

/** Only one tab per document flushes the offline queue at a time. */
export interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

/** The parts of the browser the provider needs; replaced by fakes in tests. */
export interface ProviderEnvironment {
  createSocket(url: string): WebSocket;
  isOnline(): boolean;
  /** Subscribe to online/offline changes. Returns an unsubscribe function. */
  onConnectivityChange(listener: () => void): () => void;
  random(): number;
  locks: LockManagerLike;
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
  locks: {
    request: <T>(name: string, callback: () => Promise<T>): Promise<T> =>
      typeof navigator !== "undefined" && navigator.locks
        ? (navigator.locks.request(name, callback) as Promise<T>)
        : callback(),
  },
};

interface ProviderOptions {
  url: string;
  local: LocalDocument;
  awareness: Awareness;
  environment?: ProviderEnvironment;
}

interface SentMessage {
  entries: PendingEntry[];
  sentAt: number;
}

interface Connection {
  socket: WebSocket;
  /** Document messages sent on this connection, in order. */
  sent: SentMessage[];
  /** Cumulative count from the server's latest ack. */
  acked: number;
  synced: boolean;
  closed: boolean;
  ackWaiters: Array<() => void>;
  stateVectorWaiter: { resolve: (stateVector: Uint8Array) => void; reject: (error: Error) => void } | null;
}

class ConnectionLost extends Error {}

type Listener = () => void;

/** Clients whose structs this document has and `serverStateVector` lacks. */
export function clientsMissingOnServer(doc: Y.Doc, serverStateVector: Uint8Array): number[] {
  const server = Y.decodeStateVector(serverStateVector);
  const local = Y.decodeStateVector(Y.encodeStateVector(doc));
  const missing: number[] = [];
  local.forEach((clock, client) => {
    if ((server.get(client) ?? 0) < clock) missing.push(client);
  });
  return missing;
}

/**
 * Pack pending entries into messages of at most `target` bytes, oldest
 * first. An entry larger than the target travels alone (the editor keeps
 * single edits under the server's cap). `perMessage` limits entries per
 * message; 1 isolates each entry.
 */
export function packEntries(entries: readonly PendingEntry[], target = BATCH_TARGET_BYTES, perMessage = Infinity): PendingEntry[][] {
  const batches: PendingEntry[][] = [];
  let current: PendingEntry[] = [];
  let size = 0;
  for (const entry of entries) {
    const bytes = entry.update.byteLength;
    if (current.length > 0 && (size + bytes > target || current.length >= perMessage)) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(entry);
    size += bytes;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * WebSocket provider for the Brahma sync protocol, with an offline queue.
 *
 * Each connection: send Step 1; the server answers with Step 2 (what we
 * lack) and its own Step 1. Once synced, flush the queue of local edits the
 * server has not acknowledged, in batches under 1 MiB, holding a Web Lock so
 * only one tab per document does it. Then verify convergence: send Step 1
 * again, read the server's state vector from its reply, and send anything
 * it still lacks. Only then are live edits sent as they happen.
 *
 * Rejection: if the server closes with 1007 or 1009, the next connection
 * sends one queued edit per message and waits for each ack. If a single
 * edit is rejected on its own, sync halts for this document. Later edits
 * depend on earlier ones, so nothing is ever skipped; every row stays on
 * the device.
 */
export class SyncProvider {
  private readonly env: ProviderEnvironment;
  private connection: Connection | null = null;
  private status: SyncStatus = "connecting";
  private readonly listeners = new Set<Listener>();
  private readonly ackListeners = new Set<Listener>();

  private everSynced = false;
  private flushing = false;
  private isolate = false;
  private halted: boolean;
  private terminal: "deleted" | "not-found" | null = null;
  private destroyed = false;
  private attempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private statusTimer: ReturnType<typeof setTimeout> | null = null;
  /** Local edits made while not in live mode; sent at the end of the flush. */
  private deferred: LocalEdit[] = [];
  private readonly unsubscribers: Array<() => void> = [];

  constructor(private readonly options: ProviderOptions) {
    this.env = options.environment ?? browserEnvironment;
    this.halted = options.local.halted;
    const { local, awareness } = options;
    this.unsubscribers.push(
      local.onLocalEdit(this.onLocalEdit),
      local.onChange(() => this.updateStatus()),
      this.env.onConnectivityChange(this.onConnectivityChange),
    );
    awareness.on("update", this.onAwarenessUpdate);
    this.connect();
    // connect() returns early when offline or halted; compute the real status either way.
    this.updateStatus();
  }

  // Public API

  getStatus(): SyncStatus {
    return this.status;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Called after the server acknowledges local edits. */
  onAllAcked(listener: Listener): () => void {
    this.ackListeners.add(listener);
    return () => this.ackListeners.delete(listener);
  }

  /** Local edits exist that the server has not acknowledged (they may be safe on the device). */
  get hasPendingEdits(): boolean {
    return this.options.local.pendingCount > 0 || this.deferred.length > 0;
  }

  /** An edit exists that is neither acknowledged by the server nor written on this device. */
  get hasUnsavedChanges(): boolean {
    return this.options.local.unwrittenSince !== null;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    const { local, awareness } = this.options;
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    awareness.off("update", this.onAwarenessUpdate);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.statusTimer) clearTimeout(this.statusTimer);
    removeAwarenessStates(awareness, [local.doc.clientID], "local");
    this.closeConnection(1000, "Leaving");
  }

  // Connection lifecycle

  private connect(): void {
    if (this.destroyed || this.terminal || this.halted || this.connection) return;
    if (!this.env.isOnline()) return;
    const socket = this.env.createSocket(this.options.url);
    socket.binaryType = "arraybuffer";
    const connection: Connection = {
      socket,
      sent: [],
      acked: 0,
      synced: false,
      closed: false,
      ackWaiters: [],
      stateVectorWaiter: null,
    };
    socket.onopen = () => this.onOpen(connection);
    socket.onmessage = (event) => this.onMessage(connection, event);
    socket.onclose = (event) => this.onClose(connection, event.code);
    socket.onerror = () => {
      // onclose follows.
    };
    this.connection = connection;
    this.updateStatus();
  }

  private closeConnection(code: number, reason: string): void {
    const connection = this.connection;
    if (!connection) return;
    this.connection = null;
    this.markClosed(connection);
    try {
      connection.socket.close(code, reason);
    } catch {
      // Already closed.
    }
  }

  private markClosed(connection: Connection): void {
    connection.closed = true;
    connection.ackWaiters.splice(0).forEach((wake) => wake());
    connection.stateVectorWaiter?.reject(new ConnectionLost());
    connection.stateVectorWaiter = null;
  }

  private onOpen(connection: Connection): void {
    if (connection !== this.connection) return;
    const { local, awareness } = this.options;
    connection.socket.send(encodeSyncStep1(local.doc));
    if (awareness.getLocalState() !== null) {
      connection.socket.send(encodeAwareness(encodeAwarenessUpdate(awareness, [local.doc.clientID])));
    }
  }

  private onClose(connection: Connection, code: number): void {
    const wasCurrent = connection === this.connection;
    const unacked = connection.sent.slice(connection.acked);
    this.markClosed(connection);
    if (!wasCurrent) return;
    this.connection = null;
    this.flushing = false;

    const { local, awareness } = this.options;
    const others = [...awareness.getStates().keys()].filter((id) => id !== local.doc.clientID);
    removeAwarenessStates(awareness, others, REMOTE_ORIGIN);

    if (TERMINAL_CLOSE_CODES.has(code)) {
      this.terminal = code === CLOSE_DELETED ? "deleted" : "not-found";
      this.updateStatus();
      return;
    }

    if (code === CLOSE_MALFORMED || code === CLOSE_TOO_LARGE) {
      if (this.isolate && unacked.length === 1 && unacked[0].entries.length <= 1) {
        // Rejected even when sent alone: stop, never skip it.
        this.halt();
        return;
      }
      this.isolate = true;
    }
    this.scheduleReconnect();
    this.updateStatus();
  }

  private halt(): void {
    this.halted = true;
    void this.options.local.setHalted(true);
    this.closeConnection(1000, "Halted");
    this.updateStatus();
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.terminal || this.halted || this.reconnectTimer) return;
    if (!this.env.isOnline()) return; // onConnectivityChange reconnects.
    const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** this.attempts);
    const delay = ceiling / 2 + this.env.random() * (ceiling / 2);
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private onConnectivityChange = (): void => {
    if (!this.env.isOnline()) {
      // navigator.onLine false: drop the socket now instead of waiting for it to time out.
      if (this.connection) this.closeConnection(1000, "Offline");
      this.flushing = false;
    } else if (!this.connection) {
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      this.attempts = 0;
      this.connect();
    }
    this.updateStatus();
  };

  // Messages

  private onMessage(connection: Connection, event: MessageEvent): void {
    if (connection !== this.connection || !(event.data instanceof ArrayBuffer)) return;
    let message: Message;
    try {
      message = decodeMessage(new Uint8Array(event.data));
    } catch (error) {
      console.warn("Ignoring a malformed message from the sync server", error);
      return;
    }
    const { local, awareness } = this.options;

    switch (message.type) {
      case "sync-step-1":
        // The server's state vector. On connect it is only informational
        // (the queue flush covers our edits); during the convergence check
        // it is the answer we are waiting for.
        if (connection.stateVectorWaiter) {
          const { resolve } = connection.stateVectorWaiter;
          connection.stateVectorWaiter = null;
          resolve(message.stateVector);
        }
        break;
      case "sync-step-2":
        Y.applyUpdate(local.doc, message.update, REMOTE_ORIGIN);
        if (!connection.synced) {
          connection.synced = true;
          this.everSynced = true;
          this.attempts = 0;
          void local.markSynced();
          void this.flush(connection);
        }
        break;
      case "update":
        Y.applyUpdate(local.doc, message.update, REMOTE_ORIGIN);
        break;
      case "awareness":
        applyAwarenessUpdate(awareness, message.update, REMOTE_ORIGIN);
        break;
      case "query-awareness":
        if (awareness.getLocalState() !== null) {
          connection.socket.send(encodeAwareness(encodeAwarenessUpdate(awareness, [local.doc.clientID])));
        }
        break;
      case "ack":
        this.onAck(connection, message.count);
        break;
    }
    this.updateStatus();
  }

  private onAck(connection: Connection, count: number): void {
    const newlyAcked = connection.sent.slice(connection.acked, count);
    connection.acked = Math.max(connection.acked, count);
    connection.ackWaiters.splice(0).forEach((wake) => wake());
    const entries = newlyAcked.flatMap((message) => message.entries);
    if (entries.length > 0) {
      void this.options.local.acknowledge(entries).then(() => this.ackListeners.forEach((listener) => listener()));
    }
  }

  private send(connection: Connection, message: Uint8Array, entries: PendingEntry[]): number {
    if (connection.closed || connection.socket.readyState !== OPEN) throw new ConnectionLost();
    connection.socket.send(message);
    connection.sent.push({ entries, sentAt: Date.now() });
    this.scheduleStatusCheck();
    return connection.sent.length;
  }

  private waitForAck(connection: Connection, count: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (connection.acked >= count) resolve();
        else if (connection.closed) reject(new ConnectionLost());
        else connection.ackWaiters.push(check);
      };
      check();
    });
  }

  private requestServerStateVector(connection: Connection): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      if (connection.closed) return reject(new ConnectionLost());
      connection.stateVectorWaiter = { resolve, reject };
      connection.socket.send(encodeSyncStep1(this.options.local.doc));
    });
  }

  // Flushing the offline queue

  private async flush(connection: Connection): Promise<void> {
    this.flushing = true;
    this.updateStatus();
    const { local } = this.options;
    try {
      await this.env.locks.request(`brahma-flush:${local.docId}`, async () => {
        if (connection.closed) throw new ConnectionLost();
        await this.sendQueue(connection);
        await this.verifyConvergence(connection);
        await local.compactIfNeeded();
      });
      if (connection.closed) return;
      this.isolate = false;
      this.flushing = false;
      // Edits made during the flush that were not stored in time to be listed.
      const late = this.deferred.splice(0);
      for (const edit of late) this.sendLive(connection, edit);
    } catch (error) {
      if (!(error instanceof ConnectionLost)) throw error;
    } finally {
      if (connection !== this.connection) this.flushing = false;
      this.updateStatus();
    }
  }

  /**
   * Send every pending entry, oldest first. In isolation mode, one entry
   * per message and wait for each ack, so a rejection pins down one entry.
   */
  private async sendQueue(connection: Connection): Promise<void> {
    const sentSeqs = new Set<number>();
    const sentEdits = new Set<LocalEdit>();
    for (;;) {
      const entries = (await this.options.local.pendingEntries()).filter(
        (entry) => !(entry.seq !== null && sentSeqs.has(entry.seq)) && !(entry.edit && sentEdits.has(entry.edit)),
      );
      if (entries.length === 0) break;
      const batches = packEntries(entries, BATCH_TARGET_BYTES, this.isolate ? 1 : Infinity);
      for (const batch of batches) {
        const update = batch.length === 1 ? batch[0].update : Y.mergeUpdates(batch.map((entry) => entry.update));
        const count = this.send(connection, encodeUpdate(update), batch);
        batch.forEach((entry) => {
          if (entry.seq !== null) sentSeqs.add(entry.seq);
          if (entry.edit) sentEdits.add(entry.edit);
        });
        if (this.isolate) await this.waitForAck(connection, count);
      }
      await this.waitForAck(connection, connection.sent.length);
    }
    // Deferred edits already covered by the queue need no second send.
    const stillDeferred: LocalEdit[] = [];
    for (const edit of this.deferred) {
      const seq = await edit.seq;
      if (!(seq !== null && sentSeqs.has(seq)) && !sentEdits.has(edit)) stillDeferred.push(edit);
    }
    this.deferred = stillDeferred;
  }

  /**
   * Do not assume the queue covered everything: ask for the server's state
   * vector and send whatever it still lacks, per client so no single message
   * grows past the batch size. Halt if it does not converge.
   */
  private async verifyConvergence(connection: Connection): Promise<void> {
    const { doc } = this.options.local;
    for (let round = 0; round < MAX_CONVERGENCE_ROUNDS; round++) {
      const serverVector = await this.requestServerStateVector(connection);
      const missing = clientsMissingOnServer(doc, serverVector);
      if (missing.length === 0) return;
      const server = Y.decodeStateVector(serverVector);
      const local = Y.decodeStateVector(Y.encodeStateVector(doc));
      for (const client of missing) {
        // Pretend the server has everything except this client's missing range.
        const target = new Map(local);
        target.set(client, server.get(client) ?? 0);
        const update = Y.encodeStateAsUpdate(doc, encodeStateVectorMap(target));
        // Applied by the server like any update, and acknowledged.
        const count = this.send(connection, encodeUpdate(update), []);
        await this.waitForAck(connection, count);
      }
    }
    console.error("The server still lacks edits after several rounds; stopping sync for this document.");
    this.halt();
    throw new ConnectionLost();
  }

  // Live editing

  private onLocalEdit = (edit: LocalEdit): void => {
    const connection = this.connection;
    if (connection && connection.synced && !this.flushing && !connection.closed) {
      this.sendLive(connection, edit);
    } else {
      this.deferred.push(edit);
    }
    this.updateStatus();
  };

  private sendLive(connection: Connection, edit: LocalEdit): void {
    try {
      this.send(connection, encodeUpdate(edit.update), [{ update: edit.update, seq: null, edit }]);
    } catch (error) {
      if (!(error instanceof ConnectionLost)) throw error;
      this.deferred.push(edit);
    }
  }

  private onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ): void => {
    if (origin === REMOTE_ORIGIN) return;
    const changed = [...added, ...updated, ...removed];
    const socket = this.connection?.socket;
    if (changed.length === 0 || !socket || socket.readyState !== OPEN) return;
    socket.send(encodeAwareness(encodeAwarenessUpdate(this.options.awareness, changed)));
  };

  // Status

  private oldestUnackedAt(): number | null {
    const connection = this.connection;
    if (!connection) return null;
    return connection.sent[connection.acked]?.sentAt ?? null;
  }

  private computeStatus(): SyncStatus {
    const connection = this.connection;
    return computeStatus({
      terminal: this.terminal,
      halted: this.halted,
      online: this.env.isOnline(),
      socketSynced: Boolean(connection && connection.synced && !connection.closed),
      everSyncedThisTab: this.everSynced,
      unwrittenSince: this.options.local.unwrittenSince,
      flushing: this.flushing,
      oldestUnackedAt: this.oldestUnackedAt(),
      now: Date.now(),
    });
  }

  /** Listeners also hear about changes that keep the label (pending counts). */
  private updateStatus(): void {
    this.status = this.computeStatus();
    this.listeners.forEach((listener) => listener());
    this.scheduleStatusCheck();
  }

  /** Re-evaluate once the one-second "late" thresholds can have passed. */
  private scheduleStatusCheck(): void {
    if (this.statusTimer) return;
    const since = [this.oldestUnackedAt(), this.options.local.unwrittenSince].filter(
      (value): value is number => value !== null,
    );
    if (since.length === 0) return;
    const due = Math.max(0, Math.min(...since) + 1_000 - Date.now()) + 10;
    this.statusTimer = setTimeout(() => {
      this.statusTimer = null;
      this.updateStatus();
    }, due);
  }
}
