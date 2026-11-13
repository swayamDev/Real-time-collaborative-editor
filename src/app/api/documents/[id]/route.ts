import { isDocumentId } from "@/lib/ids";
import { validateTitle } from "@/lib/title";
import { renameInSync } from "@/server/sync";

/** Rename from the editor's title field. Accepts JSON: { "title": string }. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/documents/[id]">) {
  const { id } = await ctx.params;
  if (!isDocumentId(id)) {
    return Response.json({ error: "Document not found." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const result = validateTitle((body as { title?: unknown } | null)?.title);
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  try {
    const title = await renameInSync(id, result.title);
    return Response.json({ id, title, updatedAt: new Date().toISOString() });
  } catch {
    return Response.json({ error: "Couldn't rename. Try again." }, { status: 502 });
  }
}
