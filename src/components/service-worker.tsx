"use client";

import { useEffect } from "react";

/**
 * Registers the offline service worker in production builds. Development
 * skips it so hot reloading never fights a cache.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
      console.warn("Offline support is unavailable: the service worker did not register", error);
    });
  }, []);
  return null;
}

/** Ask the service worker to keep this page for offline use. */
export function cachePageForOffline(path: string): void {
  if (typeof navigator === "undefined" || !navigator.onLine) return;
  void navigator.serviceWorker?.ready.then((registration) =>
    registration.active?.postMessage({ type: "cache-page", url: path }),
  );
}
