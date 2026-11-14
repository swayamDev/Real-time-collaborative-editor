import { verifySyncToken } from "@brahma/protocol";
import { type JWK, exportJWK, generateKeyPair } from "jose";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type World, as, makeWorld } from "./fixtures";
import { session } from "./session";

vi.mock("@/server/auth", () => ({
  auth: {
    api: {
      getSession: async () =>
        session.current ? { user: { ...session.current }, session: { id: "s" } } : null,
    },
  },
}));

let publicKeys: { keys: JWK[] };
beforeAll(async () => {
  const pair = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
  process.env.SYNC_TOKEN_PRIVATE_KEY = JSON.stringify({ ...(await exportJWK(pair.privateKey)), kid: "test" });
  publicKeys = { keys: [{ ...(await exportJWK(pair.publicKey)), kid: "test", alg: "EdDSA" }] };
  process.env.BETTER_AUTH_URL = "http://localhost:3100";
});

const { POST } = await import("@/app/api/documents/[id]/sync-token/route");

let world: World;
beforeEach(async () => {
  world = await makeWorld();
});

function request(documentId: string, headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) {
  return POST(new Request(`http://localhost:3100/api/documents/${documentId}/sync-token`, { method: "POST", headers }), {
    params: Promise.resolve({ id: documentId }),
  } as never);
}

describe("POST /api/documents/:id/sync-token", () => {
  it("issues a token carrying the user's role and access version", async () => {
    for (const [person, role, av] of [
      [world.owner, "owner", 0],
      [world.editor, "editor", 1],
      [world.viewer, "viewer", 1],
    ] as const) {
      as(person);
      const response = await request(world.documentId);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = (await response.json()) as { token: string; role: string };
      expect(body.role).toBe(role);
      const claims = await verifySyncToken(body.token, publicKeys, world.documentId);
      expect(claims).toMatchObject({ sub: person.id, doc: world.documentId, role, av });
    }
  });

  it("answers 404 for no access and for malformed ids, the same as a missing document", async () => {
    as(world.stranger);
    expect((await request(world.documentId)).status).toBe(404);
    as(world.owner);
    expect((await request("not-a-uuid")).status).toBe(404);
  });

  it("answers 410 for a deleted document, but only to people who had access", async () => {
    const { tombstoneDocument } = await import("@/server/documents");
    await tombstoneDocument(world.documentId);
    for (const person of [world.owner, world.editor, world.viewer]) {
      as(person);
      expect((await request(world.documentId)).status).toBe(410);
    }
    as(world.stranger);
    expect((await request(world.documentId)).status).toBe(404);
  });

  it("answers 401 when signed out", async () => {
    as(null);
    expect((await request(world.documentId)).status).toBe(401);
  });

  it("refuses cross-site requests", async () => {
    as(world.owner);
    expect((await request(world.documentId, { origin: "https://evil.example" })).status).toBe(403);
    expect((await request(world.documentId, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await request(world.documentId, {})).status).toBe(403);
    expect((await request(world.documentId, { origin: "http://localhost:3100" })).status).toBe(200);
  });
});
