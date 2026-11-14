/* Brahma service worker. Generated into public/sw.js by scripts/build-sw.mjs. */

const VERSION = "__BUILD_ID__";
const STATIC_CACHE = `brahma-static-${VERSION}`;
/**
 * Pages are kept per user: `brahma-pages:<version>:<userId>`. A page holds
 * the signed-in user's name and document list, so one user's copies are
 * never served to another, and signing in as someone else deletes them.
 * The client deletes caches by the same naming (src/lib/device-data.ts).
 */
const PAGES_PREFIX = `brahma-pages:${VERSION}:`;
/** Remembers who is signed in on this device, across service worker restarts. */
const USER_CACHE = "brahma-user";
const USER_KEY = "/__brahma/user";
const OFFLINE_URL = "/offline";
/** Hashed, immutable build output: safe to keep until the next version. */
const PRECACHE = __PRECACHE__;

/** The signed-in user's id, "" when unknown or signed out. */
let currentUser = null;

async function getUser() {
  if (currentUser === null) {
    const stored = await caches.match(USER_KEY, { cacheName: USER_CACHE });
    currentUser = stored ? await stored.text() : "";
  }
  return currentUser;
}

/** This user's page cache, or null when nobody is known to be signed in. */
async function pageCache() {
  const user = await getUser();
  return user ? caches.open(PAGES_PREFIX + user) : null;
}

/** Delete every page cache except `keepUser`'s ("" deletes them all). */
async function deletePageCaches(keepUser) {
  for (const name of await caches.keys()) {
    if (name.startsWith("brahma-pages") && !(keepUser && name === PAGES_PREFIX + keepUser)) await caches.delete(name);
  }
}

async function setUser(userId) {
  currentUser = userId;
  const store = await caches.open(USER_CACHE);
  if (userId) await store.put(USER_KEY, new Response(userId));
  else await store.delete(USER_KEY);
  await deletePageCaches(userId);
  // The offline fallback page carries the user's name, so it is per user too.
  const pages = await pageCache();
  if (pages && !(await pages.match(OFFLINE_URL))) await cachePage(OFFLINE_URL);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const statics = await caches.open(STATIC_CACHE);
      await statics.addAll(PRECACHE);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Older versions' pages reference chunks that no longer exist: drop
      // every old cache, pages included. They refill as documents are opened.
      for (const name of await caches.keys()) {
        const keep = name === STATIC_CACHE || name === USER_CACHE || name.startsWith(PAGES_PREFIX);
        if (name.startsWith("brahma-") && !keep) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

/**
 * Store a page only once its whole body has arrived. Putting a streaming
 * response replaces the old entry even if the stream then fails (the
 * network drops mid-download), which would leave no copy at all.
 */
async function keepPage(pages, path, response) {
  const body = await response.arrayBuffer();
  await pages.put(path, new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers }));
}

/** A page the app asks to keep, for example a document it just opened. */
async function cachePage(url) {
  const pages = await pageCache();
  if (!pages) return;
  const response = await fetch(url, { credentials: "include", cache: "no-store" });
  if (response.ok && !response.redirected) await keepPage(pages, url, response);
}

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data) return;
  if (data.type === "cache-page" && typeof data.url === "string" && data.url.startsWith("/")) {
    event.waitUntil(cachePage(data.url).catch(() => {}));
  } else if (data.type === "set-user" && typeof data.userId === "string") {
    event.waitUntil(setUser(data.userId).catch(() => {}));
  }
});

function isRscRequest(request, url) {
  return request.headers.get("RSC") === "1" || url.searchParams.has("_rsc");
}

async function staticFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) (await caches.open(STATIC_CACHE)).put(request, response.clone());
  return response;
}

/** Network first; keep a copy for this user; offline, serve their copy or the offline page. */
async function pageNetworkFirst(request, url) {
  try {
    const response = await fetch(request);
    if (response.ok && !response.redirected) {
      const pages = await pageCache();
      // Not awaited: the page renders while its copy is stored.
      if (pages) keepPage(pages, url.pathname, response.clone()).catch(() => {});
    }
    return response;
  } catch (error) {
    const pages = await pageCache();
    const cached = pages && ((await pages.match(url.pathname)) || (await pages.match(OFFLINE_URL)));
    if (cached) return cached;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(staticFirst(request));
    return;
  }
  // RSC payloads are not cached: offline they fail, and Next falls back to
  // a full page load, which the page cache serves.
  if (isRscRequest(request, url) || url.pathname.startsWith("/api/")) return;
  if (request.mode === "navigate") event.respondWith(pageNetworkFirst(request, url));
});
