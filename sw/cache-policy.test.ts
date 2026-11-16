import { describe, expect, it } from "vitest";
import {
  USER_CACHE,
  cachesToDeleteOnActivate,
  isPublicPage,
  isUpdate,
  pageCacheName,
  pageCachesToDelete,
  refreshAfterUpdate,
  staleStaticCaches,
  staticCacheName,
} from "./cache-policy.mjs";

describe("cache naming and cleanup", () => {
  const names = [
    staticCacheName("v1"),
    staticCacheName("v2"),
    USER_CACHE,
    pageCacheName("ada"),
    "brahma-pages:v1:ada",
    "brahma-pages-v0",
    "brahma-something-old",
    "other-app",
  ];

  it("at activation deletes old page naming and unknown caches, but keeps earlier static files", () => {
    expect(cachesToDeleteOnActivate(names, "v2").sort()).toEqual(
      ["brahma-pages-v0", "brahma-pages:v1:ada", "brahma-something-old"].sort(),
    );
  });

  it("knows a first install from an update", () => {
    expect(isUpdate([USER_CACHE], "v1")).toBe(false);
    expect(isUpdate([staticCacheName("v1")], "v2")).toBe(true);
    expect(isUpdate([pageCacheName("ada")], "v2")).toBe(true);
  });

  it("lists earlier static caches for deletion after the refresh", () => {
    expect(staleStaticCaches(names, "v2")).toEqual([staticCacheName("v1")]);
  });

  it("deletes other users' pages, never the kept user's, and all when signing out", () => {
    const caches = [pageCacheName("ada"), pageCacheName("ben"), "brahma-pages:v1:ada", staticCacheName("v2")];
    expect(pageCachesToDelete(caches, "ada")).toEqual([pageCacheName("ben"), "brahma-pages:v1:ada"]);
    expect(pageCachesToDelete(caches, "")).toEqual([pageCacheName("ada"), pageCacheName("ben"), "brahma-pages:v1:ada"]);
  });
});

/** A fake world for refreshAfterUpdate: pages by URL, and what the network answers. */
function world({
  confirmed = "ada" as string | null,
  answers = {} as Record<string, { status: number; redirected?: boolean } | "offline">,
} = {}) {
  const pages = new Map([
    ["/d/one", "old one"],
    ["/d/two", "old two"],
    ["/offline", "old offline"],
  ]);
  let cacheNames = [staticCacheName("v1"), staticCacheName("v2"), pageCacheName("ada")];
  const calls: string[] = [];
  let pending = true;
  const io = {
    version: "v2",
    confirmUser: async () => confirmed,
    listPages: async () => [...pages.keys()],
    fetchPage: async (url: string) => {
      calls.push(`fetch ${url}`);
      const answer = answers[url] ?? { status: 200 };
      if (answer === "offline") throw new TypeError("Failed to fetch");
      return { ok: answer.status >= 200 && answer.status < 300, status: answer.status, redirected: Boolean(answer.redirected) } as Response;
    },
    putPage: async (_user: string, url: string) => void pages.set(url, `new ${url}`),
    deletePage: async (_user: string, url: string) => void pages.delete(url),
    cacheNames: async () => cacheNames,
    deleteCache: async (name: string) => void (cacheNames = cacheNames.filter((n) => n !== name)),
    clearRefreshPending: async () => void (pending = false),
  };
  return { io, pages, calls, names: () => cacheNames, pending: () => pending };
}

describe("refreshAfterUpdate", () => {
  it("refreshes every page and then drops the earlier version's files", async () => {
    const w = world();
    expect(await refreshAfterUpdate("ada", w.io)).toBe("done");
    expect([...w.pages.values()]).toEqual(["new /d/one", "new /d/two", "new /offline"]);
    expect(w.names()).toEqual([staticCacheName("v2"), pageCacheName("ada")]);
    expect(w.pending()).toBe(false);
  });

  it("touches nothing unless the server confirms this user", async () => {
    for (const confirmed of [null, "ben"]) {
      const w = world({ confirmed });
      expect(await refreshAfterUpdate("ada", w.io)).toBe("unconfirmed");
      expect(w.calls).toEqual([]);
      expect(w.names()).toContain(staticCacheName("v1"));
      expect(w.pending()).toBe(true);
    }
  });

  it("offline, keeps the old copies and the old files, to try again later", async () => {
    const w = world({ answers: { "/d/two": "offline" } });
    expect(await refreshAfterUpdate("ada", w.io)).toBe("offline");
    expect(w.pages.get("/d/two")).toBe("old two");
    expect(w.names()).toContain(staticCacheName("v1"));
    expect(w.pending()).toBe(true);
  });

  it("stops when a page redirects (the session ended)", async () => {
    const w = world({ answers: { "/d/one": { status: 200, redirected: true } } });
    expect(await refreshAfterUpdate("ada", w.io)).toBe("signed-out");
    expect(w.pages.get("/d/one")).toBe("old one");
    expect(w.names()).toContain(staticCacheName("v1"));
  });

  it("drops a page that no longer exists", async () => {
    const w = world({ answers: { "/d/two": { status: 404 } } });
    expect(await refreshAfterUpdate("ada", w.io)).toBe("done");
    expect(w.pages.has("/d/two")).toBe(false);
  });
});

describe("isPublicPage", () => {
  it("leaves the privacy policy to the network, never in a user's page cache", () => {
    expect(isPublicPage("/privacy")).toBe(true);
    expect(isPublicPage("/privacy/")).toBe(true);
    expect(isPublicPage("/demo")).toBe(true);
    expect(isPublicPage("/demo/join")).toBe(true);
    expect(isPublicPage("/")).toBe(false);
    expect(isPublicPage("/d/123")).toBe(false);
    expect(isPublicPage("/privacy-notes")).toBe(false);
  });
});
