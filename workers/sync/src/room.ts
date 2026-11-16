import {
  CLOSE_ACCESS_REVOKED,
  CLOSE_CLIENT_OUTDATED,
  CLOSE_SCHEMA_UNSUPPORTED,
  CLOSE_DELETED,
  CLOSE_DEMO_LIMIT,
  CLOSE_MALFORMED,
  CLOSE_POLICY,
  CLOSE_READ_ONLY,
  CLOSE_SEAT_MOVED,
  CLOSE_UNAUTHENTICATED,
  SYNC_SUBPROTOCOL,
  type TokenRole,
  encodeRole,
  verifySyncToken,
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
import { AwarenessRegistry, decodeAwarenessUpdate, encodeAwarenessEntries } from "./awareness-registry";
import { effectiveRole, publicKeys, readIdentity } from "./identity";
import { logEvent } from "./log";
import { decideSchema, schemaBounds } from "./schema-policy";
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
/**
 * Demo rooms ("Try the demo"). Bounded so demos cannot use up the free
 * plan's daily Durable Object writes (100,000 rows): each batch writes one
 * update row, deleted again at compaction, so a full demo costs about 700
 * rows. No Postgres snapshots: a demo lives only here, until it expires.
 */
export const DEMO_MAX_SOCKETS = 2;
export const DEMO_MAX_BATCHES = 300;
export const DEMO_MAX_BYTES = 64 * 1024;

/** Per-socket state that must survive hibernation. Kept small (2 KB limit). */
interface Attachment {
  /** Document messages (Step 2 and Update) received on this socket. */
  received: number;
  /** Awareness client ids announced on this socket, removed when it closes. */
  awarenessIds: number[];
  /** Who is on this socket and what they may do, from their sync token. */
  userId: string;
  role: TokenRole;
  name: string;
  image: string | null;
  /** Token expiry, seconds since epoch. */
  exp: number;
  /** Document schema version the client runs. */
  schema: number;
}

function canWrite(role: TokenRole): boolean {
  return role === "owner" || role === "editor";
}

/** The 101 response. The selected subprotocol is only ever brahma.v1, never the auth entry. */
function upgraded(client: WebSocket): Response {
  return new Response(null, { status: 101, webSocket: client, headers: { "Sec-WebSocket-Protocol": SYNC_SUBPROTOCOL } });
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
  /** Which socket owns each awareness client id; another socket may not use it. */
  private readonly awarenessOwners = new Map<number, WebSocket>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.storage = new RoomStorage(ctx.storage.sql);
    this.store = createSnapshotStore(env);
    // After hibernation, rebuild which socket owns which presence id.
    for (const ws of ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as Attachment | null;
      attachment?.awarenessIds.forEach((id) => this.awarenessOwners.set(id, ws));
    }
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
    // A browser cannot read the status of a failed upgrade, so accept and
    // close with a code the client understands.
    const refuse = (code: number, reason: string) => {
      logEvent("connect_refused", { code, reason });
      server.accept();
      server.close(code, reason);
      return upgraded(client);
    };

    // Set by the router after verifying the token; never by a client.
    const identity = readIdentity(request.headers);
    if (!identity) return refuse(CLOSE_UNAUTHENTICATED, "Missing identity");

    const result = await this.ensureLoaded(documentId);
    if (result === "deleted") return refuse(CLOSE_DELETED, "Document deleted");
    if (result !== "ok") return refuse(CLOSE_NOT_FOUND, "Document not found");

    // A demo seat opens only a demo document, and a real user's token never
    // opens one. Refused as not found, so neither learns the other exists.
    const demoUntil = this.storage.demoExpiresAt();
    if (identity.demo !== (demoUntil !== null)) {
      return refuse(CLOSE_NOT_FOUND, identity.demo ? "Demo seat on a real document" : "Not a demo seat");
    }
    if (demoUntil !== null && Date.now() >= demoUntil) {
      await this.deleteRoom();
      return refuse(CLOSE_DELETED, "Demo ended");
    }

    // A client running an older document schema would remove content made
    // with newer node types (an editor's binding removes what its schema
    // cannot hold). Refuse it before it can send anything; it updates and
    // reloads. Claims are only believed within the deployment's bounds, so
    // no client can lock others out. See schema-policy.ts.
    const schema = decideSchema(identity.schema, this.storage.newestSchema(), schemaBounds(this.env));
    if (schema.kind === "unsupported") return refuse(CLOSE_SCHEMA_UNSUPPORTED, "Schema version not supported");
    if (schema.kind === "outdated") return refuse(CLOSE_CLIENT_OUTDATED, "Brahma was updated");
    if (schema.record !== null) this.storage.setNewestSchema(schema.record);
    if (schema.raised) this.closeOlderThan(identity.schema);

    const role = effectiveRole(identity, this.storage.getAccess(identity.userId));
    if (!role) return refuse(CLOSE_ACCESS_REVOKED, "Access removed");

    if (demoUntil !== null) {
      // One socket per seat: a newer one (the same pane reconnecting, or the
      // seat opened on another device) takes the seat over.
      for (const other of this.openSockets()) {
        const held = other.deserializeAttachment() as Attachment | null;
        if (held?.userId === identity.userId) this.reject(other, CLOSE_SEAT_MOVED, "This seat moved to another connection");
      }
      if (this.openSockets().length >= DEMO_MAX_SOCKETS) return refuse(CLOSE_DEMO_LIMIT, "Demo is full");
      if (this.demoFull()) return refuse(CLOSE_DEMO_LIMIT, "Demo limit reached");
    }

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({
      received: 0,
      awarenessIds: [],
      userId: identity.userId,
      role,
      name: identity.name,
      image: identity.image,
      exp: identity.exp,
      schema: identity.schema,
    } satisfies Attachment);

    // Step 1 from the server: the client replies with Step 2 (its edits we lack).
    server.send(encodeSyncStep1(this.doc!));
    const presence = this.awareness.encodeAll();
    if (presence) server.send(encodeAwareness(presence));
    this.restorePresenceAfterWake(server);
    // The token role may have been capped by a later access change.
    if (role !== identity.role) server.send(encodeRole(role));

    return upgraded(client);
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

    const attachment = ws.deserializeAttachment() as Attachment;

    // A refreshed token keeps a long session going without reconnecting.
    if (message.type === "auth") return this.refreshToken(ws, attachment, message.token);

    const grace = Number(this.env.TOKEN_GRACE_SECONDS ?? 60);
    if (Date.now() / 1000 > attachment.exp + grace) {
      return this.reject(ws, CLOSE_UNAUTHENTICATED, "Sync token expired");
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
        let decoded;
        try {
          decoded = Y.decodeUpdate(message.update);
        } catch {
          return this.reject(ws, CLOSE_MALFORMED, "Invalid Yjs update");
        }
        if (this.storage.demoExpiresAt() !== null && (this.demoFull() || message.update.byteLength > DEMO_MAX_BYTES)) {
          return this.closeFullDemo();
        }
        if (!canWrite(attachment.role)) {
          // A viewer still answers Step 1 with an empty Step 2. Anything that
          // carries content is a write: never trust the client to enforce
          // read-only, so drop it and close.
          const empty = decoded.structs.length === 0 && decoded.ds.clients.size === 0;
          if (!empty) return this.reject(ws, CLOSE_READ_ONLY, "Viewers cannot edit");
          this.send(ws, encodeAck(attachment.received));
          return;
        }
        try {
          Y.applyUpdate(doc, message.update, ws);
        } catch {
          return this.reject(ws, CLOSE_MALFORMED, "Invalid Yjs update");
        }
        attachment.received += 1;
        ws.serializeAttachment(attachment);
        this.pendingAcks.add(ws);
        this.scheduleFlush();
        return;
      }

      case "awareness": {
        const result = this.bindAwareness(ws, attachment, message.update);
        if (result === "malformed") return this.reject(ws, CLOSE_MALFORMED, "Invalid awareness update");
        if (result === "spoofed") return this.reject(ws, CLOSE_POLICY, "Presence does not match the signed-in user");
        const { update: bound, takenOver } = result;
        for (const [stale, clientIds] of takenOver) this.retireStaleSocket(stale, clientIds, ws);
        const change = this.awareness.apply(bound);
        change.present.forEach((id) => this.awarenessOwners.set(id, ws));
        change.removed.forEach((id) => this.awarenessOwners.delete(id));
        const ids = new Set(attachment.awarenessIds);
        takenOver.forEach((clientIds) => clientIds.forEach((id) => ids.add(id)));
        change.present.forEach((id) => ids.add(id));
        change.removed.forEach((id) => ids.delete(id));
        attachment.awarenessIds = [...ids].slice(0, 32);
        ws.serializeAttachment(attachment);
        this.broadcast(encodeAwareness(bound), ws);
        return;
      }

      case "query-awareness": {
        const presence = this.awareness.encodeAll();
        if (presence) ws.send(encodeAwareness(presence));
        return;
      }

      case "ack":
      case "role":
        return this.reject(ws, CLOSE_MALFORMED, "Clients do not send this message");
    }
  }

  /**
   * Presence is bound to identity. Each awareness client id belongs to the
   * socket that first announced it, and every state must carry the socket
   * user id. Name and avatar are replaced with the token values, so nobody
   * can appear as someone else. Returns the rewritten update.
   *
   * One exception: the same user announcing a client id held by another of
   * their sockets is that tab reconnecting after its old socket vanished
   * without a close frame (airplane mode, a dropped mobile connection), which
   * the room cannot otherwise notice. The old socket is stale: it is listed
   * in `takenOver` and retired. Another user claiming the id is still refused.
   */
  private bindAwareness(
    ws: WebSocket,
    attachment: Attachment,
    update: Uint8Array,
  ): { update: Uint8Array; takenOver: Map<WebSocket, number[]> } | "malformed" | "spoofed" {
    let entries;
    try {
      entries = decodeAwarenessUpdate(update);
    } catch {
      return "malformed";
    }
    const takenOver = new Map<WebSocket, number[]>();
    for (const entry of entries) {
      const owner = this.awarenessOwners.get(entry.clientId);
      if (owner && owner !== ws) {
        const ownerAttachment = owner.deserializeAttachment() as Attachment | null;
        if (ownerAttachment?.userId !== attachment.userId) return "spoofed";
        takenOver.set(owner, [...(takenOver.get(owner) ?? []), entry.clientId]);
      }
      if (entry.state === "null") continue;
      const state = JSON.parse(entry.state) as { user?: Record<string, unknown> } | null;
      if (typeof state !== "object" || state === null || typeof state.user !== "object" || state.user === null) {
        return "spoofed";
      }
      if (state.user.id !== attachment.userId) return "spoofed";
      state.user = { ...state.user, id: attachment.userId, name: attachment.name, image: attachment.image };
      entry.state = JSON.stringify(state);
    }
    return { update: encodeAwarenessEntries(entries), takenOver };
  }

  /**
   * Close a socket of the same user whose presence ids a newer socket just
   * claimed. Those ids pass to the newer socket without a removal broadcast
   * (a removal would bump their clock, and other clients would then ignore
   * the reconnected tab's presence until its next renewal).
   */
  private retireStaleSocket(stale: WebSocket, clientIds: readonly number[], replacement: WebSocket): void {
    const attachment = stale.deserializeAttachment() as Attachment | null;
    if (attachment) {
      attachment.awarenessIds = attachment.awarenessIds.filter((id) => !clientIds.includes(id));
      stale.serializeAttachment(attachment);
    }
    clientIds.forEach((id) => this.awarenessOwners.set(id, replacement));
    logEvent("socket_replaced", { reason: "Same user reconnected with the same presence id" });
    this.removeSocket(stale);
    try {
      stale.close(1000, "Replaced by a newer connection");
    } catch {
      // Already gone.
    }
  }

  /** Swap in a newer token for the same user and document, applying later access changes. */
  private async refreshToken(ws: WebSocket, attachment: Attachment, token: string): Promise<void> {
    const documentId = this.storage.documentId() ?? "";
    let claims;
    try {
      claims = await verifySyncToken(token, publicKeys(this.env), documentId);
    } catch {
      return this.reject(ws, CLOSE_UNAUTHENTICATED, "Invalid sync token");
    }
    if (claims.sub !== attachment.userId) return this.reject(ws, CLOSE_UNAUTHENTICATED, "Token for another user");
    const role = effectiveRole(claims, this.storage.getAccess(claims.sub));
    if (!role) return this.reject(ws, CLOSE_ACCESS_REVOKED, "Access removed");
    const changed = role !== attachment.role;
    Object.assign(attachment, { role, exp: claims.exp, name: claims.name, image: claims.image });
    ws.serializeAttachment(attachment);
    if (changed) this.send(ws, encodeRole(role));
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
    if (new URL(request.url).pathname.endsWith("/access")) return this.applyAccess(request);

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
    // The sidebar list reads the column: save before answering, so a reload
    // right after a rename shows the new title. If the save fails, the rename
    // reports failure (the alarm retries the save).
    this.snapshotUrgent = true;
    await this.alarm();
    return Response.json({ title: cleaned });
  }

  /**
   * Live access changes from the Next app: record them (so older tokens are
   * capped or refused) and adjust that user's open sockets at once.
   */
  private async applyAccess(request: Request): Promise<Response> {
    let changes: Array<{ userId: unknown; role: unknown; accessVersion: unknown }>;
    try {
      changes = ((await request.json()) as { changes?: typeof changes }).changes ?? [];
    } catch {
      return Response.json({ error: "Body must be JSON." }, { status: 400 });
    }
    for (const change of changes) {
      const { userId, role, accessVersion } = change;
      if (typeof userId !== "string" || typeof accessVersion !== "number") continue;
      if (role !== null && role !== "editor" && role !== "viewer") continue;
      if (!this.storage.setAccess(userId, role, accessVersion)) continue;
      for (const ws of this.ctx.getWebSockets()) {
        const attachment = ws.deserializeAttachment() as Attachment | null;
        if (!attachment || attachment.userId !== userId || attachment.role === "owner") continue;
        if (role === null) {
          this.reject(ws, CLOSE_ACCESS_REVOKED, "Access removed");
        } else if (attachment.role !== role) {
          attachment.role = role;
          ws.serializeAttachment(attachment);
          this.send(ws, encodeRole(role));
        }
      }
    }
    return new Response(null, { status: 204 });
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

      if (record.demoExpiresAt !== null && record.demoExpiresAt <= Date.now()) {
        result = "deleted";
        return;
      }

      const doc = this.buildDoc([record.state]);
      // Phase 1 documents have their title only in the Postgres column.
      const title = doc.getText(TITLE_FIELD);
      if (title.length === 0 && record.title !== "") title.insert(0, record.title);

      this.storage.initialize(documentId, Y.encodeStateAsUpdate(doc));
      if (record.demoExpiresAt !== null) {
        this.storage.setDemoExpiresAt(record.demoExpiresAt);
        // The only alarm a demo room ever sets: erase it when the demo ends.
        this.scheduleAlarm(record.demoExpiresAt);
      }
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

    const demo = this.storage.demoExpiresAt() !== null;
    if (this.pendingUpdates.length > 0) {
      this.storage.appendUpdate(Y.mergeUpdates(this.pendingUpdates));
      this.pendingUpdates = [];
      // A demo never goes to Postgres: no dirty mark, no snapshot alarm.
      if (!demo) this.storage.markDirty(Date.now());
      if (this.storage.updateCount() >= COMPACT_AFTER_BATCHES) {
        this.storage.writeSnapshot(Y.encodeStateAsUpdate(this.doc));
      }
      if (!demo) this.afterWrite();
    }

    // The output gate holds these until the write above is durable.
    for (const ws of this.pendingAcks) {
      const attachment = ws.deserializeAttachment() as Attachment | null;
      if (attachment) this.send(ws, encodeAck(attachment.received));
    }
    this.pendingAcks.clear();
    if (demo && this.demoFull()) this.closeFullDemo();
  }

  /** A demo room has reached its write or size limit. */
  private demoFull(): boolean {
    return this.storage.batchesWritten() >= DEMO_MAX_BATCHES || this.storage.storedBytes() >= DEMO_MAX_BYTES;
  }

  /** Close every socket of a full demo; the demo page offers a new one. */
  private closeFullDemo(): void {
    for (const ws of this.openSockets()) this.reject(ws, CLOSE_DEMO_LIMIT, "Demo limit reached");
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
    this.alarmSetFor = null;
    const demoUntil = this.storage.demoExpiresAt();
    if (demoUntil !== null) {
      if (Date.now() >= demoUntil) await this.deleteRoom();
      else this.scheduleAlarm(demoUntil);
      return;
    }
    const doc = this.doc;
    const documentId = this.storage.documentId();
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
    attachment?.awarenessIds.forEach((id) => {
      if (this.awarenessOwners.get(id) === ws) this.awarenessOwners.delete(id);
    });
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
  /** A newer schema version joined: close every socket running an older one. */
  private closeOlderThan(version: number): void {
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as Attachment | null;
      if ((attachment?.schema ?? 0) < version) this.reject(ws, CLOSE_CLIENT_OUTDATED, "Brahma was updated");
    }
  }

  private reject(ws: WebSocket, code: number, reason: string): void {
    logEvent("socket_closed", { code, reason });
    this.removeSocket(ws);
    try {
      ws.close(code, reason);
    } catch {
      // Already closed.
    }
  }
}
