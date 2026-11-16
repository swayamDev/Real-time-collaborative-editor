import { encodeAuth, encodeAwareness, encodeSyncStep1, encodeUpdate } from "@brahma/protocol";
import { SELF, env, listDurableObjectIds } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from "y-protocols/awareness";
import * as Y from "yjs";
import { memoryStore } from "../src/store";
import { EDITOR, OWNER, type TestUser, TestClient, VIEWER, newDocumentId, tokenFor } from "./client";

function seed(text = ""): string {
  const id = newDocumentId();
  const doc = new Y.Doc();
  if (text) doc.getText("body").insert(0, text);
  memoryStore.rows.set(id, { state: Y.encodeStateAsUpdate(doc), title: "" });
  return id;
}

/** Connect and finish the handshake, as the editor does. */
async function joined(id: string, as: TestUser = EDITOR): Promise<TestClient> {
  const client = await TestClient.connect(id, { as });
  await client.until(() => client.count("sync-step-1") > 0, "server step 1");
  client.send(encodeSyncStep1(client.doc));
  await client.until(() => client.count("sync-step-2") > 0, "server step 2");
  client.answerStep1();
  await client.until(() => client.count("ack") > 0, "handshake ack");
  return client;
}

type Change = { userId: string; role: "editor" | "viewer" | null; accessVersion: number };

function postAccess(id: string, changes: Change[], secret = "test-secret"): Promise<Response> {
  return SELF.fetch(`http://sync.test/internal/documents/${id}/access`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ changes }),
  });
}

/** Apply access changes, as the Next app does after a share change. */
async function changeAccess(id: string, changes: Change[]): Promise<void> {
  expect((await postAccess(id, changes)).status).toBe(204);
}

function presence(userId: string, name: string, clientDoc = new Y.Doc()): Uint8Array {
  const awareness = new Awareness(clientDoc);
  awareness.setLocalStateField("user", { id: userId, name });
  const update = encodeAwarenessUpdate(awareness, [clientDoc.clientID]);
  awareness.destroy();
  return update;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  memoryStore.rows.clear();
});

describe("authentication at the router", () => {
  it("refuses a missing or invalid token before any room exists", async () => {
    const id = seed();
    const before = (await listDurableObjectIds(env.DOCUMENT_ROOM)).length;
    for (const protocol of [undefined, "brahma.v1", "brahma.v1, auth.not-a-token", "auth.x.y.z"]) {
      const response = await TestClient.rawUpgrade(id, protocol ? { "Sec-WebSocket-Protocol": protocol } : {});
      expect(response.status).toBe(401);
    }
    expect((await listDurableObjectIds(env.DOCUMENT_ROOM)).length).toBe(before);
  });

  it("refuses a token for another document", async () => {
    const token = await tokenFor(newDocumentId(), EDITOR);
    const response = await TestClient.rawUpgrade(seed(), { "Sec-WebSocket-Protocol": `brahma.v1, auth.${token}` });
    expect(response.status).toBe(401);
  });

  it("echoes only brahma.v1 as the selected subprotocol, never the token", async () => {
    const client = await TestClient.connect(seed());
    expect(client.response.headers.get("Sec-WebSocket-Protocol")).toBe("brahma.v1");
  });

  it("ignores identity headers sent by a client", async () => {
    const forged = JSON.stringify({ userId: "x", role: "owner", av: 0, name: "", image: null, exp: 9e9 });
    const spoofer = await TestClient.connect(seed("original"), {
      as: VIEWER,
      headers: { "X-Brahma-Identity": forged },
    });
    await spoofer.until(() => spoofer.count("sync-step-1") > 0, "connected");
    spoofer.edit((doc) => doc.getText("body").insert(0, "nope "));
    await spoofer.until(() => spoofer.closed !== null, "closed");
    expect(spoofer.closed?.code).toBe(4405);
  });
});

describe("read-only viewers", () => {
  it("drops a viewer's update and closes with 4405", async () => {
    const id = seed("original");
    await joined(id);
    const viewer = await joined(id, VIEWER);
    expect(viewer.text()).toBe("original");

    viewer.edit((doc) => doc.getText("body").insert(0, "vandal "));
    await viewer.until(() => viewer.closed !== null, "viewer closed");
    expect(viewer.closed?.code).toBe(4405);

    const late = await joined(id);
    expect(late.text()).toBe("original");
  });

  it("treats a deletion-only update from a viewer as a write", async () => {
    const id = seed("original");
    const viewer = await joined(id, VIEWER);

    const before = Y.encodeStateVector(viewer.doc);
    viewer.doc.getText("body").delete(0, 4);
    const update = Y.encodeStateAsUpdate(viewer.doc, before);
    const decoded = Y.decodeUpdate(update);
    expect(decoded.structs).toHaveLength(0);
    expect(decoded.ds.clients.size).toBeGreaterThan(0);

    viewer.send(encodeUpdate(update));
    await viewer.until(() => viewer.closed !== null, "viewer closed");
    expect(viewer.closed?.code).toBe(4405);

    const late = await joined(id);
    expect(late.text()).toBe("original");
  });

  it("still lets viewers receive live edits", async () => {
    const id = seed();
    const editor = await joined(id);
    const viewer = await joined(id, VIEWER);
    editor.edit((doc) => doc.getText("body").insert(0, "live"));
    await viewer.until(() => viewer.text() === "live", "viewer sees the edit");
  });
});

