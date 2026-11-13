import { afterEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { REMOTE_ORIGIN, TAB_ORIGIN } from "./local-document";
import { TabChannel } from "./tab-channel";

const channels: TabChannel[] = [];
function tab(docId = "doc") {
  const doc = new Y.Doc();
  channels.push(new TabChannel(docId, doc));
  return doc;
}

async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100 && !predicate(); i++) await new Promise((resolve) => setTimeout(resolve, 10));
  expect(predicate()).toBe(true);
}

afterEach(() => channels.splice(0).forEach((channel) => channel.close()));

describe("TabChannel", () => {
  it("relays local edits to other tabs with the tab origin", async () => {
    const a = tab();
    const b = tab();
    const origins: unknown[] = [];
    b.on("update", (_update, origin) => origins.push(origin));
    a.getText("body").insert(0, "from tab A");
    await until(() => b.getText("body").toString() === "from tab A");
    expect(origins).toEqual([TAB_ORIGIN]);
  });

  it("does not relay server updates or echo relayed ones", async () => {
    const a = tab();
    const b = tab();
    // Let the hello exchange of two new tabs finish first.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const seenByB: unknown[] = [];
    b.on("update", (_update, origin) => seenByB.push(origin));
    a.transact(() => a.getText("body").insert(0, "server"), REMOTE_ORIGIN);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(seenByB).toEqual([]);
  });

  it("brings a newly opened tab up to date", async () => {
    const a = tab();
    a.getText("body").insert(0, "typed before B opened");
    const b = tab();
    await until(() => b.getText("body").toString() === "typed before B opened");
  });

  it("keeps documents apart", async () => {
    const a = tab("one");
    const b = tab("two");
    a.getText("body").insert(0, "only in one");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(b.getText("body").toString()).toBe("");
  });
});
