import { isDocumentId } from "@/lib/ids";
import { isValidUpdate } from "@/lib/yjs";
import { applyDocumentUpdate } from "@/server/documents";

// Generous upper bound for one save. Typical deltas are a few hundred bytes.
const MAX_UPDATE_BYTES = 10 * 1024 * 1024;

/**
 * Save a Yjs update. The body is the raw binary output of
 * Y.encodeStateAsUpdate(doc, lastAckedStateVector).
 */
export async function POST(request: Request, ctx: RouteContext<"/api/documents/[id]/state">) {
  const { id } = await ctx.params;
  if (!isDocumentId(id)) {
    return Response.json({ error: "Document not found." }, { status: 404 });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_UPDATE_BYTES) {
    return Response.json({ error: "Update is too large." }, { status: 413 });
  }

  const update = new Uint8Array(await request.arrayBuffer());
  if (update.byteLength > MAX_UPDATE_BYTES) {
    return Response.json({ error: "Update is too large." }, { status: 413 });
  }
  if (!isValidUpdate(update)) {
    return Response.json({ error: "Update is not valid." }, { status: 400 });
  }

  const updatedAt = await applyDocumentUpdate(id, update);
  if (!updatedAt) {
    return Response.json({ error: "Document not found." }, { status: 404 });
  }
  return Response.json({ updatedAt });
}
