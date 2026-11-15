import {
  CLOSE_MALFORMED,
  CLOSE_NOT_FOUND,
  CLOSE_TOO_LARGE,
  MAX_MESSAGE_BYTES,
  encodeAwareness,
  encodeSyncStep1,
  encodeUpdate,
} from "@brahma/protocol";
import { SELF, env, evictDurableObject, runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { Awareness, encodeAwarenessUpdate } from "y-protocols/awareness";
import * as Y from "yjs";
import type { DocumentRoom } from "../src/room";
import { memoryStore } from "../src/store";
import { EDITOR, type TestUser, TestClient, newDocumentId } from "./client";

function seed(title = "", text = ""): string {
  const id = newDocumentId();
  const doc = new Y.Doc();
  if (text) doc.getText("body").insert(0, text);
  memoryStore.rows.set(id, { state: Y.encodeStateAsUpdate(doc), title });
  return id;
}

function stubFor(id: string) {
  return env.DOCUMENT_ROOM.get(env.DOCUMENT_ROOM.idFromName(id));
}

function updateRows(id: string): Promise<number> {
  return runInDurableObject(stubFor(id), async (_instance, state) => {
    return state.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM updates").one().n;
  });
}

/** Connect and finish the handshake so the client holds the server state. */
async function joined(id: string, as: TestUser = EDITOR): Promise<TestClient> {
  const client = await TestClient.connect(id, { as });
  await client.until(() => client.count("sync-step-1") > 0, "server step 1");
  client.send(encodeSyncStep1(client.doc));
  await client.until(() => client.count("sync-step-2") > 0, "server step 2");
  client.answerStep1();
  await client.until(() => client.count("ack") > 0, "handshake ack");
  return client;
}

beforeEach(() => {
  memoryStore.rows.clear();
});

describe("router", () => {
  it("answers health checks", async () => {
    expect(await (await SELF.fetch("http://sync.test/health")).text()).toBe("ok");
  });

  it("rejects invalid document ids before creating a room", async () => {
    const response = await SELF.fetch("http://sync.test/documents/not-a-uuid", { headers: { Upgrade: "websocket" } });
    expect(response.status).toBe(400);
  });

  it("requires a WebSocket upgrade", async () => {
    const response = await SELF.fetch(`http://sync.test/documents/${newDocumentId()}`);
    expect(response.status).toBe(426);
  });

  it("rejects browser origins that are not allowed", async () => {
    const response = await SELF.fetch(`http://sync.test/documents/${newDocumentId()}`, {
      headers: { Upgrade: "websocket", Origin: "https://evil.example" },
    });
    expect(response.status).toBe(403);
  });
});

describe("loading", () => {
  it("closes with 4404 when the document does not exist", async () => {
    const client = await TestClient.connect(newDocumentId());
    await client.until(() => client.closed !== null, "close");
    expect(client.closed?.code).toBe(CLOSE_NOT_FOUND);
  });

  it("loads a Phase 1 document from Postgres and seeds the title from the column", async () => {
    const id = seed("Q3 planning notes", "Hello from Phase 1");
    const client = await joined(id);
    expect(client.text()).toBe("Hello from Phase 1");
    expect(client.text("title")).toBe("Q3 planning notes");
  });
});

describe("sync", () => {
  it("relays an update to other clients, not back to the sender", async () => {
    const id = seed();
    const a = await joined(id);
    const b = await joined(id);
    const aUpdatesBefore = a.count("update");

    a.edit((doc) => doc.getText("body").insert(0, "typed in A"));
    await b.until(() => b.text() === "typed in A", "relay to B");
    expect(a.count("update")).toBe(aUpdatesBefore);
  });

  it("acks after storing, with a cumulative count per connection", async () => {
    const id = seed();
    const a = await joined(id);
    const handshakeAcks = a.last("ack")!.count;

    a.edit((doc) => doc.getText("body").insert(0, "x"));
    await a.until(() => a.last("ack")!.count === handshakeAcks + 1, "ack for the edit");
  });

  it("coalesces a burst of keystrokes into one storage row and one ack", async () => {
    const id = seed();
    const a = await joined(id);
    const rowsBefore = await updateRows(id);
    const acksBefore = a.count("ack");
    const countBefore = a.last("ack")!.count;

    for (const character of "keystrokes") {
      a.edit((doc) => doc.getText("body").insert(doc.getText("body").length, character));
    }
    await a.until(() => a.last("ack")!.count === countBefore + 10, "ack covering the burst");

    expect(a.count("ack") - acksBefore).toBe(1);
    expect((await updateRows(id)) - rowsBefore).toBe(1);
  });

  it("gives a late joiner the full document", async () => {
    const id = seed();
    const a = await joined(id);
    a.edit((doc) => doc.getText("body").insert(0, "before B joined"));
    await a.until(() => a.last("ack")!.count >= 2, "stored");

    const b = await joined(id);
    expect(b.text()).toBe("before B joined");
  });
});

describe("presence", () => {
  function awarenessUpdate(name: string, userId = EDITOR.sub): { awareness: Awareness; update: Uint8Array } {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    awareness.setLocalStateField("user", { id: userId, name });
    const update = encodeAwarenessUpdate(awareness, [doc.clientID]);
    awareness.destroy();
    return { awareness, update };
  }

  it("relays presence, sends it to late joiners, and removes it when a socket closes", async () => {
    const id = seed();
    const a = await joined(id);
    const b = await joined(id);

    a.send(encodeAwareness(awarenessUpdate("Ada").update));
    await b.until(() => b.count("awareness") > 0, "presence relayed to B");

    const c = await TestClient.connect(id);
    await c.until(() => c.count("awareness") > 0, "existing presence for C");

    const bCount = b.count("awareness");
    a.close();
    await b.until(() => b.count("awareness") > bCount, "removal relayed to B");
  });
});

describe("rejecting bad input without breaking the room", () => {
  it("closes only the offending socket for malformed messages", async () => {
    const id = seed("", "intact");
    const good = await joined(id);

    for (const bad of [
      Uint8Array.of(42),
      Uint8Array.of(0, 2, 200, 1),
      encodeUpdate(Uint8Array.of(255, 255, 255, 255)),
      encodeAwareness(Uint8Array.of(1, 1, 1, 3, 123)),
    ]) {
      const attacker = await joined(id);
      attacker.send(bad);
      await attacker.until(() => attacker.closed !== null, "attacker closed");
      expect(attacker.closed?.code).toBe(CLOSE_MALFORMED);
    }

    const text = await joined(id);
    text.send("not binary");
    await text.until(() => text.closed !== null, "text frame closed");
    expect(text.closed?.code).toBe(CLOSE_MALFORMED);

    good.edit((doc) => doc.getText("body").insert(6, " and working"));
    const late = await joined(id);
    await late.until(() => late.text() === "intact and working", "room still works");
  });

  it("closes the socket for messages over the size limit", async () => {
    const id = seed();
    const client = await joined(id);
    client.send(new Uint8Array(MAX_MESSAGE_BYTES + 1));
    await client.until(() => client.closed !== null, "closed");
    expect(client.closed?.code).toBe(CLOSE_TOO_LARGE);
  });

  it("rejects a client that sends an ack", async () => {
    const id = seed();
    const client = await joined(id);
    client.send(Uint8Array.of(4, 1));
    await client.until(() => client.closed !== null, "closed");
    expect(client.closed?.code).toBe(CLOSE_MALFORMED);
  });
});

describe("hibernation", () => {
  it("rebuilds the document from storage and asks clients to resend presence", async () => {
    const id = seed();
    const a = await joined(id);
    const b = await joined(id);
    a.edit((doc) => doc.getText("body").insert(0, "survives eviction"));
    await a.until(() => a.last("ack")!.count >= 2, "stored");

    await evictDurableObject(stubFor(id));

    // The sockets stay open; the next message wakes a fresh instance.
    b.edit((doc) => doc.getText("body").insert(0, "after wake: "));
    await a.until(() => a.text() === "after wake: survives eviction", "relay after wake");
    await a.until(() => a.count("query-awareness") > 0, "presence query after wake");

    const late = await joined(id);
    expect(late.text()).toBe("after wake: survives eviction");
  });
});

function savedBody(id: string): string {
  const row = memoryStore.rows.get(id);
  if (!row) return "";
  const saved = new Y.Doc();
  Y.applyUpdate(saved, row.state);
  return saved.getText("body").toString();
}

async function waitUntil(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("snapshots to Postgres", () => {
  function alarmAt(id: string): Promise<number | null> {
    return runInDurableObject(stubFor(id), (_instance, state) => state.storage.getAlarm());
  }

  it("debounces a snapshot after edits and copies content and title", async () => {
    const id = seed("Old title");
    const a = await joined(id);
    a.edit((doc) => {
      doc.getText("body").insert(0, "snapshot me");
      const title = doc.getText("title");
      title.delete(0, title.length);
      title.insert(0, "  New\ttitle  ");
    });
    await a.until(() => a.last("ack")!.count >= 2, "stored");

    const due = await alarmAt(id);
    expect(due).not.toBeNull();
    expect(due! - Date.now()).toBeGreaterThan(500);
    expect(due! - Date.now()).toBeLessThanOrEqual(2_000);

    // The runtime fires the alarm on its own about 2 seconds after the write.
    await waitUntil(() => savedBody(id) === "snapshot me", 4_000, "snapshot");
    const row = memoryStore.rows.get(id)!;
    const saved = new Y.Doc();
    Y.applyUpdate(saved, row.state);
    expect(saved.getText("body").toString()).toBe("snapshot me");
    // The column gets the cleaned title, as Phase 1 validation produced.
    expect(row.title).toBe("New title");
  });

  it("sets the alarm once per snapshot cycle, not once per batch", async () => {
    const id = seed();
    const a = await joined(id);
    a.edit((doc) => doc.getText("body").insert(0, "first batch"));
    await a.until(() => a.last("ack")!.count >= 2, "stored");
    const first = await alarmAt(id);

    await new Promise((resolve) => setTimeout(resolve, 300));
    a.edit((doc) => doc.getText("body").insert(0, "second batch "));
    await a.until(() => a.last("ack")!.count >= 3, "stored again");
    // Each setAlarm() is a billed row write; a later batch must not move it.
    expect(await alarmAt(id)).toBe(first);
  });

  it("pushes the snapshot back while typing continues", async () => {
    const id = seed();
    const a = await joined(id);
    a.edit((doc) => doc.getText("body").insert(0, "still typing"));
    await a.until(() => a.last("ack")!.count >= 2, "stored");
    const savesBefore = memoryStore.saves;

    // The alarm fires early relative to the last write: it reschedules instead of saving.
    await runInDurableObject(stubFor(id), (instance) => (instance as unknown as DocumentRoom).alarm());
    expect(memoryStore.saves).toBe(savesBefore);
    expect((await alarmAt(id))! - Date.now()).toBeGreaterThan(500);
  });

  it("saves at the ten second cap even while typing continues", async () => {
    const id = seed();
    const a = await joined(id);
    a.edit((doc) => doc.getText("body").insert(0, "x"));
    await a.until(() => a.last("ack")!.count >= 2, "stored");
    // Pretend the oldest unsaved edit happened 10.5 seconds ago.
    await runInDurableObject(stubFor(id), (_instance, state) => {
      state.storage.sql.exec("UPDATE meta SET value = ? WHERE key = 'dirty_since'", String(Date.now() - 10_500));
    });
    a.edit((doc) => doc.getText("body").insert(0, "y"));
    await a.until(() => a.last("ack")!.count >= 3, "stored again");
    const savesBefore = memoryStore.saves;

    await runInDurableObject(stubFor(id), (instance) => (instance as unknown as DocumentRoom).alarm());
    expect(memoryStore.saves).toBe(savesBefore + 1);
  });

  it("snapshots immediately when the last client leaves", async () => {
    const id = seed();
    const a = await joined(id);
    a.edit((doc) => doc.getText("body").insert(0, "leaving"));
    const left = Date.now();
    a.close();

    // Well under the 2 second debounce: the alarm was set to fire now.
    const savedText = () => {
      const saved = new Y.Doc();
      Y.applyUpdate(saved, memoryStore.rows.get(id)!.state);
      return saved.getText("body").toString();
    };
    while (savedText() !== "leaving") {
      if (Date.now() - left > 1_500) throw new Error("No snapshot after the last client left");
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });

  it("keeps the edits dirty and retries when Postgres fails", async () => {
    const id = seed();
    const a = await joined(id);
    a.edit((doc) => doc.getText("body").insert(0, "retry me"));
    await a.until(() => a.last("ack")!.count >= 2, "stored");

    // Leaving makes the snapshot urgent; the first attempt fails.
    memoryStore.failNextSave = true;
    a.close();
    // The runtime retries a throwing alarm with backoff (2s first).
    await waitUntil(() => savedBody(id) === "retry me", 8_000, "retried snapshot");
  });

  it("deletes the room when the Postgres row is gone", async () => {
    const id = seed();
    const a = await joined(id);
    a.edit((doc) => doc.getText("body").insert(0, "orphan"));
    await a.until(() => a.last("ack")!.count >= 2, "stored");
    memoryStore.rows.delete(id);

    await runInDurableObject(stubFor(id), (instance) => (instance as unknown as DocumentRoom).alarm());
    await a.until(() => a.closed !== null, "closed");
    expect(a.closed?.code).toBe(4410);
    expect(await alarmAt(id)).toBeNull();
  });
});

describe("internal API", () => {
  function internal(path: string, init: RequestInit & { secret?: string } = {}) {
    const { secret = "test-secret", ...rest } = init;
    return SELF.fetch(`http://sync.test/internal/documents/${path}`, {
      ...rest,
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    });
  }

  it("rejects a wrong or missing secret", async () => {
    const id = seed();
    expect((await internal(id, { method: "DELETE", secret: "wrong" })).status).toBe(401);
    expect((await internal(id, { method: "DELETE", secret: "" })).status).toBe(401);
    expect((await internal(id, { method: "DELETE", secret: "test-secret-but-longer" })).status).toBe(401);
  });

  it("renames through the shared title so open editors update, and saves the column before answering", async () => {
    const id = seed("Before");
    const a = await joined(id);
    const response = await internal(`${id}/title`, { method: "POST", body: JSON.stringify({ title: "  After\nrename " }) });
    expect(response.status).toBe(200);
    // The sidebar list reads the column: it is current as soon as the rename returns.
    expect(memoryStore.rows.get(id)!.title).toBe("After rename");
    expect(await response.json()).toEqual({ title: "After rename" });
    await a.until(() => a.text("title") === "After rename", "title update reaches the editor");
  });

  it("returns 404 when renaming a document that does not exist", async () => {
    const response = await internal(`${newDocumentId()}/title`, { method: "POST", body: JSON.stringify({ title: "x" }) });
    expect(response.status).toBe(404);
  });

  it("deletes: closes sockets with 4410, removes the alarm and all storage", async () => {
    const id = seed();
    const a = await joined(id);
    a.edit((doc) => doc.getText("body").insert(0, "pending snapshot"));
    await a.until(() => a.last("ack")!.count >= 2, "stored");

    expect((await internal(id, { method: "DELETE" })).status).toBe(204);
    await a.until(() => a.closed !== null, "closed");
    expect(a.closed?.code).toBe(4410);

    await runInDurableObject(stubFor(id), async (_instance, state) => {
      expect(await state.storage.getAlarm()).toBeNull();
      const tables = state.storage.sql
        .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%'")
        .toArray();
      expect(tables).toEqual([]);
    });

    const again = await TestClient.connect(id);
    await again.until(() => again.closed !== null, "rejected");
    expect(again.closed?.code).toBe(4410);
  });
});

describe("tombstones", () => {
  it("closes with 4410 and stores nothing when the row is tombstoned before first load", async () => {
    const id = seed("Gone");
    memoryStore.rows.get(id)!.deleted = true;
    const client = await TestClient.connect(id);
    await client.until(() => client.closed !== null, "closed");
    expect(client.closed?.code).toBe(4410);
    await runInDurableObject(stubFor(id), (_instance, state) => {
      const tables = state.storage.sql
        .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%'")
        .toArray();
      expect(tables).toEqual([]);
    });
  });

  it("erases itself on the next connection when cleanup never reached it", async () => {
    const id = seed();
    const a = await joined(id);
    a.edit((doc) => doc.getText("body").insert(0, "before delete"));
    await a.until(() => a.last("ack")!.count >= 2, "stored");
    a.close();
    await a.until(() => a.closed !== null, "closed");

    // Tombstone in Postgres; the sync server cleanup call was never made.
    memoryStore.rows.get(id)!.deleted = true;
    await evictDurableObject(stubFor(id));

    const late = await TestClient.connect(id);
    await late.until(() => late.closed !== null, "rejected");
    expect(late.closed?.code).toBe(4410);
  });

  it("does not snapshot into a tombstoned row, and deletes the room instead", async () => {
    const id = seed();
    const a = await joined(id);
    a.edit((doc) => doc.getText("body").insert(0, "late edit"));
    await a.until(() => a.last("ack")!.count >= 2, "stored");
    const before = memoryStore.rows.get(id)!.state;
    const savesBefore = memoryStore.saves;
    memoryStore.rows.get(id)!.deleted = true;
    a.close();
    await a.until(() => a.closed !== null, "closed");
    await waitUntil(() => memoryStore.saves > savesBefore, 3_000, "snapshot attempt");
    // The room deleted itself, so it no longer holds an alarm.
    expect(await runInDurableObject(stubFor(id), (_instance, state) => state.storage.getAlarm())).toBeNull();
    expect(memoryStore.rows.get(id)!.state).toBe(before);
  });
});

describe("convergence check", () => {
  it("answers a client Step 1 with Step 2 and then its own Step 1", async () => {
    const id = seed("", "server text");
    const a = await joined(id);
    const step1Before = a.count("sync-step-1");
    const step2Before = a.count("sync-step-2");
    a.send(encodeSyncStep1(a.doc));
    await a.until(() => a.count("sync-step-1") > step1Before, "server state vector");
    expect(a.count("sync-step-2")).toBe(step2Before + 1);
    expect(a.last("sync-step-1")!.stateVector).toEqual(Y.encodeStateVector(a.doc));
  });
});
