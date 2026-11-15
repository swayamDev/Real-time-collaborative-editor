/* Brahma service worker. Generated into public/sw.js by scripts/build-sw.mjs. */

const VERSION = "__BUILD_ID__";
const STATIC_CACHE = `brahma-static-${VERSION}`;
/** Hashed, immutable build output: safe to keep until the next version. */
const PRECACHE = __PRECACHE__;

// Cache naming and cleanup rules (sw/cache-policy.mjs, unit tested).
/* __CACHE_POLICY__ */

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
  return user ? caches.open(pageCacheName(user)) : null;
}

/** Who the server says is signed in right now (the same gate as the client's cleanup). */
async function confirmUser() {
  const response = await fetch("/api/auth/get-session", { credentials: "include", cache: "no-store" });
  if (!response.ok) return null;
  const body = await response.json();
  return body && body.user && typeof body.user.id === "string" ? body.user.id : null;
}

/**
 * The page tells the worker who is signed in. Pages send this only after
 * the server has confirmed the user (claimDevice in src/lib/device-data.ts).
 */
async function setUser(userId) {
  currentUser = userId;
  const store = await caches.open(USER_CACHE);
  if (userId) await store.put(USER_KEY, new Response(userId));
  else await store.delete(USER_KEY);
  for (const name of pageCachesToDelete(await caches.keys(), userId)) await caches.delete(name);
  // The offline fallback page carries the user's name, so it is per user too.
  const pages = await pageCache();
  if (pages && !(await pages.match(OFFLINE_URL))) await cachePage(OFFLINE_URL);
  if (userId && (await store.match(REFRESH_KEY))) await refreshPages(userId);
}

/** After an update: refresh this user's page copies, then drop earlier versions' files. */
function refreshPages(userId) {
  return refreshAfterUpdate(userId, {
    version: VERSION,
    confirmUser,
    listPages: async (user) => {
      const pages = await caches.open(pageCacheName(user));
      return (await pages.keys()).map((request) => new URL(request.url).pathname);
    },
    fetchPage: (url) => fetch(url, { credentials: "include", cache: "no-store" }),
    putPage: async (user, url, response) => (await caches.open(pageCacheName(user))).put(url, response),
    deletePage: async (user, url) => (await caches.open(pageCacheName(user))).delete(url),
    cacheNames: () => caches.keys(),
    deleteCache: (name) => caches.delete(name),
    clearRefreshPending: async () => (await caches.open(USER_CACHE)).delete(REFRESH_KEY),
  });
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
      const names = await caches.keys();
      // Earlier versions' static files stay until page copies are refreshed
      // for a confirmed user, so tabs and copies from the previous version
      // keep working through a deploy.
      if (isUpdate(names, VERSION)) await (await caches.open(USER_CACHE)).put(REFRESH_KEY, new Response(VERSION));
      for (const name of cachesToDeleteOnActivate(names, VERSION)) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

/** A page the app asks to keep, for example a document it just opened. */
async function cachePage(url) {
  const pages = await pageCache();
  if (!pages) return;
  const response = await fetch(url, { credentials: "include", cache: "no-store" });
  if (response.ok && !response.redirected) await pages.put(url, response);
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

/** Hashed files from any version still cached (earlier versions stay until refreshed). */
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
      if (pages) pages.put(url.pathname, response.clone());
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
