/**
 * Documents on this device, in IndexedDB.
 *
 * Database "brahma", version 1:
 *
 *   documents  { id, title, everSynced, lastOpenedAt, pendingCount, halted }
 *              Metadata for the sidebar and the offline document list.
 *   states     { docId, state }   compacted Yjs state per document
 *   updates    { seq, docId, update }   updates since the last compaction
 *              that the server already has (remote edits, acked local edits)
 *   pending    { seq, docId, update, bytes }   local edits the server has
 *              not acknowledged, in the order they were made
 *
 * A document's content is states + updates + pending, applied in that
 * order. Writes that hold edits use durability "strict", so a write that
 * completed survives a browser or operating system crash.
 */

export const DB_NAME = "brahma";
/** Every tab hears about metadata changes here (pending counts, titles, deletions). */
export const STORE_CHANNEL = "brahma-store";
const DB_VERSION = 1;

export interface DocumentMeta {
  id: string;
  title: string;
  /** Synced with the server at least once on this device. */
  everSynced: boolean;
  lastOpenedAt: number;
  /** Local edits not yet acknowledged by the server. */
  pendingCount: number;
  /** Sync stopped because the server refused an edit (kept on the device). */
  halted: boolean;
  /** The user's role when last seen online; offline lists use it to group documents. */
  role?: "owner" | "editor" | "viewer";
}

export interface PendingRow {
  seq: number;
  docId: string;
  update: Uint8Array;
  bytes: number;
}

export interface LoadedDocument {
  meta: DocumentMeta | null;
  /** Compacted state and acknowledged updates. */
  base: Uint8Array[];
  /** Unacknowledged local edits, oldest first. */
  pending: PendingRow[];
}

/** The device is out of storage for this site. */
export class StorageFullError extends Error {
  override name = "StorageFullError";
}

const STRICT: IDBTransactionOptions = { durability: "strict" };

function emptyMeta(id: string): DocumentMeta {
  return { id, title: "", everSynced: false, lastOpenedAt: 0, pendingCount: 0, halted: false };
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function toStorageError(error: DOMException | Error | null): Error {
  if (error && error.name === "QuotaExceededError") return new StorageFullError("Storage is full");
  return error ?? new Error("IndexedDB transaction failed");
}

/**
 * Resolves when the transaction commits; rejects on error or abort. Call it
 * right after creating the transaction: a short transaction can commit
 * before a later await gets to attach the handlers.
 */
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(toStorageError(tx.error));
    tx.onabort = () => reject(toStorageError(tx.error));
  });
}

function bytesOf(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error("Stored update is not binary");
}

/** Copy into a standalone buffer; IndexedDB clones the whole backing buffer otherwise. */
function standalone(bytes: Uint8Array): Uint8Array {
  return bytes.slice();
}

export class LocalStore {
  private readonly channel: BroadcastChannel | null =
    typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(STORE_CHANNEL);

  private constructor(private readonly db: IDBDatabase) {}

  /** Tell every tab (this one included) that a document's metadata changed. */
  private announce(docId: string): void {
    this.channel?.postMessage({ docId });
  }

