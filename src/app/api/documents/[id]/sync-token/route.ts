import { TOKEN_TTL_SECONDS } from "@brahma/protocol";
import { isDocumentId } from "@/lib/ids";
import { auth } from "@/server/auth";
import { getAccess } from "@/server/authz";
import { allow } from "@/server/rate-limit";
import { isSameOrigin } from "@/server/same-origin";
import { issueSyncToken } from "@/server/sync-token";

/**
 * A short-lived token for the sync server, issued right before opening the
 * socket and again to refresh it. Answers:
 *   200 { token, role, expiresIn }
 *   401 not signed in          403 cross-site request
 *   404 no access (same answer as a missing document)
 *   410 deleted (only to someone who had access)
 *   429 too many tokens for this document
 */
export async function POST(request: Request, ctx: RouteContext<"/api/documents/[id]/sync-token">) {
  if (!isSameOrigin(request)) return Response.json({ error: "Forbidden" }, { status: 403 });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Sign in to continue." }, { status: 401 });

  const { id } = await ctx.params;
  if (!isDocumentId(id)) return Response.json({ error: "Not found" }, { status: 404 });
  const access = await getAccess(session.user.id, id, { includeDeleted: true });
  if (!access) return Response.json({ error: "Not found" }, { status: 404 });
  // Only someone who had access learns that it was deleted.
  if (access.deleted) return Response.json({ error: "Deleted" }, { status: 410 });
  if (!(await allow("syncToken", `${session.user.id}:${id}`))) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }

  const { id: userId, name, email, image } = session.user;
  const { token } = await issueSyncToken({ id: userId, name, email, image: image ?? null }, id, access);
  return Response.json(
    { token, role: access.role, expiresIn: TOKEN_TTL_SECONDS },
    { headers: { "Cache-Control": "no-store" } },
  );
}
