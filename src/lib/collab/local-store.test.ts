import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { LocalStore, StorageFullError, toStorageError } from "./local-store";

let store: LocalStore;

beforeEach(async () => {
  store = await LocalStore.open(new IDBFactory());
});
afterEach(() => store.close());

function edit(doc: Y.Doc, text: string): Uint8Array {
  const before = Y.encodeStateVector(doc);
  doc.getText("t").insert(doc.getText("t").length, text);
  return Y.encodeStateAsUpdate(doc, before);
}

function textOf(updates: Uint8Array[]): string {
  const doc = new Y.Doc();
  for (const update of updates) Y.applyUpdate(doc, update);
  return doc.getText("t").toString();
}

async function contentOf(docId: string): Promise<string> {
  const loaded = await store.loadDocument(docId);
  return textOf([...loaded.base, ...loaded.pending.map((row) => row.update)]);
}

const merge = (updates: Uint8Array[]) => {
  const doc = new Y.Doc();
  for (const update of updates) Y.applyUpdate(doc, update);
  return Y.encodeStateAsUpdate(doc);
};

describe("LocalStore", () => {
  it("loads nothing for a document never stored", async () => {
    expect(await store.loadDocument("a")).toEqual({ meta: null, base: [], pending: [] });
  });

  it("keeps local edits pending, in order, and counts them", async () => {
    const doc = new Y.Doc();
    const first = await store.appendLocal("a", edit(doc, "one "));
    const second = await store.appendLocal("a", edit(doc, "two"));
    expect(second).toBeGreaterThan(first);

    const loaded = await store.loadDocument("a");
    expect(loaded.pending.map((row) => row.seq)).toEqual([first, second]);
    expect(loaded.meta?.pendingCount).toBe(2);
    expect(await contentOf("a")).toBe("one two");
  });

  it("moves acknowledged edits out of pending without losing them", async () => {
    const doc = new Y.Doc();
    const first = await store.appendLocal("a", edit(doc, "kept "));
    await store.appendLocal("a", edit(doc, "still pending"));
    await store.acknowledge("a", [first, 99_999]);

    const loaded = await store.loadDocument("a");
    expect(loaded.pending).toHaveLength(1);
    expect(loaded.meta?.pendingCount).toBe(1);
    expect(await contentOf("a")).toBe("kept still pending");
  });

  it("acknowledging twice (two tabs) is harmless", async () => {
    const doc = new Y.Doc();
    const seq = await store.appendLocal("a", edit(doc, "once"));
    await Promise.all([store.acknowledge("a", [seq]), store.acknowledge("a", [seq])]);
    expect((await store.loadDocument("a")).meta?.pendingCount).toBe(0);
    expect(await contentOf("a")).toBe("once");
    expect(await store.updateCount("a")).toBe(1);
  });

  it("keeps documents apart", async () => {
    await store.appendLocal("a", edit(new Y.Doc(), "in a"));
    await store.appendLocal("b", edit(new Y.Doc(), "in b"));
    expect(await contentOf("a")).toBe("in a");
    expect(await contentOf("b")).toBe("in b");
  });

  it("compacts acknowledged updates into one snapshot and leaves pending alone", async () => {
    const doc = new Y.Doc();
    for (const word of ["a ", "b ", "c "]) await store.appendRemote("x", edit(doc, word));
    await store.appendLocal("x", edit(doc, "pending"));
    await store.compact("x", merge);

    const loaded = await store.loadDocument("x");
    expect(loaded.base).toHaveLength(1);
    expect(loaded.pending).toHaveLength(1);
    expect(await store.updateCount("x")).toBe(0);
    expect(await contentOf("x")).toBe("a b c pending");
  });

  it("never loses an update written while compaction runs", async () => {
    const doc = new Y.Doc();
    for (const word of ["1 ", "2 ", "3 "]) await store.appendRemote("x", edit(doc, word));
    const late = edit(doc, "late");
    await Promise.all([store.compact("x", merge), store.appendRemote("x", late)]);
    expect(await contentOf("x")).toBe("1 2 3 late");
  });

  it("stores and lists metadata", async () => {
    await store.updateMeta("a", { title: "Plans", everSynced: true, lastOpenedAt: 5 });
    await store.appendLocal("a", edit(new Y.Doc(), "x"));
    expect(await store.getMeta("a")).toEqual({
      id: "a",
      title: "Plans",
      everSynced: true,
      lastOpenedAt: 5,
      pendingCount: 1,
      halted: false,
    });
    expect((await store.listDocuments()).map((meta) => meta.id)).toEqual(["a"]);
  });

  it("deletes everything for one document", async () => {
    const doc = new Y.Doc();
    await store.appendRemote("a", edit(doc, "r"));
    await store.appendLocal("a", edit(doc, "p"));
    await store.compact("a", merge);
    await store.appendLocal("b", edit(new Y.Doc(), "other"));
    await store.deleteDocument("a");
    expect(await store.loadDocument("a")).toEqual({ meta: null, base: [], pending: [] });
    expect(await contentOf("b")).toBe("other");
  });

  it("reports a full device as StorageFullError", () => {
    const quota = new DOMException("full", "QuotaExceededError");
    expect(toStorageError(quota)).toBeInstanceOf(StorageFullError);
    expect(toStorageError(new DOMException("x", "AbortError"))).not.toBeInstanceOf(StorageFullError);
  });
});
