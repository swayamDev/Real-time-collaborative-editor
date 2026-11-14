import type { LocalStore } from "./local-store";

/**
 * Drop local copies of documents the user can no longer open (access
 * removed, or deleted, while this device was away). A copy that still holds
 * edits the server never received is kept: opening it shows revoke or
 * delete handling, with a way to keep those edits. Returns the ids removed.
 */
export async function pruneInaccessible(store: LocalStore, accessible: ReadonlySet<string>): Promise<string[]> {
  const removed: string[] = [];
  for (const meta of await store.listDocuments()) {
    if (accessible.has(meta.id) || meta.pendingCount > 0) continue;
    await store.deleteDocument(meta.id);
    removed.push(meta.id);
  }
  return removed;
}
