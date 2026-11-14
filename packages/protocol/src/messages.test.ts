import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  ProtocolError,
  decodeMessage,
  encodeAck,
  encodeAwareness,
  encodeQueryAwareness,
  encodeSyncStep1,
  encodeSyncStep2,
  encodeUpdate,
} from "./messages";

function docWith(text: string): Y.Doc {
  const doc = new Y.Doc();
  doc.getText("t").insert(0, text);
  return doc;
}

describe("message framing", () => {
  it("round trips sync step 1 with the state vector", () => {
    const doc = docWith("hello");
    const message = decodeMessage(encodeSyncStep1(doc));
    expect(message).toEqual({ type: "sync-step-1", stateVector: Y.encodeStateVector(doc) });
  });

  it("round trips sync step 2 containing only what the peer lacks", () => {
    const server = docWith("hello");
    const client = new Y.Doc();
    const message = decodeMessage(encodeSyncStep2(server, Y.encodeStateVector(client)));
    expect(message.type).toBe("sync-step-2");
    if (message.type !== "sync-step-2") return;
    Y.applyUpdate(client, message.update);
    expect(client.getText("t").toString()).toBe("hello");
  });

  it("round trips updates, awareness, query awareness and acks", () => {
    const update = Y.encodeStateAsUpdate(docWith("x"));
    expect(decodeMessage(encodeUpdate(update))).toEqual({ type: "update", update });
    expect(decodeMessage(encodeAwareness(Uint8Array.of(1, 2, 3)))).toEqual({
      type: "awareness",
      update: Uint8Array.of(1, 2, 3),
    });
    expect(decodeMessage(encodeQueryAwareness())).toEqual({ type: "query-awareness" });
    expect(decodeMessage(encodeAck(300))).toEqual({ type: "ack", count: 300 });
  });
});

describe("decodeMessage rejects malformed input", () => {
  it("rejects an empty message", () => {
    expect(() => decodeMessage(new Uint8Array())).toThrow(ProtocolError);
  });

  it("rejects unknown message and sync types", () => {
    expect(() => decodeMessage(Uint8Array.of(9))).toThrow(ProtocolError);
    expect(() => decodeMessage(Uint8Array.of(0, 7, 0))).toThrow(ProtocolError);
  });

  it("rejects a truncated payload", () => {
    // Sync update claiming 10 bytes but carrying 2.
    expect(() => decodeMessage(Uint8Array.of(0, 2, 10, 1, 2))).toThrow(ProtocolError);
  });

  it("rejects trailing bytes", () => {
    const valid = encodeQueryAwareness();
    expect(() => decodeMessage(Uint8Array.of(...valid, 0))).toThrow(ProtocolError);
  });
});

describe("auth and role messages", () => {
  it("round trips a refreshed token and a role change", async () => {
    const { encodeAuth, encodeRole } = await import("./messages");
    expect(decodeMessage(encodeAuth("a.b.c"))).toEqual({ type: "auth", token: "a.b.c" });
    expect(decodeMessage(encodeRole("viewer"))).toEqual({ type: "role", role: "viewer" });
  });

  it("rejects an unknown role", () => {
    expect(() => decodeMessage(Uint8Array.of(6, 5, 97, 100, 109, 105, 110))).toThrow(ProtocolError);
  });
});
