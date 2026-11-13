import "client-only";
import { TITLE_FIELD } from "@brahma/protocol";
import * as Y from "yjs";
import type { LocalStore } from "./local-store";
import { encodeStateVectorMap } from "./state-vector";

/** Rebuild a document's local copy (snapshot, acknowledged and pending updates). */
export async function loadLocalCopy(store: LocalStore, docId: string): Promise<{ doc: Y.Doc; pendingCount: number }> {
  const loaded = await store.loadDocument(docId);
  const doc = new Y.Doc();
  for (const update of loaded.base) Y.applyUpdate(doc, update);
  for (const row of loaded.pending) Y.applyUpdate(doc, row.update);
  return { doc, pendingCount: loaded.pending.length };
}

/**
 * Split a document's full state into one update per Yjs client, so no
 * single queued edit carries the whole document. Applying them all in any
 * order rebuilds the document.
 */
export function stateByClient(doc: Y.Doc): Uint8Array[] {
  const vector = Y.decodeStateVector(Y.encodeStateVector(doc));
  const updates: Uint8Array[] = [];
  vector.forEach((_clock, client) => {
    // Pretend the other side has every other client's content.
    const target = new Map(vector);
    target.set(client, 0);
    updates.push(Y.encodeStateAsUpdate(doc, encodeStateVectorMap(target)));
  });
  return updates;
}

/**
 * Move the local copy of a deleted document into a new, empty document:
 * its content becomes pending edits of the new document, which the normal
 * offline flush uploads. The old copy is removed only after the new one is
 * written.
 */
export async function moveLocalCopy(store: LocalStore, fromId: string, toId: string): Promise<void> {
  const { doc } = await loadLocalCopy(store, fromId);
  for (const update of stateByClient(doc)) await store.appendLocal(toId, update);
  await store.updateMeta(toId, { title: doc.getText(TITLE_FIELD).toString(), lastOpenedAt: Date.now() });
  await store.deleteDocument(fromId);
}
