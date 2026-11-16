import "server-only";
import { type SyncClaims, signSyncToken } from "@brahma/protocol";
import type { JWK } from "jose";
import type { Access } from "./authz";
import type { CurrentUser } from "./session";

let cachedKey: (JWK & { kid: string }) | null = null;

/**
 * The Ed25519 private key that signs sync tokens, as a JWK with a kid, from
 * SYNC_TOKEN_PRIVATE_KEY. Only the Next app has it; the sync server gets the
 * matching public key (see pnpm keys:sync).
 */
function privateKey(): JWK & { kid: string } {
  if (cachedKey) return cachedKey;
  const raw = process.env.SYNC_TOKEN_PRIVATE_KEY;
  if (!raw) throw new Error("SYNC_TOKEN_PRIVATE_KEY is not set. Run pnpm keys:sync.");
  const jwk = JSON.parse(raw) as JWK & { kid?: string };
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || !jwk.d || !jwk.kid) {
    throw new Error("SYNC_TOKEN_PRIVATE_KEY must be an Ed25519 private JWK with a kid.");
  }
  cachedKey = jwk as JWK & { kid: string };
  return cachedKey;
}

export async function issueSyncToken(
  user: CurrentUser,
  documentId: string,
  access: Access,
): Promise<{ token: string; claims: Omit<SyncClaims, "exp" | "iat"> }> {
  const claims = {
    sub: user.id,
    doc: documentId,
    role: access.role,
    av: access.accessVersion,
    name: user.name || user.email.split("@")[0],
    image: user.image,
  };
  return { token: await signSyncToken(claims, privateKey()), claims };
}

/**
 * A sync token for a demo seat ("Try the demo"): editor of one demo
 * document, marked as a demo so the sync server allows it only there.
 * Callers check the demo pass and the document first (src/server/demo.ts).
 */
export async function issueDemoSyncToken(documentId: string, userId: string, name: string): Promise<string> {
  return signSyncToken({ sub: userId, doc: documentId, role: "editor", av: 0, name, image: null, demo: true }, privateKey());
}
