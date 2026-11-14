import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { LocalStore } from "./local-store";
import { pruneInaccessible } from "./prune";

describe("pruneInaccessible", () => {
  it("drops copies the user can no longer open, unless they hold unsynced edits", async () => {
    const store = await LocalStore.open(new IDBFactory(), "brahma:test");
    await store.appendRemote("still-shared", new Uint8Array([1]));
    await store.appendRemote("revoked", new Uint8Array([1]));
    await store.appendRemote("revoked-with-edits", new Uint8Array([1]));
    await store.appendLocal("revoked-with-edits", new Uint8Array([2]));
    for (const id of ["still-shared", "revoked", "revoked-with-edits"]) await store.updateMeta(id, { title: id });

    expect(await pruneInaccessible(store, new Set(["still-shared"]))).toEqual(["revoked"]);
    expect((await store.listDocuments()).map((meta) => meta.id).sort()).toEqual(["revoked-with-edits", "still-shared"]);
    store.close();
  });
});