  static async open(factory: IDBFactory = indexedDB, name = DB_NAME): Promise<LocalStore> {
    const req = factory.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore("documents", { keyPath: "id" });
      db.createObjectStore("states", { keyPath: "docId" });
      db.createObjectStore("updates", { keyPath: "seq", autoIncrement: true }).createIndex("docId", "docId");
      db.createObjectStore("pending", { keyPath: "seq", autoIncrement: true }).createIndex("docId", "docId");
    };
    const db = await request(req);
    // Another tab is deleting this database (sign-out, or someone else signed
    // in): let it. That tab also tells this one to reload.
    db.onversionchange = () => db.close();
    return new LocalStore(db);
  }

  close(): void {
    this.channel?.close();
    this.db.close();
  }

  private async readMeta(store: IDBObjectStore, docId: string): Promise<DocumentMeta> {
    return ((await request(store.get(docId))) as DocumentMeta | undefined) ?? emptyMeta(docId);
  }

  async loadDocument(docId: string): Promise<LoadedDocument> {
    const tx = this.db.transaction(["documents", "states", "updates", "pending"], "readonly");
    const finished = done(tx);
    const [meta, state, updates, pending] = await Promise.all([
      request(tx.objectStore("documents").get(docId)) as Promise<DocumentMeta | undefined>,
      request(tx.objectStore("states").get(docId)) as Promise<{ state: Uint8Array } | undefined>,
      request(tx.objectStore("updates").index("docId").getAll(docId)) as Promise<Array<{ seq: number; update: Uint8Array }>>,
      request(tx.objectStore("pending").index("docId").getAll(docId)) as Promise<PendingRow[]>,
    ]);
    await finished;
    return {
      meta: meta ?? null,
      base: [
        ...(state ? [bytesOf(state.state)] : []),
        ...updates.sort((a, b) => a.seq - b.seq).map((row) => bytesOf(row.update)),
      ],
      pending: pending.sort((a, b) => a.seq - b.seq).map((row) => ({ ...row, update: bytesOf(row.update) })),
    };
  }

  /** Store a local edit as pending. Resolves with its sequence number once durable. */
  async appendLocal(docId: string, update: Uint8Array): Promise<number> {
    const tx = this.db.transaction(["pending", "documents"], "readwrite", STRICT);
    const finished = done(tx);
    // Wrap requests in promises as they are made; a request that already
    // succeeded will not fire its event again.
    const seqPromise = request(
      tx.objectStore("pending").add({ docId, update: standalone(update), bytes: update.byteLength }),
    );
    const documents = tx.objectStore("documents");
    const meta = await this.readMeta(documents, docId);
    documents.put({ ...meta, pendingCount: meta.pendingCount + 1 });
    const seq = (await seqPromise) as number;
    await finished;
    this.announce(docId);
    return seq;
  }

  /** Store updates the server already has (remote edits). */
  async appendRemote(docId: string, update: Uint8Array): Promise<void> {
    const tx = this.db.transaction(["updates"], "readwrite", STRICT);
    const finished = done(tx);
    tx.objectStore("updates").add({ docId, update: standalone(update) });
    await finished;
  }

  async listPending(docId: string): Promise<PendingRow[]> {
    const tx = this.db.transaction(["pending"], "readonly");
    const finished = done(tx);
    const rows = (await request(tx.objectStore("pending").index("docId").getAll(docId))) as PendingRow[];
    await finished;
    return rows.sort((a, b) => a.seq - b.seq).map((row) => ({ ...row, update: bytesOf(row.update) }));
  }

  /**
   * The server acknowledged these edits: move them from pending to updates
   * in one transaction, so they never disappear from the local copy.
   */
  async acknowledge(docId: string, seqs: readonly number[]): Promise<void> {
    if (seqs.length === 0) return;
    const tx = this.db.transaction(["pending", "updates", "documents"], "readwrite", STRICT);
    const finished = done(tx);
    const pending = tx.objectStore("pending");
    const updates = tx.objectStore("updates");
    let moved = 0;
    for (const seq of seqs) {
      const row = (await request(pending.get(seq))) as PendingRow | undefined;
      // Another tab may have acknowledged it already.
      if (!row || row.docId !== docId) continue;
      updates.add({ docId, update: row.update });
      pending.delete(seq);
      moved += 1;
    }
    const documents = tx.objectStore("documents");
    const meta = await this.readMeta(documents, docId);
    documents.put({ ...meta, pendingCount: Math.max(0, meta.pendingCount - moved) });
    await finished;
    this.announce(docId);
  }

  async updateCount(docId: string): Promise<number> {
    const tx = this.db.transaction(["updates"], "readonly");
    const finished = done(tx);
    const count = await request(tx.objectStore("updates").index("docId").count(docId));
    await finished;
    return count;
  }

  /**
   * Fold the snapshot and every acknowledged update into one snapshot, as a
   * single atomic transaction: rows are read and deleted in the same
   * transaction that writes the result, so an update added concurrently is
   * either folded in or left untouched, never lost. `merge` must be
   * synchronous (it runs between IndexedDB requests). Pending rows are not
   * touched; they still have to reach the server.
   */
  async compact(docId: string, merge: (updates: Uint8Array[]) => Uint8Array): Promise<void> {
    const tx = this.db.transaction(["states", "updates"], "readwrite", STRICT);
    const finished = done(tx);
    const states = tx.objectStore("states");
    const updates = tx.objectStore("updates");
    const [state, rows] = await Promise.all([
      request(states.get(docId)) as Promise<{ state: Uint8Array } | undefined>,
      request(updates.index("docId").getAll(docId)) as Promise<Array<{ seq: number; update: Uint8Array }>>,
    ]);
    if (rows.length > 0) {
      const ordered = rows.sort((a, b) => a.seq - b.seq);
      let merged: Uint8Array;
      try {
        merged = merge([...(state ? [bytesOf(state.state)] : []), ...ordered.map((row) => bytesOf(row.update))]);
      } catch (error) {
        tx.abort();
        await finished.catch(() => {});
        throw error;
      }
      states.put({ docId, state: standalone(merged) });
      for (const row of ordered) updates.delete(row.seq);
    }
    await finished;
  }

  async getMeta(docId: string): Promise<DocumentMeta | null> {
    const tx = this.db.transaction(["documents"], "readonly");
    const finished = done(tx);
    const meta = (await request(tx.objectStore("documents").get(docId))) as DocumentMeta | undefined;
    await finished;
    return meta ?? null;
  }

  async updateMeta(docId: string, patch: Partial<Omit<DocumentMeta, "id" | "pendingCount">>): Promise<DocumentMeta> {
    const tx = this.db.transaction(["documents"], "readwrite");
    const finished = done(tx);
    const documents = tx.objectStore("documents");
    const next = { ...(await this.readMeta(documents, docId)), ...patch, id: docId };
    documents.put(next);
    await finished;
    this.announce(docId);
    return next;
  }

  async listDocuments(): Promise<DocumentMeta[]> {
    const tx = this.db.transaction(["documents"], "readonly");
    const finished = done(tx);
    const rows = (await request(tx.objectStore("documents").getAll())) as DocumentMeta[];
    await finished;
    return rows;
  }

  /** Remove everything this device holds for a document. */
  async deleteDocument(docId: string): Promise<void> {
    const tx = this.db.transaction(["documents", "states", "updates", "pending"], "readwrite", STRICT);
    const finished = done(tx);
    tx.objectStore("documents").delete(docId);
    tx.objectStore("states").delete(docId);
    for (const name of ["updates", "pending"] as const) {
      const store = tx.objectStore(name);
      const keys = await request(store.index("docId").getAllKeys(docId));
      for (const key of keys) store.delete(key);
    }
    await finished;
    this.announce(docId);
  }
}
