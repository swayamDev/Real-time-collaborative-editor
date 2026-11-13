import {
  CLOSE_DELETED,
  CLOSE_MALFORMED,
  CLOSE_NOT_FOUND,
  CLOSE_TOO_LARGE,
  MAX_MESSAGE_BYTES,
  type Message,
  ProtocolError,
  TITLE_FIELD,
  decodeMessage,
  encodeAck,
  encodeAwareness,
  encodeQueryAwareness,
  encodeSyncStep1,
  encodeSyncStep2,
  encodeUpdate,
  titleForColumn,
} from "@brahma/protocol";
import { DurableObject } from "cloudflare:workers";
import * as Y from "yjs";
import { AwarenessRegistry } from "./awareness-registry";
import { RoomStorage } from "./storage";
import { type SnapshotStore, createSnapshotStore } from "./store";

/** How long incoming updates are coalesced before one storage write and one ack. */
export const BATCH_MS = 150;
/** Compact the update log into the snapshot after this many batches. */
export const COMPACT_AFTER_BATCHES = 100;
/** Snapshot to Postgres this long after the last edit... */
export const SNAPSHOT_DEBOUNCE_MS = 2_000;
/** ...but no later than this after the oldest edit not yet in Postgres. */
export const SNAPSHOT_MAX_WAIT_MS = 10_000;

/** Per-socket state that must survive hibernation. Kept small (2 KB limit). */
interface Attachment {
  /** Document messages (Step 2 and Update) received on this socket. */
  received: number;
  /** Awareness client ids announced on this socket, removed when it closes. */
  awarenessIds: number[];
}

type LoadResult = "ok" | "not-found" | "deleted";

/**
 * One Durable Object per document, and the only writer of that document.
 *
 * Uses the hibernatable WebSocket API: the runtime keeps sockets open while
 * the object is evicted from memory, and calls webSocketMessage on a fresh
 * instance when a message arrives. The constructor rebuilds the Y.Doc from
 * storage; presence is rebuilt by asking clients to resend it.
 */
export class DocumentRoom extends DurableObject<Env> {
  private readonly storage: RoomStorage;
  private readonly store: SnapshotStore;
  private readonly awareness = new AwarenessRegistry();
  private doc: Y.Doc | null = null;
  private deleted = false;
  private awarenessQueried = false;

