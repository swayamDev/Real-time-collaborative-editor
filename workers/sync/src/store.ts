import { Buffer } from "node:buffer";
import { Client } from "pg";

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

/**
 * A row as loaded: a live document, or a tombstone. `demoExpiresAt` (ms since
 * epoch) is set only for a demo document, and null for every real one.
 */
export type LoadedDocument = (DocumentRecord & { deleted: false; demoExpiresAt: number | null }) | { deleted: true };

export interface SnapshotStore {
  /** Null when there is no row; a tombstone when the document was deleted. */
  load(documentId: string): Promise<LoadedDocument | null>;
  /** Returns false when the row is gone or tombstoned. */
  save(documentId: string, record: DocumentRecord): Promise<boolean>;
}

/** In-memory store, selected with DATABASE_URL=memory: (tests). */
export class MemorySnapshotStore implements SnapshotStore {
  readonly rows = new Map<string, DocumentRecord & { deleted?: boolean; demoExpiresAt?: number }>();
  saves = 0;
  failNextSave = false;

  async load(documentId: string): Promise<LoadedDocument | null> {
    const row = this.rows.get(documentId);
    if (!row) return null;
    if (row.deleted) return { deleted: true };
    return { state: row.state.slice(), title: row.title, deleted: false, demoExpiresAt: row.demoExpiresAt ?? null };
  }

  async save(documentId: string, record: DocumentRecord): Promise<boolean> {
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error("Simulated database failure (expected: the retry test triggers it)");
    }
    this.saves += 1;
    if (!this.rows.has(documentId) || this.rows.get(documentId)!.deleted) return false;
    this.rows.set(documentId, { ...this.rows.get(documentId), state: record.state.slice(), title: record.title });
    return true;
  }
}

export const memoryStore = new MemorySnapshotStore();

export function createSnapshotStore(env: { DATABASE_URL: string }): SnapshotStore {
  if (env.DATABASE_URL.startsWith("memory:")) return memoryStore;
  return new PostgresSnapshotStore(env.DATABASE_URL);
}

/**
 * Postgres over TCP from the Worker.
 *
 * pg detects the Workers runtime and opens a raw TCP socket through
 * cloudflare:sockets (the nodejs_compat flag provides the Node APIs it needs).
 * Each call opens a short-lived connection, runs one statement and closes:
 * a room loads once and snapshots at most every few seconds, so pooling in
 * the Worker would buy little. In production DATABASE_URL is the Neon
 * pooled connection string, so many rooms share a few Postgres connections.
 * No transaction is needed: each room is the only writer of its row.
 */
export class PostgresSnapshotStore implements SnapshotStore {
  constructor(private readonly connectionString: string) {}

  private async withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
    const client = new Client({ connectionString: this.connectionString });
    await client.connect();
    try {
      return await run(client);
    } finally {
      await client.end().catch(() => {});
    }
  }

  load(documentId: string): Promise<LoadedDocument | null> {
    return this.withClient(async (client) => {
      const result = await client.query<{ yjs_state: Buffer; title: string; deleted: boolean; demo_expires_ms: string | null }>(
        "SELECT yjs_state, title, deleted_at IS NOT NULL AS deleted, " +
          "(extract(epoch FROM demo_expires_at) * 1000)::bigint AS demo_expires_ms FROM documents WHERE id = $1",
        [documentId],
      );
      const row = result.rows[0];
      if (!row) return null;
      if (row.deleted) return { deleted: true };
      const demoExpiresAt = row.demo_expires_ms === null ? null : Number(row.demo_expires_ms);
      return { state: new Uint8Array(row.yjs_state), title: row.title, deleted: false, demoExpiresAt };
    });
  }

  save(documentId: string, record: DocumentRecord): Promise<boolean> {
    return this.withClient(async (client) => {
      const result = await client.query(
        "UPDATE documents SET yjs_state = $2, title = $3, updated_at = now() WHERE id = $1 AND deleted_at IS NULL",
        [documentId, Buffer.from(record.state), record.title],
      );
      return (result.rowCount ?? 0) > 0;
    });
  }
}
