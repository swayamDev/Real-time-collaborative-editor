import "server-only";
import { desc, eq } from "drizzle-orm";
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

/**
 * Delete the row, but only commit if `beforeCommit` succeeds. The delete
 * holds the row while the sync server erases its live copy; if that call
 * fails, the transaction rolls back and nothing changes.
 */
export async function deleteDocument(id: string, beforeCommit: () => Promise<void>): Promise<boolean> {
  return db().transaction(async (tx) => {
    const rows = await tx.delete(documents).where(eq(documents.id, id)).returning({ id: documents.id });
    if (rows.length === 0) return false;
    await beforeCommit();
    return true;
  });
}
