import {
  CLOSE_MALFORMED,
  CLOSE_NOT_FOUND,
  CLOSE_TOO_LARGE,
  MAX_MESSAGE_BYTES,
  encodeAwareness,
  encodeSyncStep1,
  encodeUpdate,
} from "@brahma/protocol";
import { SELF, env, evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { Awareness, encodeAwarenessUpdate } from "y-protocols/awareness";
import * as Y from "yjs";
import { memoryStore } from "../src/store";
import { TestClient, newDocumentId } from "./client";

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
async function joined(id: string): Promise<TestClient> {
  const client = await TestClient.connect(id);
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
  function awarenessUpdate(name: string): { awareness: Awareness; update: Uint8Array } {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    awareness.setLocalStateField("user", { name });
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

    expect(await runDurableObjectAlarm(stubFor(id))).toBe(true);
    const row = memoryStore.rows.get(id)!;
    const saved = new Y.Doc();
    Y.applyUpdate(saved, row.state);
    expect(saved.getText("body").toString()).toBe("snapshot me");
    // The column gets the cleaned title, as Phase 1 validation produced.
    expect(row.title).toBe("New title");
  });

  it("caps the debounce at ten seconds after the oldest unsaved edit", async () => {
    const id = seed();
    const a = await joined(id);
    a.edit((doc) => doc.getText("body").insert(0, "x"));
    await a.until(() => a.last("ack")!.count >= 2, "stored");
    // Pretend the oldest unsaved edit happened 9.5 seconds ago.
    await runInDurableObject(stubFor(id), (_instance, state) => {
      state.storage.sql.exec("UPDATE meta SET value = ? WHERE key = 'dirty_since'", String(Date.now() - 9_500));
    });
    a.edit((doc) => doc.getText("body").insert(0, "y"));
    await a.until(() => a.last("ack")!.count >= 3, "stored again");
    expect((await alarmAt(id))! - Date.now()).toBeLessThanOrEqual(600);
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

    memoryStore.failNextSave = true;
    await expect(runInDurableObject(stubFor(id), (instance) => instance.alarm())).rejects.toThrow();
    await runInDurableObject(stubFor(id), (instance) => instance.alarm());

    const saved = new Y.Doc();
    Y.applyUpdate(saved, memoryStore.rows.get(id)!.state);
    expect(saved.getText("body").toString()).toBe("retry me");
  });

  it("deletes the room when the Postgres row is gone", async () => {
    const id = seed();
    const a = await joined(id);
    a.edit((doc) => doc.getText("body").insert(0, "orphan"));
    await a.until(() => a.last("ack")!.count >= 2, "stored");
    memoryStore.rows.delete(id);

    await runInDurableObject(stubFor(id), (instance) => instance.alarm());
    await a.until(() => a.closed !== null, "closed");
    expect(a.closed?.code).toBe(4410);
    expect(await alarmAt(id)).toBeNull();
  });
});
