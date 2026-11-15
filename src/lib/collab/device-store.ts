import { userDatabase } from "../device-data";
import { LocalStore } from "./local-store";

const stores = new Map<string, Promise<LocalStore | null>>();
/** Set once this page has removed the user's data: nothing may reopen it. */
let locked = false;

/** An open document that writes to the device store (LocalDocument, kept Yjs-free here). */
export interface DeviceDocument {
  readonly docId: string;
  /** Stop all writes to the device for this document; resolves once in-flight writes settle. */
  dispose(): Promise<void>;
}

const openDocuments = new Set<DeviceDocument>();

/**
 * The signed-in user's device store, opened once per page. Each user has
 * their own database, so one person's documents and offline edits are
 * never visible to another. Null when IndexedDB is not available (some
 * private browsing modes): the editor then works online only, keeping
 * edits in memory until the server acknowledges them.
 *
 * Free of Yjs, so sidebar code can use it without pulling Yjs into the
 * server render.
 */
export function getLocalStore(userId: string): Promise<LocalStore | null> {
  if (locked) return Promise.resolve(null);
  let store = stores.get(userId);
  if (!store) {
    store = LocalStore.open(indexedDB, userDatabase(userId)).catch((error: unknown) => {
      console.warn("IndexedDB is unavailable; edits will not be kept on this device", error);
      return null;
    });
    stores.set(userId, store);
  }
  return store;
}

/** Register a document open in this page, so discarding it stops its writes first. Returns the unregister function. */
export function trackDocument(document: DeviceDocument): () => void {
  openDocuments.add(document);
  return () => openDocuments.delete(document);
}

/** Stop the writes of every open document in this page (all of them, or one document's). */
export async function disposeDocuments(docId?: string): Promise<void> {
  const matching = [...openDocuments].filter((document) => docId === undefined || document.docId === docId);
  await Promise.all(matching.map((document) => document.dispose()));
}

/**
 * Remove a document's copy from this device: the one path for access
 * removed, deleted on the server, and discarding an offline copy. Open
 * documents stop writing first, so nothing in this page writes after the
 * delete; the store refuses any write that still arrives (another tab, a
 * late reply) because the record is gone. Problems are reported, not thrown.
 */
export async function discardLocalCopy(userId: string, docId: string): Promise<void> {
  await disposeDocuments(docId);
  const store = await getLocalStore(userId);
  if (!store) {
    console.warn("No local store is open, so this device's copy of the document was not cleared.");
    return;
  }
  await store.deleteDocument(docId).catch((error: unknown) => {
    console.warn("Could not clear this device's copy of the document", error);
  });
}

/**
 * Close every open store, so its database can be deleted (sign-out, or
 * someone else signed in). Open documents stop writing first. With `lock`,
 * no store opens again in this page (it would recreate the database).
 */
export async function closeLocalStores({ lock = false } = {}): Promise<void> {
  if (lock) locked = true;
  await disposeDocuments();
  const open = [...stores.values()];
  stores.clear();
  for (const store of open) (await store)?.close();
}
