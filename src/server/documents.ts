import "server-only";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { documentMembers, documents } from "@/db/schema";
import { emptyYjsState } from "@/lib/empty-yjs-state";
import type { Role } from "@/lib/permissions";

/** What the sidebar needs. Dates cross the server/client boundary as ISO strings. */
export interface DocumentSummary {
  id: string;
  title: string;
  updatedAt: string;
  /** The current user's role on this document. */
  role: Role;
}

export interface DocumentWithState extends DocumentSummary {
  state: Uint8Array;
  deleted: boolean;
}

export interface DocumentLists {
  mine: DocumentSummary[];
  shared: DocumentSummary[];
}

const summaryColumns = {
  id: documents.id,
  title: documents.title,
  updatedAt: documents.updatedAt,
};

function toSummary(row: { id: string; title: string; updatedAt: Date }, role: Role): DocumentSummary {
  return { id: row.id, title: row.title, updatedAt: row.updatedAt.toISOString(), role };
}

/** "My documents" (owned) and "Shared with me" (any live membership), newest edit first. */
export async function listDocumentsFor(userId: string): Promise<DocumentLists> {
  const [owned, shared] = await Promise.all([
    db()
      .select(summaryColumns)
      .from(documents)
      .where(and(eq(documents.ownerId, userId), isNull(documents.deletedAt)))
      .orderBy(desc(documents.updatedAt), desc(documents.id)),
    db()
      .select({ ...summaryColumns, role: documentMembers.role })
      .from(documentMembers)
      .innerJoin(documents, eq(documents.id, documentMembers.documentId))
      .where(and(eq(documentMembers.userId, userId), ne(documentMembers.role, "none"), isNull(documents.deletedAt)))
      .orderBy(desc(documents.updatedAt), desc(documents.id)),
  ]);
  return {
    mine: owned.map((row) => toSummary(row, "owner")),
    shared: shared.map((row) => toSummary(row, row.role as Role)),
  };
}

/** A document with its content, as seen by a user who has `role` on it. */
export async function getDocument(id: string, role: Role): Promise<DocumentWithState | null> {
  const [row] = await db()
    .select({ ...summaryColumns, state: documents.yjsState, deletedAt: documents.deletedAt })
    .from(documents)
    .where(eq(documents.id, id));
  return row ? { ...toSummary(row, role), state: row.state, deleted: row.deletedAt !== null } : null;
}

/**
 * A new, empty document owned by `ownerId`. The title only seeds the list;
 * the sync server copies the shared title over it on the first snapshot.
 */
export async function createDocument(ownerId: string, title = ""): Promise<DocumentSummary> {
  const [row] = await db()
    .insert(documents)
    .values({ yjsState: emptyYjsState(), title, ownerId })
    .returning(summaryColumns);
  return toSummary(row, "owner");
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
