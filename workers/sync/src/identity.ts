import type { SyncClaims, TokenRole } from "@brahma/protocol";
import type { JSONWebKeySet } from "jose";

/**
 * Who is on a socket, as verified from their sync token by the router. The
 * room trusts these headers because only the router talks to it; the
 * router drops any X-Brahma-* headers a client sends.
 */
export interface Identity {
  userId: string;
  role: TokenRole;
  /** Access version the token was issued at. */
  av: number;
  name: string;
  image: string | null;
  /** Token expiry, seconds since epoch. */
  exp: number;
  /** The document schema version the client's editor runs (0 if it did not say). */
  schema: number;
  /** A demo seat (the token's demo claim): only for demo rooms, with demo limits. */
  demo: boolean;
}

const PREFIX = "x-brahma-";

export function identityFromClaims(claims: SyncClaims, schema: number): Identity {
  return {
    userId: claims.sub,
    role: claims.role,
    av: claims.av,
    name: claims.name,
    image: claims.image,
    exp: claims.exp,
    schema,
    demo: claims.demo === true,
  };
}

/** Copy a request's headers without anything a client could use to pose as someone. */
export function withoutIdentityHeaders(headers: Headers): Headers {
  const clean = new Headers();
  headers.forEach((value, key) => {
    if (!key.toLowerCase().startsWith(PREFIX)) clean.set(key, value);
  });
  return clean;
}

export function writeIdentity(headers: Headers, identity: Identity): void {
  headers.set(`${PREFIX}identity`, JSON.stringify(identity));
}

export function readIdentity(headers: Headers): Identity | null {
  const raw = headers.get(`${PREFIX}identity`);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Identity;
    if (typeof value.userId !== "string" || typeof value.role !== "string") return null;
    return { ...value, schema: Number.isInteger(value.schema) ? value.schema : 0, demo: value.demo === true };
  } catch {
    return null;
  }
}

let cachedKeys: { raw: string; keys: JSONWebKeySet } | null = null;

export function publicKeys(env: Env): JSONWebKeySet {
  const raw = env.SYNC_TOKEN_PUBLIC_KEYS;
  if (!raw) throw new Error("SYNC_TOKEN_PUBLIC_KEYS is not set");
  if (cachedKeys?.raw !== raw) cachedKeys = { raw, keys: JSON.parse(raw) as JSONWebKeySet };
  return cachedKeys.keys;
}

/**
 * The role a token actually grants, given what the room knows about later
 * access changes. Each membership change increments its access version and
 * the token carries the version it was issued at, so no clocks are compared:
 *
 *   no record, or token version >= record version   the token's role
 *   token version < record version                  the record's role
 *                                                   (null: access removed)
 *
 * Owner tokens carry version 0 and owners never have records.
 */
export function effectiveRole(
  token: { role: TokenRole; av: number },
  record: { role: "editor" | "viewer" | null; version: number } | null,
): TokenRole | null {
  if (!record || token.role === "owner" || token.av >= record.version) return token.role;
  return record.role;
}