describe("presence bound to identity", () => {
  it("rewrites the name to the token's value", async () => {
    const id = seed();
    const editor = await joined(id);
    const viewer = await joined(id, VIEWER);
    editor.send(encodeAwareness(presence(EDITOR.sub, "Not really Ada")));
    await viewer.until(() => viewer.count("awareness") > 0, "presence relayed");

    const relayed = new Awareness(new Y.Doc());
    applyAwarenessUpdate(relayed, viewer.last("awareness")!.update, "test");
    const users = [...relayed.getStates().values()].map((state) => state.user).filter(Boolean);
    expect(users.at(-1)).toMatchObject({ id: EDITOR.sub, name: "Ada" });
    relayed.destroy();
  });

  it("rejects presence claiming another user's id", async () => {
    const attacker = await joined(seed(), VIEWER);
    attacker.send(encodeAwareness(presence(EDITOR.sub, "Ada")));
    await attacker.until(() => attacker.closed !== null, "closed");
    expect(attacker.closed?.code).toBe(1008);
  });

  it("rejects reusing another socket's presence id", async () => {
    const id = seed();
    const victim = await joined(id);
    const clientDoc = new Y.Doc();
    victim.send(encodeAwareness(presence(EDITOR.sub, "Ada", clientDoc)));
    const attacker = await joined(id, VIEWER);
    await attacker.until(() => attacker.count("awareness") > 0, "sees the victim");

    // Same client id with the attacker's own user id: still not theirs to use.
    attacker.send(encodeAwareness(presence(VIEWER.sub, "Vera", clientDoc)));
    await attacker.until(() => attacker.closed !== null, "closed");
    expect(attacker.closed?.code).toBe(1008);
    expect(victim.closed).toBeNull();
  });

  it("lets the same user's reconnect take over a presence id from a socket that vanished without closing", async () => {
    const id = seed();
    const watcher = await joined(id, VIEWER);
    // A phone in airplane mode: its socket is gone, but no close frame ever
    // reached the room, so the room still holds it and its presence id.
    const dropped = await joined(id);
    const clientDoc = new Y.Doc();
    dropped.send(encodeAwareness(presence(EDITOR.sub, "Ada", clientDoc)));
    await watcher.until(() => watcher.count("awareness") > 0, "presence relayed");

    // Back online, the same tab reconnects and announces the same client id.
    const reconnected = await joined(id);
    const before = watcher.count("awareness");
    reconnected.send(encodeAwareness(presence(EDITOR.sub, "Ada", clientDoc)));

    // The old socket is retired; the new one keeps working and its presence is relayed.
    await dropped.until(() => dropped.closed !== null, "stale socket closed");
    expect(dropped.closed?.code).toBe(1000);
    await watcher.until(() => watcher.count("awareness") > before, "new presence relayed");
    reconnected.edit((doc) => doc.getText("body").insert(0, "after the drop"));
    await reconnected.until(() => reconnected.count("ack") > 0, "edit acknowledged");
    expect(reconnected.closed).toBeNull();
  });
});

describe("live access changes", () => {
  it("downgrades an editor to viewer on the open socket", async () => {
    const id = seed();
    const editor = await joined(id);
    await changeAccess(id, [{ userId: EDITOR.sub, role: "viewer", accessVersion: 2 }]);
    await editor.until(() => editor.last("role")?.role === "viewer", "role message");
    editor.edit((doc) => doc.getText("body").insert(0, "too late"));
    await editor.until(() => editor.closed !== null, "closed");
    expect(editor.closed?.code).toBe(4405);
  });

  it("upgrades a viewer to editor without reconnecting", async () => {
    const id = seed();
    const viewer = await joined(id, VIEWER);
    const acks = viewer.count("ack");
    await changeAccess(id, [{ userId: VIEWER.sub, role: "editor", accessVersion: 2 }]);
    await viewer.until(() => viewer.last("role")?.role === "editor", "role message");
    viewer.edit((doc) => doc.getText("body").insert(0, "now I can"));
    await viewer.until(() => viewer.count("ack") > acks, "acked");
    expect(viewer.closed).toBeNull();
  });

  it("closes a revoked user's sockets with 4403 and leaves others alone", async () => {
    const id = seed();
    const editor = await joined(id);
    const other = await joined(id, VIEWER);
    await changeAccess(id, [{ userId: EDITOR.sub, role: null, accessVersion: 2 }]);
    await editor.until(() => editor.closed !== null, "closed");
    expect(editor.closed?.code).toBe(4403);
    await sleep(100);
    expect(other.closed).toBeNull();
  });

  it("never touches the owner", async () => {
    const id = seed();
    const owner = await joined(id, OWNER);
    const acks = owner.count("ack");
    await changeAccess(id, [{ userId: OWNER.sub, role: null, accessVersion: 5 }]);
    owner.edit((doc) => doc.getText("body").insert(0, "mine"));
    await owner.until(() => owner.count("ack") > acks, "acked");
    expect(owner.closed).toBeNull();
  });

  it("requires the internal secret", async () => {
    expect((await postAccess(seed(), [], "wrong")).status).toBe(401);
  });
});

