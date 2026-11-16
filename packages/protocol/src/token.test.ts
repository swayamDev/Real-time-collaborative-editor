import { type JWK, SignJWT, base64url, exportJWK, generateKeyPair } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type SyncClaims,
  TOKEN_AUDIENCE,
  TOKEN_ISSUER,
  TOKEN_TTL_SECONDS,
  TokenError,
  signSyncToken,
  tokenFromSubprotocols,
  verifySyncToken,
} from "./token";

const DOC = "8ec4a97b-4aea-403f-ae18-0a2eead2f77d";
let privateJwk: JWK & { kid: string };
let publicKeys: { keys: JWK[] };
let otherPrivateJwk: JWK & { kid: string };

const claims: Omit<SyncClaims, "exp" | "iat"> = {
  sub: "user-1",
  doc: DOC,
  role: "editor",
  av: 3,
  name: "Ada",
  image: null,
};

beforeAll(async () => {
  const pair = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
  privateJwk = { ...(await exportJWK(pair.privateKey)), kid: "k1" };
  publicKeys = { keys: [{ ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "EdDSA", use: "sig" }] };
  const other = await generateKeyPair("EdDSA", { crv: "Ed25519", extractable: true });
  otherPrivateJwk = { ...(await exportJWK(other.privateKey)), kid: "k1" };
});

async function expectRejected(token: string, doc = DOC, at?: Date): Promise<void> {
  await expect(verifySyncToken(token, publicKeys, doc, at)).rejects.toBeInstanceOf(TokenError);
}

describe("sync tokens", () => {
  it("round trips every claim", async () => {
    const token = await signSyncToken(claims, privateJwk);
    const verified = await verifySyncToken(token, publicKeys, DOC);
    expect(verified).toMatchObject(claims);
    expect(verified.exp - verified.iat).toBe(TOKEN_TTL_SECONDS);
    // A real user's token never carries the demo claim.
    expect(verified.demo).toBeUndefined();
  });

  it("carries the demo claim only when it is exactly true", async () => {
    const demo = await verifySyncToken(await signSyncToken({ ...claims, demo: true }, privateJwk), publicKeys, DOC);
    expect(demo.demo).toBe(true);
    const notDemo = await verifySyncToken(await signSyncToken({ ...claims, demo: false }, privateJwk), publicKeys, DOC);
    expect(notDemo.demo).toBeUndefined();
  });

  it("rejects an expired token, beyond the clock tolerance", async () => {
    const issuedAt = Math.floor(Date.now() / 1000) - TOKEN_TTL_SECONDS - 60;
    await expectRejected(await signSyncToken(claims, privateJwk, issuedAt));
  });

  it("accepts a token a few seconds past expiry (clock skew)", async () => {
    const issuedAt = Math.floor(Date.now() / 1000) - TOKEN_TTL_SECONDS - 10;
    await expect(verifySyncToken(await signSyncToken(claims, privateJwk, issuedAt), publicKeys, DOC)).resolves.toBeTruthy();
  });

  it("rejects a token for another document", async () => {
    await expectRejected(await signSyncToken(claims, privateJwk), "11111111-1111-4111-8111-111111111111");
  });

  it("rejects a tampered payload", async () => {
    const [header, payload, signature] = (await signSyncToken(claims, privateJwk)).split(".");
    const decoded = JSON.parse(new TextDecoder().decode(base64url.decode(payload)));
    decoded.role = "owner";
    const forged = base64url.encode(new TextEncoder().encode(JSON.stringify(decoded)));
    await expectRejected(`${header}.${forged}.${signature}`);
  });

  it("rejects a tampered signature", async () => {
    const token = await signSyncToken(claims, privateJwk);
    const flipped = token.slice(0, -2) + (token.endsWith("AA") ? "BB" : "AA");
    await expectRejected(flipped);
  });

  it("rejects a token signed by a different key under the same kid", async () => {
    await expectRejected(await signSyncToken(claims, otherPrivateJwk));
  });

  it("rejects an unknown kid", async () => {
    await expectRejected(await signSyncToken(claims, { ...privateJwk, kid: "unknown" }));
  });

  it('rejects alg "none"', async () => {
    const encode = (value: object) => base64url.encode(new TextEncoder().encode(JSON.stringify(value)));
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${encode({ alg: "none", kid: "k1" })}.${encode({
      ...claims,
      iss: TOKEN_ISSUER,
      aud: TOKEN_AUDIENCE,
      iat: now,
      exp: now + 600,
    })}.`;
    await expectRejected(unsigned);
  });

  it("rejects HMAC algorithm confusion using the public key as a secret", async () => {
    const secret = new TextEncoder().encode(JSON.stringify(publicKeys.keys[0]));
    const forged = await new SignJWT({ doc: DOC, role: "owner", av: 0, name: "", image: null })
      .setProtectedHeader({ alg: "HS256", kid: "k1" })
      .setIssuer(TOKEN_ISSUER)
      .setAudience(TOKEN_AUDIENCE)
      .setSubject("attacker")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(secret);
    await expectRejected(forged);
  });

  it("rejects the wrong audience or issuer", async () => {
    const key = (await import("jose")).importJWK(privateJwk, "EdDSA");
    for (const [issuer, audience] of [
      [TOKEN_ISSUER, "someone-else"],
      ["someone-else", TOKEN_AUDIENCE],
    ]) {
      const token = await new SignJWT({ doc: DOC, role: "editor", av: 1 })
        .setProtectedHeader({ alg: "EdDSA", kid: "k1" })
        .setIssuer(issuer)
        .setAudience(audience)
        .setSubject("user-1")
        .setIssuedAt()
        .setExpirationTime("10m")
        .sign(await key);
      await expectRejected(token);
    }
  });
});

describe("tokenFromSubprotocols", () => {
  it("reads the token only alongside brahma.v1", () => {
    expect(tokenFromSubprotocols("brahma.v1, auth.abc.def.ghi")).toBe("abc.def.ghi");
    expect(tokenFromSubprotocols("auth.abc.def.ghi")).toBeNull();
    expect(tokenFromSubprotocols("brahma.v1")).toBeNull();
    expect(tokenFromSubprotocols(null)).toBeNull();
  });
});
