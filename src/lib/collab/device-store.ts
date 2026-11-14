import { userDatabase } from "../device-data";
import { LocalStore } from "./local-store";

const stores = new Map<string, Promise<LocalStore | null>>();

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

/** Close every open store, so its database can be deleted. */
export async function closeLocalStores(): Promise<void> {
  const open = [...stores.values()];
  stores.clear();
  for (const store of open) (await store)?.close();
}
