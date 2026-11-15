import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { type DeviceDocument, closeLocalStores, discardLocalCopy, getLocalStore, trackDocument } from "./device-store";

/** An open document that records when it was told to stop writing. */
function openDocument(docId: string, log: string[]): DeviceDocument {
  return {
    docId,
    dispose: async () => {
      log.push(`dispose ${docId}`);
    },
  };
}

// One page: these share the module's open stores, so they run in order and
// sign-out (which locks the page) comes last.
describe("removing documents from the device", () => {
  it("discarding a copy stops that document's writes, then deletes only it", async () => {
    const store = (await getLocalStore("user-1"))!;
    await store.createDocument("a");
    await store.createDocument("b");
    const log: string[] = [];
    const untrackA = trackDocument(openDocument("a", log));
    const untrackB = trackDocument(openDocument("b", log));

    await discardLocalCopy("user-1", "a");

    expect(log).toEqual(["dispose a"]);
    expect(await store.getMeta("a")).toBeNull();
    expect(await store.getMeta("b")).not.toBeNull();
    untrackA();
    untrackB();
  });

  it("sign-out stops every open document's writes before the stores close", async () => {
    const log: string[] = [];
    trackDocument(openDocument("b", log));
    trackDocument(openDocument("c", log));

    await closeLocalStores({ lock: true });

    expect(log.sort()).toEqual(["dispose b", "dispose c"]);
    expect(await getLocalStore("user-1")).toBeNull();
  });
});
