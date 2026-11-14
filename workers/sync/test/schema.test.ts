import { CLOSE_CLIENT_OUTDATED, CLOSE_SCHEMA_UNSUPPORTED, encodeSyncStep1 } from "@brahma/protocol";
import { env, evictDurableObject, runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
import { decideSchema } from "../src/schema-policy";
import { memoryStore } from "../src/store";
import { TestClient, newDocumentId } from "./client";

function seed(text = ""): string {
  const id = newDocumentId();
  const doc = new Y.Doc();
  if (text) doc.getText("body").insert(0, text);
  memoryStore.rows.set(id, { state: Y.encodeStateAsUpdate(doc), title: "" });
  return id;
}

/** Connect and finish the handshake, as the editor does. */
async function joined(id: string, schema: number | null = 1): Promise<TestClient> {
  const client = await TestClient.connect(id, { schema });
  await client.until(() => client.count("sync-step-1") > 0 || client.closed !== null, "server step 1");
  if (client.closed) return client;
  client.send(encodeSyncStep1(client.doc));
  await client.until(() => client.count("sync-step-2") > 0, "server step 2");
  client.answerStep1();
  await client.until(() => client.count("ack") > 0, "handshake ack");
  return client;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function stubFor(id: string) {
  return env.DOCUMENT_ROOM.get(env.DOCUMENT_ROOM.idFromName(id));
}

/** The newest version the room remembers, straight from its storage. */
function remembered(id: string): Promise<number> {
  return runInDurableObject(stubFor(id), async (_instance, state) => {
    const rows = state.storage.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'newest_schema'").toArray();
    return Number(rows[0]?.value ?? 0);
  });
}

/** Run with a different SCHEMA_VERSION_MAX, as after redeploying with another config. */
async function withMax<T>(id: string, max: string, run: () => Promise<T>): Promise<T> {
  const setMax = (value: string) =>
    runInDurableObject(stubFor(id), async (instance) => {
      (instance as unknown as { env: { SCHEMA_VERSION_MAX: string } }).env.SCHEMA_VERSION_MAX = value;
    });
  await setMax(max);
  try {
    return await run();
  } finally {
    await setMax("5");
  }
}

describe("decideSchema", () => {
  const bounds = { min: 2, max: 4 };
  it.each([
    ["above max", 5, 3, { kind: "unsupported" }],
    ["far above max", 999, 3, { kind: "unsupported" }],
    ["below min", 1, 0, { kind: "outdated" }],
    ["below the remembered newest", 2, 3, { kind: "outdated" }],
    ["equal to the newest", 3, 3, { kind: "accept", record: null, raised: false }],
    ["newer than the newest", 4, 3, { kind: "accept", record: 4, raised: true }],
    ["first client in a new room", 2, 0, { kind: "accept", record: 2, raised: false }],
    ["after a rollback lowered max below the remembered value", 4, 7, { kind: "accept", record: 4, raised: false }],
  ] as const)("%s", (_label, claim, remembered, expected) => {
    expect(decideSchema(claim, remembered, bounds)).toEqual(expected);
  });
});

beforeEach(() => memoryStore.rows.clear());

describe("document schema versions", () => {
  it("refuses a client older than the newest version the document has seen, before it can write", async () => {
    const id = seed("original");
    await joined(id, 2);

    const stale = await TestClient.connect(id, { schema: 1 });
    // It writes at once, as a stale client with queued edits would.
    stale.edit((doc) => doc.getText("body").insert(0, "stale "));
    await stale.until(() => stale.closed !== null, "refused");
    expect(stale.closed?.code).toBe(CLOSE_CLIENT_OUTDATED);
    expect(stale.count("sync-step-1")).toBe(0);

    const check = await joined(id, 2);
    expect(check.text()).toBe("original");
  });

  it("closes clients already connected with an older version when a newer one joins", async () => {
    const id = seed();
    const old = await joined(id, 1);
    const sameVersion = await joined(id, 1);
    await joined(id, 2);
    await old.until(() => old.closed !== null, "old client closed");
    expect(old.closed?.code).toBe(CLOSE_CLIENT_OUTDATED);
    expect(sameVersion.closed?.code).toBe(CLOSE_CLIENT_OUTDATED);
  });

  it("lets clients on the same or a newer version work", async () => {
    const id = seed();
    const first = await joined(id, 2);
    const same = await joined(id, 2);
    const newer = await joined(id, 3);
    await first.until(() => first.closed !== null, "older closed by the newer one");
    await sleep(100);
    expect(same.closed?.code).toBe(CLOSE_CLIENT_OUTDATED);
    const acks = newer.count("ack");
    newer.edit((doc) => doc.getText("body").insert(0, "fine"));
    await newer.until(() => newer.count("ack") > acks, "acked");
    expect(newer.closed).toBeNull();
  });

  it("refuses a claim above the deployment's max, records nothing, and keeps honest clients working", async () => {
    const id = seed();
    const honest = await joined(id, 1);

    const attacker = await TestClient.connect(id, { schema: 999 });
    await attacker.until(() => attacker.closed !== null, "refused");
    expect(attacker.closed?.code).toBe(CLOSE_SCHEMA_UNSUPPORTED);
    expect(await remembered(id)).toBe(1);

    await sleep(100);
    expect(honest.closed).toBeNull();
    const later = await joined(id, 1);
    expect(later.closed).toBeNull();
    const acks = later.count("ack");
    later.edit((doc) => doc.getText("body").insert(0, "still editing"));
    await later.until(() => later.count("ack") > acks, "acked");
  });

  it("lets current clients back in after a rollback lowers max", async () => {
    const id = seed();
    await joined(id, 3);
    expect(await remembered(id)).toBe(3);

    await withMax(id, "2", async () => {
      // The rolled-back app's clients run version 2: they get in.
      const current = await joined(id, 2);
      expect(current.closed).toBeNull();
      expect(await remembered(id)).toBe(2);
      // A tab still running the withdrawn version 3 is refused, not recorded.
      const withdrawn = await TestClient.connect(id, { schema: 3 });
      await withdrawn.until(() => withdrawn.closed !== null, "refused");
      expect(withdrawn.closed?.code).toBe(CLOSE_SCHEMA_UNSUPPORTED);
      expect(await remembered(id)).toBe(2);
    });
  });

  it("refuses a client below the deployment's min, even in a new room", async () => {
    const unnamed = await TestClient.connect(seed(), { schema: null });
    await unnamed.until(() => unnamed.closed !== null, "refused");
    expect(unnamed.closed?.code).toBe(CLOSE_CLIENT_OUTDATED);
  });

  it("treats a client that names no version as the oldest", async () => {
    const id = seed();
    await joined(id, 1);
    const unnamed = await TestClient.connect(id, { schema: null });
    await unnamed.until(() => unnamed.closed !== null, "refused");
    expect(unnamed.closed?.code).toBe(CLOSE_CLIENT_OUTDATED);
  });

  it("remembers the newest version after the room is evicted", async () => {
    const id = seed();
    const client = await joined(id, 4);
    client.close();
    await evictDurableObject(env.DOCUMENT_ROOM.get(env.DOCUMENT_ROOM.idFromName(id)));
    const stale = await TestClient.connect(id, { schema: 3 });
    await stale.until(() => stale.closed !== null, "refused after eviction");
    expect(stale.closed?.code).toBe(CLOSE_CLIENT_OUTDATED);
  });

  it("still echoes only brahma.v1 as the selected subprotocol", async () => {
    const client = await TestClient.connect(seed(), { schema: 5 });
    expect(client.response.headers.get("Sec-WebSocket-Protocol")).toBe("brahma.v1");
  });
});
