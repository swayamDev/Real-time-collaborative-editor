import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { documents } from "@/db/schema";
import { emptyYjsState } from "@/lib/empty-yjs-state";

/** What the sidebar needs. Dates cross the server/client boundary as ISO strings. */
export interface DocumentSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface DocumentWithState extends DocumentSummary {
  state: Uint8Array;
  deleted: boolean;
}

const summaryColumns = {
  id: documents.id,
  title: documents.title,
  updatedAt: documents.updatedAt,
};

function toSummary(row: { id: string; title: string; updatedAt: Date }): DocumentSummary {
  return { id: row.id, title: row.title, updatedAt: row.updatedAt.toISOString() };
}

export async function listDocuments(): Promise<DocumentSummary[]> {
  const rows = await db()
    .select(summaryColumns)
    .from(documents)
    .where(isNull(documents.deletedAt))
    .orderBy(desc(documents.updatedAt), desc(documents.id));
  return rows.map(toSummary);
}

export async function getDocument(id: string): Promise<DocumentWithState | null> {
  const [row] = await db()
    .select({ ...summaryColumns, state: documents.yjsState, deletedAt: documents.deletedAt })
    .from(documents)
    .where(eq(documents.id, id));
  return row ? { ...toSummary(row), state: row.state, deleted: row.deletedAt !== null } : null;
}

/**
 * A new, empty document. The title only seeds the list; the sync server
 * copies the shared title over it on the first snapshot.
 */
export async function createDocument(title = ""): Promise<DocumentSummary> {
  const [row] = await db()
    .insert(documents)
    .values({ yjsState: emptyYjsState(), title })
    .returning(summaryColumns);
  return toSummary(row);
}

/**
 * Step one of a delete: write the tombstone. From this commit on the
 * document is deleted for every reader. Returns false if it did not exist
 * or was already deleted.
 */
export async function tombstoneDocument(id: string): Promise<boolean> {
  const rows = await db()
    .update(documents)
    .set({ deletedAt: sql`now()` })
    .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
    .returning({ id: documents.id });
  return rows.length > 0;
}