  private pendingUpdates: Uint8Array[] = [];
  private pendingAcks = new Set<WebSocket>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  /** Batches written since this instance started; detects edits during a snapshot. */
  private writes = 0;
  /** When the last batch was written; drives the snapshot debounce. */
  private lastWriteAt = 0;
  /** The alarm time this instance set, or null if it set none. */
  private alarmSetFor: number | null = null;
  /** Snapshot without waiting for typing to pause (room emptied, rename). */
  private snapshotUrgent = false;
  private tombstoneChecked = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.storage = new RoomStorage(ctx.storage.sql);
    this.store = createSnapshotStore(env);
    // SQLite reads are synchronous, so an initialized room is ready at once.
    if (this.storage.isInitialized()) {
      this.attachDoc(this.buildDoc(this.storage.loadUpdates()));
    }
  }

  // Connections

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/internal/")) return this.internal(request, path.split("/")[3].toLowerCase());

    const documentId = path.split("/")[2]?.toLowerCase() ?? "";
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    const result = await this.ensureLoaded(documentId);
    if (result !== "ok") {
      // A browser cannot read the status of a failed upgrade, so accept and
      // close with a code the client understands.
      server.accept();
      if (result === "deleted") server.close(CLOSE_DELETED, "Document deleted");
      else server.close(CLOSE_NOT_FOUND, "Document not found");
      return new Response(null, { status: 101, webSocket: client });
    }

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ received: 0, awarenessIds: [] } satisfies Attachment);

    // Step 1 from the server: the client replies with Step 2 (its edits we lack).
    server.send(encodeSyncStep1(this.doc!));
    const presence = this.awareness.encodeAll();
    if (presence) server.send(encodeAwareness(presence));
    this.restorePresenceAfterWake(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: ArrayBuffer | string): Promise<void> {
    if (typeof data === "string") return this.reject(ws, CLOSE_MALFORMED, "Text messages are not supported");
    if (data.byteLength > MAX_MESSAGE_BYTES) return this.reject(ws, CLOSE_TOO_LARGE, "Message too large");
    const doc = this.doc;
    if (!doc || this.deleted) return this.reject(ws, CLOSE_DELETED, "Document deleted");
    this.restorePresenceAfterWake(ws);

    let message: Message;
    try {
      message = decodeMessage(new Uint8Array(data));
    } catch (error) {
      return this.reject(ws, CLOSE_MALFORMED, error instanceof ProtocolError ? error.message : "Malformed message");
    }

    switch (message.type) {
      case "sync-step-1":
        // The client says what it has; reply with everything it lacks, then
        // with our own state vector, so the client can check that we hold
        // everything it has (its convergence check after an offline flush).
        ws.send(encodeSyncStep2(doc, message.stateVector));
        ws.send(encodeSyncStep1(doc));
        return;

      case "sync-step-2":
      case "update": {
        try {
          Y.decodeUpdate(message.update);
          Y.applyUpdate(doc, message.update, ws);
        } catch {
          return this.reject(ws, CLOSE_MALFORMED, "Invalid Yjs update");
        }
        const attachment = ws.deserializeAttachment() as Attachment;
        attachment.received += 1;
        ws.serializeAttachment(attachment);
        this.pendingAcks.add(ws);
        this.scheduleFlush();
        return;
      }

      case "awareness": {
        let change;
        try {
          change = this.awareness.apply(message.update);
        } catch {
          return this.reject(ws, CLOSE_MALFORMED, "Invalid awareness update");
        }
        const attachment = ws.deserializeAttachment() as Attachment;
        const ids = new Set(attachment.awarenessIds);
        change.present.forEach((id) => ids.add(id));
        change.removed.forEach((id) => ids.delete(id));
        attachment.awarenessIds = [...ids].slice(0, 32);
        ws.serializeAttachment(attachment);
        this.broadcast(encodeAwareness(message.update), ws);
        return;
      }

      case "query-awareness": {
        const presence = this.awareness.encodeAll();
        if (presence) ws.send(encodeAwareness(presence));
        return;
      }

      case "ack":
        return this.reject(ws, CLOSE_MALFORMED, "Clients do not send acks");
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    this.removeSocket(ws);
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, "Closing");
    } catch {
      // Already closed.
    }
    if (this.openSockets().length === 0) this.lastClientLeft();
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.removeSocket(ws);
    if (this.openSockets().length === 0) this.lastClientLeft();
  }

  // Internal API (rename and delete from the Next app)

  private async internal(request: Request, documentId: string): Promise<Response> {
    if (request.method === "DELETE") {
      await this.deleteRoom();
      return new Response(null, { status: 204 });
    }

    let title: unknown;
    try {
      title = ((await request.json()) as { title?: unknown }).title;
    } catch {
      return Response.json({ error: "Body must be JSON." }, { status: 400 });
    }
    if (typeof title !== "string") return Response.json({ error: "Title must be text." }, { status: 400 });

    const result = await this.ensureLoaded(documentId);
    if (result !== "ok") return Response.json({ error: "Document not found." }, { status: 404 });

    const cleaned = titleForColumn(title);
    const text = this.doc!.getText(TITLE_FIELD);
    // Replace the shared title; open editors receive it as a normal update.
    this.doc!.transact(() => {
      text.delete(0, text.length);
      text.insert(0, cleaned);
    }, "internal");
    this.flush();
    // The sidebar list reads the column, so snapshot right away.
    this.snapshotSoon();
    return Response.json({ title: cleaned });
  }

  // Loading

  /**
   * A room that already holds the document checks Postgres once per
   * instance, on its first connection. If a delete tombstoned the row but
   * could not reach this room, the room erases itself here.
   */
  private async checkTombstone(documentId: string): Promise<boolean> {
    if (this.tombstoneChecked) return false;
    this.tombstoneChecked = true;
    const record = await this.store.load(documentId);
    if (record && !record.deleted) return false;
    await this.deleteRoom();
    return true;
  }

  private async ensureLoaded(documentId: string): Promise<LoadResult> {
    if (this.deleted) return "deleted";
    if (this.doc) {
      if (this.storage.documentId() !== documentId) return "not-found";
      return (await this.checkTombstone(documentId)) ? "deleted" : "ok";
    }

    let result: LoadResult = "not-found";
    // Hold other events until the first load finishes, so no message sees a
    // half-loaded room.
    await this.ctx.blockConcurrencyWhile(async () => {
      if (this.doc) {
        result = "ok";
        return;
      }
      const record = await this.store.load(documentId);
      this.tombstoneChecked = true;
      if (!record) return;
      if (record.deleted) {
        await this.deleteRoom();
        result = "deleted";
        return;
      }

      const doc = this.buildDoc([record.state]);
      // Phase 1 documents have their title only in the Postgres column.
      const title = doc.getText(TITLE_FIELD);
      if (title.length === 0 && record.title !== "") title.insert(0, record.title);

      this.storage.initialize(documentId, Y.encodeStateAsUpdate(doc));
      this.attachDoc(doc);
      result = "ok";
    });
    return result;
  }

  private buildDoc(updates: Uint8Array[]): Y.Doc {
    const doc = new Y.Doc();
    for (const update of updates) {
      if (update.byteLength > 0) Y.applyUpdate(doc, update);
    }
    return doc;
  }

  private attachDoc(doc: Y.Doc): void {
    doc.on("update", (update: Uint8Array, origin: unknown) => {
      // Relay to everyone except the sender, and queue for storage.
      this.broadcast(encodeUpdate(update), origin instanceof WebSocket ? origin : null);
      this.pendingUpdates.push(update);
      this.scheduleFlush();
    });
    this.doc = doc;
  }

  // Batched storage writes and acks

  private scheduleFlush(): void {
    this.flushTimer ??= setTimeout(() => this.flush(), BATCH_MS);
  }

  /** Write every pending update in one row, then ack each socket once. */
  protected flush(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    if (this.deleted || !this.doc) return;

    if (this.pendingUpdates.length > 0) {
      this.storage.appendUpdate(Y.mergeUpdates(this.pendingUpdates));
      this.pendingUpdates = [];
      this.storage.markDirty(Date.now());
      if (this.storage.updateCount() >= COMPACT_AFTER_BATCHES) {
        this.storage.writeSnapshot(Y.encodeStateAsUpdate(this.doc));
      }
      this.afterWrite();
    }

    // The output gate holds these until the write above is durable.
    for (const ws of this.pendingAcks) {
      const attachment = ws.deserializeAttachment() as Attachment | null;
      if (attachment) this.send(ws, encodeAck(attachment.received));
    }
    this.pendingAcks.clear();
  }

  // Snapshots to Postgres

  /**
   * Schedule a snapshot after a write. Every setAlarm() is billed as a row
   * written, so the alarm is set once per snapshot cycle, not per batch;
   * the alarm handler pushes itself back while typing continues.
   */
  private afterWrite(): void {
    this.writes += 1;
    this.lastWriteAt = Date.now();
    if (this.alarmSetFor === null) this.scheduleAlarm(this.snapshotDue());
  }

  /** About 2s after the last write, never later than 10s after the oldest unsaved edit. */
  private snapshotDue(): number {
    const dirtySince = this.storage.dirtySince() ?? Date.now();
    return Math.min(this.lastWriteAt + SNAPSHOT_DEBOUNCE_MS, dirtySince + SNAPSHOT_MAX_WAIT_MS);
  }

  private scheduleAlarm(at: number): void {
    this.alarmSetFor = at;
    void this.ctx.storage.setAlarm(at);
  }

  /** Snapshot as soon as possible, skipping the debounce. */
  private snapshotSoon(): void {
    this.snapshotUrgent = true;
    const now = Date.now();
    if (this.alarmSetFor === null || this.alarmSetFor > now) this.scheduleAlarm(now);
  }

  /** Everyone left: store what is pending and snapshot right away. */
  private lastClientLeft(): void {
    if (this.deleted || !this.doc) return;
    this.flush();
    if (this.storage.dirtySince() !== null) this.snapshotSoon();
  }

  /**
   * Copy the live document and its title into Postgres.
   *
   * Throwing makes the runtime retry the alarm with backoff. If the row is
   * gone, the document was deleted in Postgres, so the room deletes itself.
   */
  async alarm(): Promise<void> {
    const doc = this.doc;
    const documentId = this.storage.documentId();
    this.alarmSetFor = null;
    if (this.deleted || !doc || !documentId) return;
    this.flush();
    if (this.storage.dirtySince() === null) return;

    // Still typing and under the 10s cap: move the alarm once instead of
    // saving now. After an eviction lastWriteAt is 0, so this saves.
    const due = this.snapshotDue();
    if (!this.snapshotUrgent && due > Date.now() + 50) {
      this.scheduleAlarm(due);
      return;
    }
    this.snapshotUrgent = false;

    const writesBefore = this.writes;
    const state = Y.encodeStateAsUpdate(doc);
    const title = titleForColumn(doc.getText(TITLE_FIELD).toString());
    const exists = await this.store.save(documentId, { state, title });
    if (!exists) {
      await this.deleteRoom();
      return;
    }

    if (this.writes === writesBefore) {
      // Nothing changed while saving: Postgres matches. Compact the local log too.
      this.storage.clearDirty();
      this.storage.writeSnapshot(state);
    } else {
      // Edits arrived during the save; snapshot again soon.
      this.scheduleAlarm(Date.now() + SNAPSHOT_DEBOUNCE_MS);
    }
  }

  /** Close every socket for good and erase this room's storage and alarm. */
  protected async deleteRoom(): Promise<void> {
    this.deleted = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.pendingUpdates = [];
    this.pendingAcks.clear();
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(CLOSE_DELETED, "Document deleted");
      } catch {
        // Already closed.
      }
    }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.doc = null;
  }

  // Presence

  /**
   * After hibernation the registry is empty while sockets are still open.
   * Ask every client to resend its presence so new joiners see everyone.
   */
  private restorePresenceAfterWake(except: WebSocket): void {
    if (this.awarenessQueried) return;
    this.awarenessQueried = true;
    if (this.awareness.size > 0) return;
    this.broadcast(encodeQueryAwareness(), except);
  }

  private removeSocket(ws: WebSocket): void {
    this.pendingAcks.delete(ws);
    const attachment = ws.deserializeAttachment() as Attachment | null;
    const removal = attachment ? this.awareness.remove(attachment.awarenessIds) : null;
    if (removal) this.broadcast(encodeAwareness(removal), ws);
  }

  // Helpers

  private openSockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN);
  }

  private broadcast(message: Uint8Array, except: WebSocket | null): void {
    for (const ws of this.openSockets()) {
      if (ws !== except) this.send(ws, message);
    }
  }

  private send(ws: WebSocket, message: Uint8Array): void {
    try {
      ws.send(message);
    } catch {
      // The socket is closing; its close handler cleans up.
    }
  }

  /** Close one misbehaving socket. The room and every other socket carry on. */
  private reject(ws: WebSocket, code: number, reason: string): void {
    console.warn(`Rejected message: ${reason}`);
    this.removeSocket(ws);
    try {
      ws.close(code, reason);
    } catch {
      // Already closed.
    }
  }
}
