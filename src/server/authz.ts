import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { documentMembers, documents } from "@/db/schema";
import type { Role } from "@/lib/permissions";

export interface Access {
  role: Role;
  /** Membership access version; 0 for the owner, whose access never changes. */
  accessVersion: number;
  /** Tombstoned. Only returned when asked for with includeDeleted. */
  deleted: boolean;
}

/**
 * A user's access to a live (not deleted) document, or null for none. "No
 * access" and "does not exist" are deliberately the same answer.
 */
export async function getAccess(
  userId: string,
  documentId: string,
  { includeDeleted = false }: { includeDeleted?: boolean } = {},
): Promise<Access | null> {
  const [row] = await db()
    .select({
      ownerId: documents.ownerId,
      deletedAt: documents.deletedAt,
      role: documentMembers.role,
      accessVersion: documentMembers.accessVersion,
    })
    .from(documents)
    .leftJoin(
      documentMembers,
      and(eq(documentMembers.documentId, documents.id), eq(documentMembers.userId, userId)),
    )
    .where(includeDeleted ? eq(documents.id, documentId) : and(eq(documents.id, documentId), isNull(documents.deletedAt)));
  if (!row) return null;
  const deleted = row.deletedAt !== null;
  if (row.ownerId === userId) return { role: "owner", accessVersion: 0, deleted };
  if (!row.role || row.role === "none") return null;
  return { role: row.role, accessVersion: row.accessVersion ?? 1, deleted };
}

export async function getRole(userId: string, documentId: string): Promise<Role | null> {
  return (await getAccess(userId, documentId))?.role ?? null;
}
