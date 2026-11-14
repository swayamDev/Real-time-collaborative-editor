import { CLOSE_CLIENT_OUTDATED, encodeSyncStep1 } from "@brahma/protocol";
import { env, evictDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import * as Y from "yjs";
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
    const client = await TestClient.connect(seed(), { schema: 7 });
    expect(client.response.headers.get("Sec-WebSocket-Protocol")).toBe("brahma.v1");
  });
});