describe("stale tokens after an access change", () => {
  it("caps an older token to the newer role", async () => {
    const id = seed();
    await changeAccess(id, [{ userId: EDITOR.sub, role: "viewer", accessVersion: 2 }]);
    const stale = await joined(id, { ...EDITOR, av: 1 });
    await stale.until(() => stale.last("role")?.role === "viewer", "capped");
    stale.edit((doc) => doc.getText("body").insert(0, "x"));
    await stale.until(() => stale.closed !== null, "closed");
    expect(stale.closed?.code).toBe(4405);
  });

  it("refuses an older token after access was removed", async () => {
    const id = seed();
    await changeAccess(id, [{ userId: EDITOR.sub, role: null, accessVersion: 2 }]);
    const stale = await TestClient.connect(id, { as: { ...EDITOR, av: 1 } });
    await stale.until(() => stale.closed !== null, "refused");
    expect(stale.closed?.code).toBe(4403);
  });

  it("honors a token issued at or after the latest change", async () => {
    const id = seed();
    await changeAccess(id, [{ userId: EDITOR.sub, role: "viewer", accessVersion: 2 }]);
    const fresh = await joined(id, { ...EDITOR, av: 3 });
    const acks = fresh.count("ack");
    fresh.edit((doc) => doc.getText("body").insert(0, "invited again as editor"));
    await fresh.until(() => fresh.count("ack") > acks, "acked");
    expect(fresh.closed).toBeNull();
  });

  it("ends in the newer role when two quick changes arrive in reverse order", async () => {
    const id = seed();
    const client = await joined(id);
    // The owner made Ada a viewer (version 2), then an editor again (version 3);
    // delivery raced and version 3 arrived first.
    await changeAccess(id, [{ userId: EDITOR.sub, role: "editor", accessVersion: 3 }]);
    await changeAccess(id, [{ userId: EDITOR.sub, role: "viewer", accessVersion: 2 }]);
    await sleep(100);
    expect(client.last("role")).toBeUndefined();

    const acks = client.count("ack");
    client.edit((doc) => doc.getText("body").insert(0, "still an editor"));
    await client.until(() => client.count("ack") > acks, "acked");
    expect(client.closed).toBeNull();
    // And a reconnect with a token from between the two changes is capped to the newer one.
    const between = await joined(id, { ...EDITOR, role: "viewer", av: 2 });
    await between.until(() => between.last("role")?.role === "editor", "raised to the newer role");
  });

  it("ignores an access change older than one already applied", async () => {
    const id = seed();
    await changeAccess(id, [{ userId: EDITOR.sub, role: "editor", accessVersion: 5 }]);
    await changeAccess(id, [{ userId: EDITOR.sub, role: null, accessVersion: 4 }]);
    const client = await joined(id, { ...EDITOR, av: 5 });
    expect(client.closed).toBeNull();
  });
});

describe("token expiry and refresh", () => {
  // Issued so it expires two seconds from now.
  const nearlyExpired = () => Math.floor(Date.now() / 1000) - 10 * 60 + 2;

  it("closes with 4401 once the token has expired", async () => {
    const id = seed();
    const client = await TestClient.connect(id, { token: await tokenFor(id, EDITOR, nearlyExpired()) });
    await client.until(() => client.count("sync-step-1") > 0, "connected");
    await sleep(3_000);
    client.send(encodeSyncStep1(client.doc));
    await client.until(() => client.closed !== null, "closed");
    expect(client.closed?.code).toBe(4401);
  }, 10_000);

  it("keeps the socket open when the client refreshes in band", async () => {
    const id = seed();
    const client = await TestClient.connect(id, { token: await tokenFor(id, EDITOR, nearlyExpired()) });
    await client.until(() => client.count("sync-step-1") > 0, "connected");
    client.send(encodeAuth(await tokenFor(id, EDITOR)));
    await sleep(3_000);
    client.edit((doc) => doc.getText("body").insert(0, "still here"));
    await client.until(() => client.count("ack") > 0, "acked after refresh");
    expect(client.closed).toBeNull();
  }, 10_000);

  it("rejects a refresh with a token for someone else", async () => {
    const id = seed();
    const client = await joined(id);
    client.send(encodeAuth(await tokenFor(id, { ...EDITOR, sub: "someone-else" })));
    await client.until(() => client.closed !== null, "closed");
    expect(client.closed?.code).toBe(4401);
  });

  it("applies a downgrade carried by a refreshed token", async () => {
    const id = seed();
    const client = await joined(id);
    client.send(encodeAuth(await tokenFor(id, { ...EDITOR, role: "viewer", av: 2 })));
    await client.until(() => client.last("role")?.role === "viewer", "role message");
  });
});
