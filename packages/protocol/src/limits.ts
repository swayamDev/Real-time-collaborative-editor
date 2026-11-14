/**
 * Largest WebSocket message the sync server accepts. Cloudflare allows
 * 32 MiB per received message; Brahma stays well under it so one frame
 * never stalls a room. Typical updates are under 1 KiB.
 */
export const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;

/**
 * Clients pack queued offline edits into messages of at most this size,
 * leaving 4x headroom under MAX_MESSAGE_BYTES.
 */
export const BATCH_TARGET_BYTES = 1024 * 1024;

/**
 * The editor refuses a single change (for example a paste) whose estimated
 * encoded size is over this. The estimate can be off, so it sits 4x under
 * MAX_MESSAGE_BYTES: one Yjs update cannot be split across messages.
 */
export const LOCAL_EDIT_LIMIT_BYTES = 1024 * 1024;

/**
 * Application close codes (4000 to 4999 are free for applications).
 * Standard codes used alongside them: 1007 for a malformed message,
 * 1009 for a message over MAX_MESSAGE_BYTES.
 */
export const CLOSE_MALFORMED = 1007;
export const CLOSE_TOO_LARGE = 1009;
export const CLOSE_POLICY = 1008;
export const CLOSE_INVALID_ID = 4400;
/** Token missing, invalid or expired: fetch a new one and reconnect. */
export const CLOSE_UNAUTHENTICATED = 4401;
/** Access to the document was removed. */
export const CLOSE_ACCESS_REVOKED = 4403;
/** A viewer's socket sent a write. */
export const CLOSE_READ_ONLY = 4405;
export const CLOSE_NOT_FOUND = 4404;
export const CLOSE_DELETED = 4410;
/** The client's document schema is older than one this document has seen: update and reload. */
export const CLOSE_CLIENT_OUTDATED = 4426;
/** The client claims a schema newer than this deployment accepts: refused, nothing recorded. */
export const CLOSE_SCHEMA_UNSUPPORTED = 4427;

/** Close codes after which a client must not reconnect. */
export const TERMINAL_CLOSE_CODES: ReadonlySet<number> = new Set([
  CLOSE_INVALID_ID,
  CLOSE_NOT_FOUND,
  CLOSE_DELETED,
  CLOSE_ACCESS_REVOKED,
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isDocumentId(value: string): boolean {
  return UUID.test(value);
}

/** Names of the shared types inside each document's Y.Doc. Changing them orphans data. */
export const CONTENT_FIELD = "content";
export const TITLE_FIELD = "title";
export const TITLE_MAX_LENGTH = 200;
