/**
 * Where documents live outside the Durable Object: Postgres.
 *
 * The Durable Object reads a document once (first load, so Phase 1
 * documents carry over) and writes snapshots back. It is the only writer of
 * yjs_state and title, so no row lock is needed.
 */
export interface DocumentRecord {
  state: Uint8Array;
  title: string;
}

export interface SnapshotStore {
  /** Null when the document does not exist (never created, or deleted). */
  load(documentId: string): Promise<DocumentRecord | null>;
  /** Returns false when the row no longer exists. */
  save(documentId: string, record: DocumentRecord): Promise<boolean>;
}

/** In-memory store, selected with DATABASE_URL=memory: (tests). */
export class MemorySnapshotStore implements SnapshotStore {
  readonly rows = new Map<string, DocumentRecord>();
  saves = 0;
  failNextSave = false;

  async load(documentId: string): Promise<DocumentRecord | null> {
    const row = this.rows.get(documentId);
    return row ? { state: row.state.slice(), title: row.title } : null;
  }

  async save(documentId: string, record: DocumentRecord): Promise<boolean> {
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error("Simulated database failure");
    }
    this.saves += 1;
    if (!this.rows.has(documentId)) return false;
    this.rows.set(documentId, { state: record.state.slice(), title: record.title });
    return true;
  }
}

export const memoryStore = new MemorySnapshotStore();

export function createSnapshotStore(env: Env): SnapshotStore {
  if (env.DATABASE_URL.startsWith("memory:")) return memoryStore;
  throw new Error("Postgres snapshots are not configured yet.");
}
