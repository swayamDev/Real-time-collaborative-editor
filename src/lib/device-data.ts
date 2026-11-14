/**
 * What Brahma keeps on a device, per user, and how it is cleaned up.
 *
 *   IndexedDB         brahma:<userId>               documents and offline edits
 *   Cache Storage     brahma-pages:<build>:<userId> pages kept for offline use
 *   Phase 3 leftovers brahma (database), brahma-pages-<build> (cache),
 *                     brahma-name and brahma-guest (cookies)
 *
 * Sign-out deletes the user's data, but it does not always run: a session
 * can expire, or a tab can close while offline. So every signed-in page
 * load also deletes whatever on this device belongs to anyone else.
 */

export const LEGACY_DATABASE = "brahma";
export const SESSION_CHANNEL = "brahma-session";
const LEGACY_COOKIES = ["brahma-name", "brahma-guest"];

export function userDatabase(userId: string): string {
  return `brahma:${userId}`;
}

/** Databases on this device that belong to someone other than `userId`. */
export function foreignDatabases(names: readonly string[], userId: string): string[] {
  return names.filter((name) => name === LEGACY_DATABASE || (name.startsWith("brahma:") && name !== userDatabase(userId)));
}

/** Page caches that belong to someone other than `userId` ("" matches every page cache). */
export function foreignPageCaches(names: readonly string[], userId: string): string[] {
  return names.filter((name) => name.startsWith("brahma-pages") && !(userId && name.endsWith(`:${userId}`)));
}

export type SessionMessage = { type: "user"; userId: string } | { type: "signed-out"; userId: string };

/** The browser APIs cleanup needs; replaced in tests. */
export interface DeviceApis {
  indexedDB: IDBFactory | null;
  caches: CacheStorage | null;
  /** Tell the service worker who is signed in ("" for nobody). */
  tellServiceWorker: (userId: string) => void;
  postSession: (message: SessionMessage) => void;
  clearCookie: (name: string) => void;
}

export function browserApis(): DeviceApis {
  return {
    indexedDB: typeof indexedDB === "undefined" ? null : indexedDB,
    caches: typeof caches === "undefined" ? null : caches,
    tellServiceWorker: (userId) => {
      void navigator.serviceWorker?.ready.then((registration) =>
        registration.active?.postMessage({ type: "set-user", userId }),
      );
    },
    postSession: (message) => {
      if (typeof BroadcastChannel === "undefined") return;
      const channel = new BroadcastChannel(SESSION_CHANNEL);
      channel.postMessage(message);
      channel.close();
    },
    clearCookie: (name) => {
      document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
    },
  };
}

/**
 * Delete a database. Resolves once deleted, or once the deletion is queued
 * behind a connection another tab still holds (it completes when that tab
 * closes the connection, which LocalStore does on request).
 */
function deleteDatabase(factory: IDBFactory, name: string): Promise<void> {
  return new Promise((resolve) => {
    const request = factory.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

async function databaseNames(factory: IDBFactory): Promise<string[]> {
  // Not in every browser; without it only the legacy database is known by name.
  if (typeof factory.databases !== "function") return [LEGACY_DATABASE];
  const list = await factory.databases().catch(() => []);
  return list.map((info) => info.name).filter((name): name is string => typeof name === "string");
}

async function deletePageCaches(storage: CacheStorage, keepUserId: string): Promise<void> {
  for (const name of foreignPageCaches(await storage.keys(), keepUserId)) await storage.delete(name);
}

/**
 * Run on every signed-in page load: this device now belongs to `userId`.
 * Other users' databases and page caches go, and their open tabs reload.
 */
export async function claimDevice(userId: string, apis: DeviceApis = browserApis()): Promise<void> {
  // Tabs still showing someone else reload first, closing their connections.
  apis.postSession({ type: "user", userId });
  if (apis.indexedDB) {
    const factory = apis.indexedDB;
    await Promise.all(foreignDatabases(await databaseNames(factory), userId).map((name) => deleteDatabase(factory, name)));
  }
  if (apis.caches) await deletePageCaches(apis.caches, userId);
  LEGACY_COOKIES.forEach(apis.clearCookie);
  apis.tellServiceWorker(userId);
}

/** Sign-out: delete this user's data from the device. Call after closing local stores. */
export async function clearDevice(userId: string, apis: DeviceApis = browserApis()): Promise<void> {
  apis.postSession({ type: "signed-out", userId });
  if (apis.indexedDB) {
    const factory = apis.indexedDB;
    await Promise.all([userDatabase(userId), LEGACY_DATABASE].map((name) => deleteDatabase(factory, name)));
  }
  if (apis.caches) await deletePageCaches(apis.caches, "");
  LEGACY_COOKIES.forEach(apis.clearCookie);
  apis.tellServiceWorker("");
}
