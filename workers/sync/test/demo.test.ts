import {
  CLOSE_DELETED,
  CLOSE_DEMO_LIMIT,
  CLOSE_NOT_FOUND,
  CLOSE_SEAT_MOVED,
  encodeSyncStep1,
  encodeUpdate,
} from "@brahma/protocol";
import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { DEMO_MAX_BATCHES, DEMO_MAX_BYTES, type DocumentRoom } from "../src/room";
import { memoryStore } from "../src/store";
import { EDITOR, type TestUser, TestClient, newDocumentId } from "./client";

const seat = (id: string, letter: "a" | "b"): TestUser => ({
  sub: `demo:${id}:${letter}`,
  role: "editor",
  av: 0,
  name: `Visitor ${letter.toUpperCase()}`,
  demo: true,
});

function seedDemo(expiresInMs = 30 * 60 * 1000): string {
  const id = newDocumentId();
  memoryStore.rows.set(id, { state: Y.encodeStateAsUpdate(new Y.Doc()), title: "", demoExpiresAt: Date.now() + expiresInMs });
  return id;
}

function seedReal(): string {
  const id = newDocumentId();
  memoryStore.rows.set(id, { state: Y.encodeStateAsUpdate(new Y.Doc()), title: "" });
  return id;
}

function stubFor(id: string) {
  return env.DOCUMENT_ROOM.get(env.DOCUMENT_ROOM.idFromName(id));
}

async function joined(id: string, as: TestUser): Promise<TestClient> {
  const client = await TestClient.connect(id, { as });
  await client.until(() => client.count("sync-step-1") > 0 || client.closed !== null, "server step 1");
  if (client.closed) return client;
  client.send(encodeSyncStep1(client.doc));
  await client.until(() => client.count("sync-step-2") > 0, "server step 2");
  client.answerStep1();
  await client.until(() => client.count("ack") > 0, "handshake ack");
  return client;
}

async function closedWith(client: TestClient): Promise<number | undefined> {
  await client.until(() => client.closed !== null, "closed");
  return client.closed?.code;
}

describe("demo rooms", () => {
  it("syncs two seats live, and never writes a snapshot to Postgres", async () => {
    const id = seedDemo();
    const savesBefore = memoryStore.saves;
    const a = await joined(id, seat(id, "a"));
    const b = await joined(id, seat(id, "b"));
    a.edit((doc) => doc.getText("body").insert(0, "hello from A"));
    await b.until(() => b.text() === "hello from A", "B sees A");
    a.close();
    b.close();
    // Leaving would snapshot a real document at once; a demo never does.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(memoryStore.saves).toBe(savesBefore);
    const alarm = await runInDurableObject(stubFor(id), (_room, state) => state.storage.getAlarm());
    expect(alarm).toBe(memoryStore.rows.get(id)!.demoExpiresAt);
  });

  it("refuses a demo seat on a real document, and a real user on a demo document", async () => {
    const real = seedReal();
    const intruder = await TestClient.connect(real, { as: seat(real, "a") });
    expect(await closedWith(intruder)).toBe(CLOSE_NOT_FOUND);

    const demo = seedDemo();
    const realUser = await TestClient.connect(demo, { as: EDITOR });
    expect(await closedWith(realUser)).toBe(CLOSE_NOT_FOUND);
  });

  it("gives a seat to its newest connection (another device, or a reconnect)", async () => {
    const id = seedDemo();
    const laptop = await joined(id, seat(id, "b"));
    const phone = await joined(id, seat(id, "b"));
    expect(await closedWith(laptop)).toBe(CLOSE_SEAT_MOVED);
    phone.edit((doc) => doc.getText("body").insert(0, "from the phone"));
    await phone.until(() => phone.count("ack") > 1, "phone acknowledged");
    expect(phone.closed).toBeNull();
  });

  it("holds at most two sockets", async () => {
    const id = seedDemo();
    await joined(id, seat(id, "a"));
    await joined(id, seat(id, "b"));
    const third: TestUser = { ...seat(id, "a"), sub: `demo:${id}:c` };
    const extra = await TestClient.connect(id, { as: third });
    expect(await closedWith(extra)).toBe(CLOSE_DEMO_LIMIT);
  });

  it("closes the demo once it holds more than the size limit", async () => {
    const id = seedDemo();
    const a = await joined(id, seat(id, "a"));
    // One message over the limit is refused outright.
    const big = new Y.Doc();
    big.getText("body").insert(0, "x".repeat(DEMO_MAX_BYTES + 10));
    a.send(encodeUpdate(Y.encodeStateAsUpdate(big)));
    expect(await closedWith(a)).toBe(CLOSE_DEMO_LIMIT);
  });

  it("closes the demo after its write limit", async () => {
    const id = seedDemo();
    const a = await joined(id, seat(id, "a"));
    await runInDurableObject(stubFor(id), (_room, state) => {
      // Pretend the room already wrote its allowance of batches.
      state.storage.sql.exec("DELETE FROM sqlite_sequence WHERE name = 'updates'");
      state.storage.sql.exec("INSERT INTO sqlite_sequence (name, seq) VALUES ('updates', ?)", DEMO_MAX_BATCHES);
    });
    a.edit((doc) => doc.getText("body").insert(0, "one more"));
    expect(await closedWith(a)).toBe(CLOSE_DEMO_LIMIT);
  });

  it("erases itself when the demo ends, and an ended demo never loads again", async () => {
    const id = seedDemo();
    const a = await joined(id, seat(id, "a"));
    a.edit((doc) => doc.getText("body").insert(0, "short lived"));
    await a.until(() => a.count("ack") > 1, "stored");

    memoryStore.rows.get(id)!.demoExpiresAt = Date.now() - 1;
    await runInDurableObject(stubFor(id), async (room, state) => {
      state.storage.sql.exec("UPDATE meta SET value = ? WHERE key = 'demo_expires_at'", String(Date.now() - 1));
      await (room as unknown as DocumentRoom).alarm();
    });
    expect(await closedWith(a)).toBe(CLOSE_DELETED);
    const keys = await runInDurableObject(stubFor(id), (_room, state) =>
      state.storage.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'meta'").one().n,
    );
    expect(keys).toBe(0);

    const late = await TestClient.connect(id, { as: seat(id, "b") });
    expect(await closedWith(late)).toBe(CLOSE_DELETED);
  });
});
