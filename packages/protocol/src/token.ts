import { type JSONWebKeySet, type JWK, SignJWT, createLocalJWKSet, importJWK, jwtVerify } from "jose";

/**
 * Sync tokens: short-lived Ed25519-signed JWTs that the Next app issues and
 * the sync server verifies. The private key exists only in the Next app;
 * the sync server holds public keys only, so it can check tokens but never
 * mint them. Keys rotate through the kid header and a JWKS of public keys.
 */

export const TOKEN_ISSUER = "brahma-app";
export const TOKEN_AUDIENCE = "brahma-sync";
export const TOKEN_ALGORITHM = "EdDSA";
/** Ten minutes; clients refresh at 70% of the lifetime. */
export const TOKEN_TTL_SECONDS = 10 * 60;
export const TOKEN_CLOCK_TOLERANCE_SECONDS = 30;

export type TokenRole = "owner" | "editor" | "viewer";

export interface SyncClaims {
  /** User id. */
  sub: string;
  /** Document id. */
  doc: string;
  role: TokenRole;
  /** Membership access version at issue time; 0 for the owner. */
  av: number;
  name: string;
  image: string | null;
  /**
   * A demo seat (Try the demo): valid only for a demo document, which the
   * sync server checks, with demo limits. Absent for real users.
   */
  demo?: boolean;
  /** Seconds since epoch. */
  exp: number;
  iat: number;
}

export class TokenError extends Error {
  override name = "TokenError";
}

export async function signSyncToken(
  claims: Omit<SyncClaims, "exp" | "iat">,
  privateJwk: JWK & { kid: string },
  now = Math.floor(Date.now() / 1000),
): Promise<string> {
  const key = await importJWK(privateJwk, TOKEN_ALGORITHM);
  return new SignJWT({
    doc: claims.doc,
    role: claims.role,
    av: claims.av,
    name: claims.name,
    image: claims.image,
    ...(claims.demo ? { demo: true } : {}),
  })
    .setProtectedHeader({ alg: TOKEN_ALGORITHM, kid: privateJwk.kid, typ: "JWT" })
    .setIssuer(TOKEN_ISSUER)
    .setAudience(TOKEN_AUDIENCE)
    .setSubject(claims.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + TOKEN_TTL_SECONDS)
    .setJti(crypto.randomUUID())
    .sign(key);
}

const ROLES: readonly TokenRole[] = ["owner", "editor", "viewer"];

/**
 * Verify a token for one document. Pins the algorithm (no "none", no HMAC
 * confusion), issuer and audience, requires a known kid, and checks that the
 * token is for `documentId`. Throws TokenError on any failure.
 */
export async function verifySyncToken(
  token: string,
  publicKeys: JSONWebKeySet,
  documentId: string,
  currentDate?: Date,
): Promise<SyncClaims> {
  let payload;
  try {
    ({ payload } = await jwtVerify(token, createLocalJWKSet(publicKeys), {
      algorithms: [TOKEN_ALGORITHM],
      issuer: TOKEN_ISSUER,
      audience: TOKEN_AUDIENCE,
      clockTolerance: TOKEN_CLOCK_TOLERANCE_SECONDS,
      requiredClaims: ["sub", "exp", "iat", "doc", "role", "av"],
      currentDate,
    }));
  } catch (error) {
    throw new TokenError(error instanceof Error ? error.message : "Invalid token");
  }
  const { sub, doc, role, av, name, image, demo, exp, iat } = payload as Record<string, unknown>;
  if (typeof sub !== "string" || typeof doc !== "string" || typeof exp !== "number" || typeof iat !== "number") {
    throw new TokenError("Malformed claims");
  }
  if (doc.toLowerCase() !== documentId.toLowerCase()) throw new TokenError("Token is for another document");
  if (!ROLES.includes(role as TokenRole)) throw new TokenError("Unknown role");
  if (typeof av !== "number" || !Number.isInteger(av) || av < 0) throw new TokenError("Malformed access version");
  return {
    sub,
    doc,
    role: role as TokenRole,
    av,
    name: typeof name === "string" ? name : "",
    image: typeof image === "string" ? image : null,
    ...(demo === true ? { demo: true } : {}),
    exp,
    iat,
  };
}

/** The subprotocol a client offers to carry its token: "auth.<jwt>". */
export const SYNC_SUBPROTOCOL = "brahma.v1";
export const AUTH_SUBPROTOCOL_PREFIX = "auth.";

/** Pull the token out of a Sec-WebSocket-Protocol header. */
export function tokenFromSubprotocols(header: string | null): string | null {
  if (!header) return null;
  const offered = header.split(",").map((value) => value.trim());
  if (!offered.includes(SYNC_SUBPROTOCOL)) return null;
  const auth = offered.find((value) => value.startsWith(AUTH_SUBPROTOCOL_PREFIX));
  return auth ? auth.slice(AUTH_SUBPROTOCOL_PREFIX.length) : null;
}
