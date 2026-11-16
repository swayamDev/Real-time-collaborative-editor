import { verifySyncToken } from "@brahma/protocol";
import { exportJWK, generateKeyPair } from "jose";
import { eq, like } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { appRateLimits, documents } from "@/db/schema";
import { getAccess } from "@/server/authz";
import { createDocument, listDocumentsFor } from "@/server/documents";
import { makeUser } from "./fixtures";
import { syncCalls } from "./mocks";

vi.mock("@/server/sync", async () => (await import("./mocks")).syncModule());

const { DEMO_USER_ID, cleanupExpiredDemos, demoTokenFor, startDemo } = await import("@/server/demo");

let publicKeys: { keys: object[] };

beforeAll(async () => {
  const pair = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
  process.env.SYNC_TOKEN_PRIVATE_KEY = JSON.stringify({ ...(await exportJWK(pair.privateKey)), kid: "test" });
  publicKeys = { keys: [{ ...(await exportJWK(pair.publicKey)), kid: "test", alg: "EdDSA", use: "sig" }] };
});

beforeEach(async () => {
  // The demo counters are shared with other runs.
  await db().delete(appRateLimits).where(like(appRateLimits.key, "demo%"));
  syncCalls.length = 0;
});

const address = () => `198.51.100.${Math.floor(Math.random() * 250) + 1}`;

async function setExpiry(id: string, at: Date) {
  await db().update(documents).set({ demoExpiresAt: at }).where(eq(documents.id, id));
}

async function exists(id: string): Promise<boolean> {
  return (await db().select({ id: documents.id }).from(documents).where(eq(documents.id, id))).length > 0;
}

describe("starting a demo", () => {
  it("creates a 30-minute document owned by the demo system user", async () => {
    const result = await startDemo(address());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [row] = await db().select().from(documents).where(eq(documents.id, result.pass.documentId));
    expect(row.ownerId).toBe(DEMO_USER_ID);
    expect(row.demoExpiresAt!.getTime()).toBe(result.pass.expiresAt);
    expect(result.pass.expiresAt - Date.now()).toBeGreaterThan(29 * 60 * 1000);
    expect(result.pass.seats).toBe("ab");
  });

  it("allows five demos per address an hour", async () => {
    const from = address();
    for (let i = 0; i < 5; i++) expect((await startDemo(from)).ok).toBe(true);
    expect(await startDemo(from)).toEqual({ ok: false, reason: "busy" });
    expect((await startDemo(address())).ok).toBe(true);
  });

  it("stops at the daily cap, whatever the address", async () => {
    await db().insert(appRateLimits).values({ key: "demoDaily:all", windowStart: new Date(), count: 30 });
    expect(await startDemo(address())).toEqual({ ok: false, reason: "busy" });
    expect(await startDemo(null)).toEqual({ ok: false, reason: "busy" });
  });
});

describe("demo tokens", () => {
  it("issues an editor token for one seat, marked as a demo", async () => {
    const result = await startDemo(address());
    if (!result.ok) throw new Error("no demo");
    const token = await demoTokenFor(result.pass, "b");
    if (!token.ok) throw new Error("no token");
    const claims = await verifySyncToken(token.token, publicKeys as never, result.pass.documentId);
    expect(claims).toMatchObject({ sub: `demo:${result.pass.documentId}:b`, role: "editor", name: "Visitor B", demo: true });
  });

  it("refuses once the demo has ended", async () => {
    const result = await startDemo(address());
    if (!result.ok) throw new Error("no demo");
    await setExpiry(result.pass.documentId, new Date(Date.now() - 1000));
    expect(await demoTokenFor(result.pass, "a")).toEqual({ ok: false, status: 410 });
  });
});

describe("demo documents and real users", () => {
  it("never appear in a real user's lists, and a real user cannot open one", async () => {
    const person = await makeUser("person");
    await createDocument(person.id, "Mine");
    const result = await startDemo(address());
    if (!result.ok) throw new Error("no demo");

    const lists = await listDocumentsFor(person.id);
    const ids = [...lists.mine, ...lists.shared].map((document) => document.id);
    expect(ids).not.toContain(result.pass.documentId);
    expect(ids.length).toBe(1);
    expect(await getAccess(person.id, result.pass.documentId)).toBeNull();
  });
});

describe("cleanup", () => {
  it("hard deletes ended demos, row and sync room", async () => {
    const result = await startDemo(address());
    if (!result.ok) throw new Error("no demo");
    await setExpiry(result.pass.documentId, new Date(Date.now() - 1000));
    expect(await cleanupExpiredDemos()).toBeGreaterThanOrEqual(1);
    expect(await exists(result.pass.documentId)).toBe(false);
    expect(syncCalls).toContainEqual({ call: "delete", args: [result.pass.documentId] });
  });

  it("keeps demos that have not ended", async () => {
    const result = await startDemo(address());
    if (!result.ok) throw new Error("no demo");
    await cleanupExpiredDemos(1000);
    expect(await exists(result.pass.documentId)).toBe(true);
  });

  it("never touches a real document, even one with a demo expiry in the past", async () => {
    const person = await makeUser("person");
    const plain = await createDocument(person.id, "Plain");
    const marked = await createDocument(person.id, "Marked");
    // Only the demo code sets this, but cleanup must not rely on that.
    await setExpiry(marked.id, new Date(Date.now() - 60_000));

    await cleanupExpiredDemos(1000);

    expect(await exists(plain.id)).toBe(true);
    expect(await exists(marked.id)).toBe(true);
    expect(syncCalls.filter((call) => call.call === "delete").map((call) => call.args[0])).not.toContain(marked.id);
  });
});
