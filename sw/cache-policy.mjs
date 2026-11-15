// Cache naming and cleanup rules for the service worker. Pure, and unit
// tested (sw/cache-policy.test.ts); scripts/build-sw.mjs inlines this file
// into public/sw.js. Keep it free of imports and of anything but functions
// and constants.

export const USER_CACHE = "brahma-user";
export const USER_KEY = "/__brahma/user";
/** Set at activation of a new version; cleared once pages are refreshed for a confirmed user. */
export const REFRESH_KEY = "/__brahma/refresh-pending";
export const OFFLINE_URL = "/offline";

export function staticCacheName(version) {
  return `brahma-static-${version}`;
}

/**
 * Pages are kept per user, across versions: `brahma-pages:<userId>`. A page
 * holds the user's name and document list, so one user's copies are never
 * served to another. The client deletes other users' caches by the same
 * naming (src/lib/device-data.ts).
 */
export function pageCacheName(userId) {
  return `brahma-pages:${userId}`;
}

function isCurrentPageCache(name) {
  return /^brahma-pages:[^:]+$/.test(name);
}

function isStaticCache(name) {
  return name.startsWith("brahma-static-");
}

/**
 * When a new version activates: delete what no version needs (page caches
 * in an older naming, unknown brahma caches). Older static caches stay, so
 * tabs still running the previous version and page copies made by it keep
 * loading their files, until the pages are refreshed.
 */
export function cachesToDeleteOnActivate(names, version) {
  return names.filter(
    (name) =>
      name.startsWith("brahma-") &&
      name !== USER_CACHE &&
      name !== staticCacheName(version) &&
      !isStaticCache(name) &&
      !isCurrentPageCache(name),
  );
}

/** Whether activation found an earlier version's caches, so pages need refreshing. */
export function isUpdate(names, version) {
  return names.some((name) => (isStaticCache(name) && name !== staticCacheName(version)) || isCurrentPageCache(name));
}

/** Static caches of earlier versions: deleted once pages are refreshed. */
export function staleStaticCaches(names, version) {
  return names.filter((name) => isStaticCache(name) && name !== staticCacheName(version));
}

/** Page caches that are not `keepUser`'s ("" means every page cache). */
export function pageCachesToDelete(names, keepUser) {
  return names.filter((name) => name.startsWith("brahma-pages") && !(keepUser && name === pageCacheName(keepUser)));
}

/**
 * After an update, refresh the signed-in user's page copies so they use the
 * new version's files, then drop the earlier versions' static caches.
 *
 * Gated like the client's cleanup: only for a user the server confirms
 * right now, never for whoever a page or the worker last believed. Returns
 * why it stopped:
 *   "unconfirmed"  the server does not confirm userId (or cannot be asked): nothing touched
 *   "offline"      a page could not be fetched: old copies and old files kept, try again later
 *   "signed-out"   a page redirected (the session ended): nothing more touched
 *   "done"         every page refreshed (or dropped if it no longer exists), old files deleted
 */
export async function refreshAfterUpdate(userId, io) {
  if (!userId || (await io.confirmUser().catch(() => null)) !== userId) return "unconfirmed";
  for (const url of await io.listPages(userId)) {
    let response;
    try {
      response = await io.fetchPage(url);
    } catch {
      return "offline";
    }
    if (response.redirected) return "signed-out";
    if (response.status === 404) await io.deletePage(userId, url);
    else if (response.ok) await io.putPage(userId, url, response);
    else return "offline";
  }
  for (const name of staleStaticCaches(await io.cacheNames(), io.version)) await io.deleteCache(name);
  await io.clearRefreshPending();
  return "done";
}
