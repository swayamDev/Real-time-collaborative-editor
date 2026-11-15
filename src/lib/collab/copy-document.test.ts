import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { loadLocalCopy, moveLocalCopy, stateByClient } from "./copy-document";
import { LocalStore } from "./local-store";

let store: LocalStore;
beforeEach(async () => {
  store = await LocalStore.open(new IDBFactory());
});
afterEach(() => store.close());

describe("stateByClient", () => {
  it("splits by client and rebuilds the same document", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    a.getText("body").insert(0, "from a ");
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    b.getText("body").insert(7, "and b");
    const parts = stateByClient(b);
    expect(parts).toHaveLength(2);
    const rebuilt = new Y.Doc();
    for (const part of [...parts].reverse()) Y.applyUpdate(rebuilt, part);
    expect(rebuilt.getText("body").toString()).toBe("from a and b");
  });
});

describe("moveLocalCopy", () => {
  it("turns the old copy into pending edits of the new document and removes the old one", async () => {
    const doc = new Y.Doc();
    doc.getText("title").insert(0, "Offline notes");
    doc.getText("body").insert(0, "written offline");
    await store.createDocument("old");
    await store.appendRemote("old", Y.encodeStateAsUpdate(doc));
    const before = Y.encodeStateVector(doc);
    doc.getText("body").insert(15, " and more");
    await store.appendLocal("old", Y.encodeStateAsUpdate(doc, before));

    await moveLocalCopy(store, "old", "new");

    expect(await store.loadDocument("old")).toEqual({ meta: null, base: [], pending: [] });
    const copied = await loadLocalCopy(store, "new");
    expect(copied.doc.getText("body").toString()).toBe("written offline and more");
    expect(copied.pendingCount).toBeGreaterThan(0);
    expect((await store.getMeta("new"))?.title).toBe("Offline notes");
  });
});
