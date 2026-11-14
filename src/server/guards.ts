import "server-only";
import { isDocumentId } from "@/lib/ids";
import { type Action, can } from "@/lib/permissions";
import { type Access, getAccess } from "./authz";
import { type CurrentUser, getCurrentUser } from "./session";

/** Copy for a document the user may not see: identical to "does not exist". */
export const NO_SUCH_DOCUMENT = "This document doesn't exist.";
export const NOT_ALLOWED = "You don't have permission to do that.";
export const SIGN_IN_REQUIRED = "Sign in to continue.";

export type Guarded<T> = { ok: true; value: T } | { ok: false; error: string };

export async function guardUser(): Promise<Guarded<CurrentUser>> {
  const user = await getCurrentUser();
  return user ? { ok: true, value: user } : { ok: false, error: SIGN_IN_REQUIRED };
}

/**
 * Every server action and route that touches a document starts here. No
 * access at all reads as "does not exist", so probing ids learns nothing;
 * access without the right role reads as "not allowed".
 */
export async function guardDocument(
  documentId: unknown,
  action: Action,
): Promise<Guarded<{ user: CurrentUser; access: Access }>> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: SIGN_IN_REQUIRED };
  if (typeof documentId !== "string" || !isDocumentId(documentId)) return { ok: false, error: NO_SUCH_DOCUMENT };
  const access = await getAccess(user.id, documentId);
  if (!access) return { ok: false, error: NO_SUCH_DOCUMENT };
  if (!can(access.role, action)) return { ok: false, error: NOT_ALLOWED };
  return { ok: true, value: { user, access } };
}
