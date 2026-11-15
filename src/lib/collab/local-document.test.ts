import { TITLE_FIELD } from "@brahma/protocol";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { LocalDocument, REMOTE_ORIGIN, TITLE_SAVE_MS } from "./local-document";
import { LocalStore } from "./local-store";

const NAME = "brahma:test";
let factory: IDBFactory;
const open: LocalStore[] = [];

/** A tab: its own connection to the same database. */
async function tab(): Promise<LocalStore> {
  const store = await LocalStore.open(factory, NAME);
  open.push(store);
  return store;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Past the title save and the remote batch, with room to spare. */
const AFTER_TIMERS = TITLE_SAVE_MS + 300;

function remoteUpdate(text: string): Uint8Array {
  const source = new Y.Doc();
  source.getText("body").insert(0, text);
  return Y.encodeStateAsUpdate(source);
}

const nothingStored = { meta: null, base: [], pending: [] };

beforeEach(() => {
  factory = new IDBFactory();
});
afterEach(() => {
  for (const store of open.splice(0)) store.close();
});

describe("a deleted document stays deleted", () => {
  it("a title save that comes due after the delete writes nothing (the CI failure)", async () => {
    const store = await tab();
    const local = await LocalDocument.open(store, "doc", new Uint8Array());
    local.doc.getText(TITLE_FIELD).insert(0, "Plans");
    // Deleted before the title is saved, without dispose: the store alone refuses.
    await store.deleteDocument("doc");
    await wait(AFTER_TIMERS);
    expect(await store.loadDocument("doc")).toEqual(nothingStored);
    local.destroy();
  });

  it("dispose drops the pending title save and remote batch, and stops later writes", async () => {
    const store = await tab();
    const local = await LocalDocument.open(store, "doc", new Uint8Array());
    local.doc.getText("body").insert(0, "kept in memory");
    local.doc.getText(TITLE_FIELD).insert(0, "Plans");
    Y.applyUpdate(local.doc, remoteUpdate("from the server "), REMOTE_ORIGIN);

    await local.dispose();
    await store.deleteDocument("doc");
    // Everything a page can still do to a disposed document.
    local.doc.getText("body").insert(0, "typed after ");
    Y.applyUpdate(local.doc, remoteUpdate("late "), REMOTE_ORIGIN);
    await local.markSynced();
    await local.setHalted(true);
    await local.compactIfNeeded();
    await local.acknowledge(await local.pendingEntries());
    await wait(AFTER_TIMERS);

    expect(await store.loadDocument("doc")).toEqual(nothingStored);
    // The page can still offer a download of what it had.
    expect(local.doc.getText("body").toString()).toContain("kept in memory");
    local.destroy();
  });

  it("reports itself closed once disposed or destroyed, so no editor accepts input", async () => {
    const store = await tab();
    const disposed = await LocalDocument.open(store, "one", new Uint8Array());
    const destroyed = await LocalDocument.open(store, "two", new Uint8Array());
    let changes = 0;
    disposed.onChange(() => (changes += 1));
    destroyed.onChange(() => (changes += 1));
    expect([disposed.closed, destroyed.closed]).toEqual([false, false]);

    await disposed.dispose();
    destroyed.destroy();

    expect([disposed.closed, destroyed.closed]).toEqual([true, true]);
    // Listeners hear it, so the editor turns read-only without waiting for anything else.
    expect(changes).toBe(2);
    disposed.destroy();
  });

  it("dispose waits for local edits already being written", async () => {
    const store = await tab();
    const local = await LocalDocument.open(store, "doc", new Uint8Array());
    local.doc.getText("body").insert(0, "just typed");
    await local.dispose();
    expect(local.unwrittenSince).toBeNull();
    expect((await store.loadDocument("doc")).pending).toHaveLength(1);
    local.destroy();
  });

  it("another tab writing to the document after it was deleted cannot bring it back", async () => {
    const [deleting, other] = [await tab(), await tab()];
    const mine = await LocalDocument.open(deleting, "doc", new Uint8Array());
    const theirs = await LocalDocument.open(other, "doc", new Uint8Array());

    await mine.dispose();
    await deleting.deleteDocument("doc");

    // The other tab has not heard yet: it types, renames, receives an
    // update from the server, and acknowledges.
    theirs.doc.getText("body").insert(0, "typed in the other tab");
    theirs.doc.getText(TITLE_FIELD).insert(0, "Renamed");
    Y.applyUpdate(theirs.doc, remoteUpdate("from the server"), REMOTE_ORIGIN);
    await wait(AFTER_TIMERS);
    // The store refused the edits, but they were not lost: they stay in
    // that tab's memory, still to be sent.
    const entries = await theirs.pendingEntries();
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((entry) => entry.seq === null)).toBe(true);
    await theirs.acknowledge(entries);
    await theirs.compactIfNeeded();

    expect(await deleting.loadDocument("doc")).toEqual(nothingStored);
    expect(await other.listDocuments()).toEqual([]);
    mine.destroy();
    theirs.destroy();
  });

  it("reopening a deleted document stores it again, explicitly", async () => {
    const store = await tab();
    const first = await LocalDocument.open(store, "doc", new Uint8Array());
    await first.dispose();
    await store.deleteDocument("doc");
    first.destroy();

    const again = await LocalDocument.open(store, "doc", remoteUpdate("server copy"));
    expect(await store.getMeta("doc")).not.toBeNull();
    expect((await store.loadDocument("doc")).base).toHaveLength(1);
    again.destroy();
  });
});
