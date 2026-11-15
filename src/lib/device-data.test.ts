import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { LocalStore } from "./collab/local-store";
import {
  type DeviceApis,
  type SessionMessage,
  claimDevice,
  clearDevice,
  foreignDatabases,
  foreignPageCaches,
  userDatabase,
} from "./device-data";

/** A Cache Storage stand-in that only tracks names. */
function fakeCaches(names: string[]): CacheStorage & { names: Set<string> } {
  const set = new Set(names);
  return {
    names: set,
    keys: async () => [...set],
    delete: async (name: string) => set.delete(name),
  } as unknown as CacheStorage & { names: Set<string> };
}

/** `signedIn` is who the server confirms; null stands for offline or no session. */
function apis(factory: IDBFactory, caches: CacheStorage, signedIn: string | null = null) {
  const posted: SessionMessage[] = [];
  const told: string[] = [];
  const cleared: string[] = [];
  const value: DeviceApis = {
    confirmSignedInUser: async () => signedIn,
    indexedDB: factory,
    caches,
    tellServiceWorker: (userId) => told.push(userId),
    postSession: (message) => posted.push(message),
    clearCookie: (name) => cleared.push(name),
  };
  return { value, posted, told, cleared };
}

async function names(factory: IDBFactory): Promise<string[]> {
  return (await factory.databases()).map((info) => info.name!).sort();
}

async function seed(factory: IDBFactory, ...databases: string[]): Promise<void> {
  for (const name of databases) {
    const store = await LocalStore.open(factory, name);
    await store.appendLocal("doc", new Uint8Array([1, 2, 3]));
    store.close();
  }
}

describe("naming", () => {
  it("finds other users' databases and the Phase 3 database", () => {
    expect(foreignDatabases(["brahma", "brahma:a", "brahma:b", "other-app"], "a")).toEqual(["brahma", "brahma:b"]);
  });

  it("finds other users' page caches in the current naming", () => {
    expect(foreignPageCaches(["brahma-pages:a", "brahma-pages:b", "brahma-pages:xa"], "a")).toEqual(["brahma-pages:b", "brahma-pages:xa"]);
  });

  it("finds other users' page caches, legacy ones included, never a prefix match", () => {
    const caches = ["brahma-pages:v1:a", "brahma-pages:v1:xa", "brahma-pages-v0", "brahma-static-v1", "brahma-user"];
    expect(foreignPageCaches(caches, "a")).toEqual(["brahma-pages:v1:xa", "brahma-pages-v0"]);
    expect(foreignPageCaches(caches, "")).toEqual(["brahma-pages:v1:a", "brahma-pages:v1:xa", "brahma-pages-v0"]);
  });
});

describe("claimDevice", () => {
  it("deletes everyone else's data and keeps the signed-in user's", async () => {
    const factory = new IDBFactory();
    await seed(factory, "brahma", userDatabase("a"), userDatabase("b"));
    const caches = fakeCaches(["brahma-pages:v1:a", "brahma-pages:v1:b", "brahma-static-v1"]);
    const device = apis(factory, caches, "b");

    expect(await claimDevice("b", device.value)).toBe("claimed");

    expect(await names(factory)).toEqual(["brahma:b"]);
    expect([...caches.names].sort()).toEqual(["brahma-pages:v1:b", "brahma-static-v1"]);
    expect(device.posted).toEqual([{ type: "user", userId: "b" }]);
    expect(device.told).toEqual(["b"]);
    expect(device.cleared).toEqual(["brahma-name", "brahma-guest"]);
  });

  it("still deletes a database another tab holds open, once that tab lets go", async () => {
    const factory = new IDBFactory();
    await seed(factory, userDatabase("a"));
    const held = await LocalStore.open(factory, userDatabase("a"));
    await claimDevice("b", apis(factory, fakeCaches([]), "b").value);
    // LocalStore closes on versionchange, so the deletion goes through.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await names(factory)).toEqual([]);
    held.close();
  });
});

describe("claimDevice only for a user the server confirms", () => {
  it("does nothing offline or without a session", async () => {
    const factory = new IDBFactory();
    await seed(factory, "brahma", userDatabase("a"), userDatabase("b"));
    const caches = fakeCaches(["brahma-pages:v1:a", "brahma-pages:v1:b"]);
    const device = apis(factory, caches, null);

    expect(await claimDevice("b", device.value)).toBe("unconfirmed");
    expect(await names(factory)).toEqual(["brahma", "brahma:a", "brahma:b"]);
    expect([...caches.names].sort()).toEqual(["brahma-pages:v1:a", "brahma-pages:v1:b"]);
    expect(device.posted).toEqual([]);
    expect(device.told).toEqual([]);
    expect(device.cleared).toEqual([]);
  });

  it("a previous user's page (cached, or a tab left open) cannot delete the signed-in user's data", async () => {
    const factory = new IDBFactory();
    await seed(factory, userDatabase("a"), userDatabase("b"));
    const caches = fakeCaches(["brahma-pages:v1:a", "brahma-pages:v1:b"]);

    // B signed in. A page still showing A loads, before B's own cleanup ran.
    const staleA = apis(factory, caches, "b");
    expect(await claimDevice("a", staleA.value)).toBe("unconfirmed");
    expect(await names(factory)).toEqual(["brahma:a", "brahma:b"]);
    expect([...caches.names].sort()).toEqual(["brahma-pages:v1:a", "brahma-pages:v1:b"]);
    expect(staleA.told).toEqual([]);

    // B's page cleans up for B.
    expect(await claimDevice("b", apis(factory, caches, "b").value)).toBe("claimed");
    expect(await names(factory)).toEqual(["brahma:b"]);
    expect([...caches.names]).toEqual(["brahma-pages:v1:b"]);
  });
});

describe("clearDevice", () => {
  it("deletes the user's database and every page cache, and tells other tabs", async () => {
    const factory = new IDBFactory();
    await seed(factory, userDatabase("a"));
    const caches = fakeCaches(["brahma-pages:v1:a", "brahma-static-v1", "brahma-user"]);
    const device = apis(factory, caches);

    await clearDevice("a", device.value);

    expect(await names(factory)).toEqual([]);
    expect([...caches.names].sort()).toEqual(["brahma-static-v1", "brahma-user"]);
    expect(device.posted).toEqual([{ type: "signed-out", userId: "a" }]);
    expect(device.told).toEqual([""]);
  });
});
