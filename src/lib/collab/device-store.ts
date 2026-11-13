import { LocalStore } from "./local-store";

let storePromise: Promise<LocalStore | null> | null = null;

/**
 * The device store, opened once per page. Null when IndexedDB is not
 * available (some private browsing modes): the editor then works online
 * only, keeping edits in memory until the server acknowledges them.
 *
 * Free of Yjs, so sidebar code can use it without pulling Yjs into the
 * server render.
 */
export function getLocalStore(): Promise<LocalStore | null> {
  storePromise ??= LocalStore.open().catch((error: unknown) => {
    console.warn("IndexedDB is unavailable; edits will not be kept on this device", error);
    return null;
  });
  return storePromise;
}
