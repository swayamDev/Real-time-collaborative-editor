import { preferredColor } from "@brahma/protocol";
import { describe, expect, it } from "vitest";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import * as Y from "yjs";
import { caretColor, caretName, participants, syncOwnColor } from "./presence";

function client(name: string, guestId: string, joinedAt: number) {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  awareness.setLocalStateField("user", { name, guestId, joinedAt, color: preferredColor(guestId) });
  return awareness;
}

function exchange(a: Awareness, b: Awareness): void {
  applyAwarenessUpdate(b, encodeAwarenessUpdate(a, [...a.getStates().keys()]), "remote");
  applyAwarenessUpdate(a, encodeAwarenessUpdate(b, [...b.getStates().keys()]), "remote");
}

/** Guest ids that prefer the same color. */
function samePreference(): [string, string] {
  const target = preferredColor("guest-0");
  for (let i = 1; ; i++) {
    if (preferredColor(`guest-${i}`) === target) return ["guest-0", `guest-${i}`];
  }
}

describe("participants", () => {
  it("lists self first and sanitizes peers", () => {
    const me = client("Me", "guest-me", 1);
    const peerDoc = new Y.Doc();
    const peer = new Awareness(peerDoc);
    peer.setLocalStateField("user", { name: "‮eve\u0000  ", guestId: "g", joinedAt: 0, color: "url(x)" });
    exchange(me, peer);

    const people = participants(me);
    expect(people[0]).toMatchObject({ name: "Me", isSelf: true });
    expect(people[1]).toMatchObject({ name: "eve", isSelf: false });
    expect(["indigo", "madder", "turmeric", "leaf", "lac", "kattha"]).toContain(people[1].color);
    me.destroy();
    peer.destroy();
  });

  it("ignores states without a user", () => {
    const me = client("Me", "guest-me", 1);
    const otherDoc = new Y.Doc();
    const other = new Awareness(otherDoc);
    other.setLocalStateField("cursor", null);
    exchange(me, other);
    expect(participants(me)).toHaveLength(1);
    me.destroy();
    other.destroy();
  });
});

describe("syncOwnColor", () => {
  it("makes two clients with the same preferred color agree on different colors", () => {
    const [first, second] = samePreference();
    const a = client("A", first, 1000);
    const b = client("B", second, 1000); // joined at the same moment
    exchange(a, b);
    syncOwnColor(a);
    syncOwnColor(b);
    exchange(a, b);

    const fromA = participants(a).map((p) => [p.clientId, p.color]).sort();
    const fromB = participants(b).map((p) => [p.clientId, p.color]).sort();
    expect(fromA).toEqual(fromB);
    expect(new Set(fromA.map(([, color]) => color)).size).toBe(2);
    // What each client publishes matches what everyone computes.
    const published = (x: Awareness) => (x.getLocalState()?.user as { color: string }).color;
    expect(participants(a).find((p) => p.isSelf)!.color).toBe(published(a));
    expect(participants(b).find((p) => p.isSelf)!.color).toBe(published(b));
    a.destroy();
    b.destroy();
  });
});

describe("caret helpers", () => {
  it("only accept color tokens and sanitized names", () => {
    expect(caretColor({ color: "lac" })).toBe("lac");
    expect(caretColor({ color: "red; background: url(x)", guestId: "g" })).toBe(preferredColor("g"));
    expect(caretName({ name: "  <b>Ada</b>\u0007 " })).toBe("<b>Ada</b>");
    expect(caretName({})).toBe("Guest");
  });
});
