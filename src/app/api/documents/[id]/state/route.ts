// Temporary exception: removed when saves move to the sync server.
// eslint-disable-next-line no-restricted-imports
import * as Y from "yjs";
import { isDocumentId } from "@/lib/ids";
import { applyDocumentUpdate } from "@/server/documents";

// This route is the only server code that loads Yjs, so the Node runtime
// holds a single copy. It is removed when saves move to the sync server.
function isValidUpdate(update: Uint8Array): boolean {
  if (update.byteLength === 0) return false;
  try {
    Y.decodeUpdate(update);
    return true;
  } catch {
    return false;
  }
}

function merge(stored: Uint8Array, incoming: Uint8Array): Uint8Array {
  return Y.mergeUpdates([stored, incoming]);
}

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

  const updatedAt = await applyDocumentUpdate(id, update, merge);
  if (!updatedAt) {
    return Response.json({ error: "Document not found." }, { status: 404 });
  }
  return Response.json({ updatedAt });
}
