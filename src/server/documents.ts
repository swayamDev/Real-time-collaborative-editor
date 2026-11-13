import "server-only";
import { desc, eq, sql } from "drizzle-orm";
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
    .orderBy(desc(documents.updatedAt), desc(documents.id));
  return rows.map(toSummary);
}

export async function getDocument(id: string): Promise<DocumentWithState | null> {
  const [row] = await db()
    .select({ ...summaryColumns, state: documents.yjsState })
    .from(documents)
    .where(eq(documents.id, id));
  return row ? { ...toSummary(row), state: row.state } : null;
}

export async function createDocument(): Promise<DocumentSummary> {
  const [row] = await db()
    .insert(documents)
    .values({ yjsState: emptyYjsState() })
    .returning(summaryColumns);
  return toSummary(row);
}

/** Renaming counts as an edit, so it moves the document to the top of the list. */
export async function renameDocument(id: string, title: string): Promise<DocumentSummary | null> {
  const [row] = await db()
    .update(documents)
    .set({ title, updatedAt: sql`now()` })
    .where(eq(documents.id, id))
    .returning(summaryColumns);
  return row ? toSummary(row) : null;
}

export async function deleteDocument(id: string): Promise<boolean> {
  const rows = await db().delete(documents).where(eq(documents.id, id)).returning({ id: documents.id });
  return rows.length > 0;
}

/**
 * Merge a client update into the stored state.
 *
 * The row is locked for the duration of the read-merge-write so concurrent
 * saves (two tabs today, two people in Phase 2) never overwrite each other.
 * Returns the new `updatedAt`, or null when the document does not exist.
 */
export async function applyDocumentUpdate(
  id: string,
  update: Uint8Array,
  // Passed in by the route handler so this shared module never imports Yjs.
  merge: (stored: Uint8Array, incoming: Uint8Array) => Uint8Array,
): Promise<string | null> {
  return db().transaction(async (tx) => {
    const [row] = await tx
      .select({ state: documents.yjsState })
      .from(documents)
      .where(eq(documents.id, id))
      .for("update");
    if (!row) return null;

    const [saved] = await tx
      .update(documents)
      .set({ yjsState: merge(row.state, update), updatedAt: sql`now()` })
      .where(eq(documents.id, id))
      .returning({ updatedAt: documents.updatedAt });
    return saved.updatedAt.toISOString();
  });
}
