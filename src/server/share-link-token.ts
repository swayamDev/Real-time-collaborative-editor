import "server-only";
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

/**
 * A share link's token: HMAC-SHA256 of "document id:version" under a key
 * derived from BETTER_AUTH_SECRET. Never stored; recomputed to check it.
 */
function key(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET must be set.");
  return Buffer.from(hkdfSync("sha256", secret, "brahma", "share-link-token", 32));
}

export function shareLinkToken(documentId: string, version: number): string {
  return createHmac("sha256", key()).update(`${documentId}:${version}`).digest("base64url");
}

export function shareLinkTokenMatches(documentId: string, version: number, token: string): boolean {
  const expected = Buffer.from(shareLinkToken(documentId, version));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
