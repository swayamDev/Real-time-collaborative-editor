/**
 * The Durable Object's own storage (SQLite). It holds the live document:
 *
 *   snapshot  the compacted Yjs state, split into chunks below the 2 MB row limit
 *   updates   batched updates appended since the last compaction
 *   meta      document id, and when the oldest edit not yet in Postgres happened
 *
 * Writes are synchronous and become durable before any message sent after
 * them leaves the Durable Object (the output gate), so an ack sent after a
 * write means the data is stored.
 */

const CHUNK_BYTES = 1_000_000;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export class RoomStorage {
  constructor(private readonly sql: SqlStorage) {
    sql.exec("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS snapshot (chunk INTEGER PRIMARY KEY, data BLOB NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS updates (seq INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL)");
    // Latest known access per user, from the Next app. role NULL means removed.
    sql.exec("CREATE TABLE IF NOT EXISTS access (user_id TEXT PRIMARY KEY, role TEXT, version INTEGER NOT NULL)");
  }

  /** The most recent access change for a user, if the room has heard of one. */
  getAccess(userId: string): { role: "editor" | "viewer" | null; version: number } | null {
    const rows = this.sql
      .exec<{ role: string | null; version: number }>("SELECT role, version FROM access WHERE user_id = ?", userId)
      .toArray();
    if (rows.length === 0) return null;
    return { role: rows[0].role as "editor" | "viewer" | null, version: rows[0].version };
  }

  /** Record an access change; an older version than the one stored is ignored. */
  setAccess(userId: string, role: "editor" | "viewer" | null, version: number): boolean {
    const current = this.getAccess(userId);
    if (current && current.version >= version) return false;
    this.sql.exec("INSERT OR REPLACE INTO access (user_id, role, version) VALUES (?, ?, ?)", userId, role, version);
    return true;
  }

  private getMeta(key: string): string | null {
    const rows = this.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = ?", key).toArray();
    return rows[0]?.value ?? null;
  }

  private setMeta(key: string, value: string | null): void {
    if (value === null) this.sql.exec("DELETE FROM meta WHERE key = ?", key);
    else this.sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", key, value);
  }

  /** The document this room belongs to, once it has been loaded. */
  documentId(): string | null {
    return this.getMeta("document_id");
  }

  isInitialized(): boolean {
    return this.documentId() !== null;
  }

  /** First load: remember the id and store the initial state. */
  initialize(documentId: string, state: Uint8Array): void {
    this.setMeta("document_id", documentId);
    this.writeSnapshot(state);
  }

  /** Snapshot plus every update since, in order. Apply all of them to rebuild the doc. */
  loadUpdates(): Uint8Array[] {
    const chunks = this.sql
      .exec<{ data: ArrayBuffer }>("SELECT data FROM snapshot ORDER BY chunk")
      .toArray()
      .map((row) => new Uint8Array(row.data));
    const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const snapshot = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      snapshot.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const updates = this.sql
      .exec<{ data: ArrayBuffer }>("SELECT data FROM updates ORDER BY seq")
      .toArray()
      .map((row) => new Uint8Array(row.data));
    return [snapshot, ...updates];
  }

  /** Replace the snapshot with a compacted state and drop the update log. */
  writeSnapshot(state: Uint8Array): void {
    this.sql.exec("DELETE FROM snapshot");
    let chunk = 0;
    for (let offset = 0; offset < state.byteLength || chunk === 0; offset += CHUNK_BYTES) {
      this.sql.exec(
        "INSERT INTO snapshot (chunk, data) VALUES (?, ?)",
        chunk,
        toArrayBuffer(state.subarray(offset, offset + CHUNK_BYTES)),
      );
      chunk += 1;
    }
    this.sql.exec("DELETE FROM updates");
  }

  appendUpdate(update: Uint8Array): void {
    this.sql.exec("INSERT INTO updates (data) VALUES (?)", toArrayBuffer(update));
  }

  updateCount(): number {
    return this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM updates").one().n;
  }

  /** When the oldest edit not yet copied to Postgres happened, if any. */
  dirtySince(): number | null {
    const value = this.getMeta("dirty_since");
    return value === null ? null : Number(value);
  }

  markDirty(now: number): void {
    if (this.dirtySince() === null) this.setMeta("dirty_since", String(now));
  }

  clearDirty(): void {
    this.setMeta("dirty_since", null);
  }
}
