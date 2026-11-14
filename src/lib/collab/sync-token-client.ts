import type { Role } from "../permissions";

export type TokenResult =
  | { kind: "ok"; token: string; role: Role; expiresIn: number }
  /** No session: the user signed out or the session expired. */
  | { kind: "signed-out" }
  /** The user has no access (or the document never existed). */
  | { kind: "no-access" }
  | { kind: "deleted" }
  /** Offline, rate limited or a server error: try again later. */
  | { kind: "unavailable" };

const ROLES: readonly Role[] = ["owner", "editor", "viewer"];

/** Ask the app for a short-lived sync token, right before connecting or to refresh. */
export async function fetchSyncToken(documentId: string, fetchImpl: typeof fetch = fetch): Promise<TokenResult> {
  let response: Response;
  try {
    response = await fetchImpl(`/api/documents/${encodeURIComponent(documentId)}/sync-token`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { kind: "unavailable" };
  }
  if (response.status === 401) return { kind: "signed-out" };
  if (response.status === 404) return { kind: "no-access" };
  if (response.status === 410) return { kind: "deleted" };
  if (!response.ok) return { kind: "unavailable" };
  try {
    const body = (await response.json()) as { token?: unknown; role?: unknown; expiresIn?: unknown };
    if (
      typeof body.token !== "string" ||
      !ROLES.includes(body.role as Role) ||
      typeof body.expiresIn !== "number" ||
      body.expiresIn <= 0
    ) {
      return { kind: "unavailable" };
    }
    return { kind: "ok", token: body.token, role: body.role as Role, expiresIn: body.expiresIn };
  } catch {
    return { kind: "unavailable" };
  }
}
