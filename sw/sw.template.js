/* Brahma service worker. Generated into public/sw.js by scripts/build-sw.mjs. */

const VERSION = "__BUILD_ID__";
const STATIC_CACHE = `brahma-static-${VERSION}`;
const PAGE_CACHE = `brahma-pages-${VERSION}`;
const OFFLINE_URL = "/offline";
/** Hashed, immutable build output: safe to keep until the next version. */
const PRECACHE = __PRECACHE__;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const statics = await caches.open(STATIC_CACHE);
      await statics.addAll(PRECACHE);
      const pages = await caches.open(PAGE_CACHE);
      await pages.add(new Request(OFFLINE_URL, { credentials: "include" }));
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
        if (name.startsWith("brahma-") && name !== STATIC_CACHE && name !== PAGE_CACHE) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

/** A page the app asks to keep, for example a document it just opened. */
async function cachePage(url) {
  const response = await fetch(url, { credentials: "include", cache: "no-store" });
  if (response.ok && !response.redirected) await (await caches.open(PAGE_CACHE)).put(url, response);
}

self.addEventListener("message", (event) => {
  const data = event.data;
  if (data && data.type === "cache-page" && typeof data.url === "string" && data.url.startsWith("/")) {
    event.waitUntil(cachePage(data.url).catch(() => {}));
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

/** Network first; keep a copy; offline, serve the copy or the offline page. */
async function pageNetworkFirst(request, url) {
  try {
    const response = await fetch(request);
    if (response.ok && !response.redirected) {
      (await caches.open(PAGE_CACHE)).put(url.pathname, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(url.pathname, { cacheName: PAGE_CACHE });
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL, { cacheName: PAGE_CACHE });
    if (offline) return offline;
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
