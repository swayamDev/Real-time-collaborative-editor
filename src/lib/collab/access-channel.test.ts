import { afterEach, describe, expect, it } from "vitest";
import { type AccessNotice, AccessChannel, isLowerAccess } from "./access-channel";

const open: AccessChannel[] = [];
afterEach(() => open.splice(0).forEach((channel) => channel.close()));

function channel(userId: string, received: AccessNotice[]): AccessChannel {
  const created = new AccessChannel(userId, (notice) => received.push(notice));
  open.push(created);
  return created;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("AccessChannel", () => {
  it("delivers role changes to the same user's other tabs only", async () => {
    const tabA: AccessNotice[] = [];
    const tabB: AccessNotice[] = [];
    const otherUser: AccessNotice[] = [];
    const a = channel("user-1", tabA);
    channel("user-1", tabB);
    channel("user-2", otherUser);

    a.post({ docId: "doc", role: "viewer" });
    a.post({ docId: "doc", role: null });
    a.post({ docId: "doc", deleted: true });
    await settle();
    expect(tabB).toEqual([
      { docId: "doc", role: "viewer" },
      { docId: "doc", role: null },
      { docId: "doc", deleted: true },
    ]);
    expect(tabA).toEqual([]);
    expect(otherUser).toEqual([]);
  });

  it("ignores malformed notices", async () => {
    const received: AccessNotice[] = [];
    channel("user-3", received);
    const raw = new BroadcastChannel("brahma-access:user-3");
    raw.postMessage({ docId: "doc", role: "admin" });
    raw.postMessage("viewer");
    raw.postMessage({ role: "viewer" });
    raw.postMessage({ docId: "doc", deleted: false });
    raw.postMessage({ docId: "doc", deleted: "yes" });
    await settle();
    raw.close();
    expect(received).toEqual([]);
  });
});

describe("isLowerAccess", () => {
  it("orders owner over editor over viewer over none", () => {
    expect(isLowerAccess("editor", "viewer")).toBe(true);
    expect(isLowerAccess("editor", null)).toBe(true);
    expect(isLowerAccess("owner", "editor")).toBe(true);
    expect(isLowerAccess("viewer", "editor")).toBe(false);
    expect(isLowerAccess("editor", "editor")).toBe(false);
  });
});
