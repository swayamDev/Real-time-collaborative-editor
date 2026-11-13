/** Largest WebSocket message either side accepts. Typical updates are under 1 KiB. */
export const MAX_MESSAGE_BYTES = 1024 * 1024;

/**
 * Application close codes (4000 to 4999 are free for applications).
 * Standard codes used alongside them: 1007 for a malformed message,
 * 1009 for a message over MAX_MESSAGE_BYTES.
 */
export const CLOSE_MALFORMED = 1007;
export const CLOSE_TOO_LARGE = 1009;
export const CLOSE_INVALID_ID = 4400;
export const CLOSE_NOT_FOUND = 4404;
export const CLOSE_DELETED = 4410;

/** Close codes after which a client must not reconnect. */
export const TERMINAL_CLOSE_CODES: ReadonlySet<number> = new Set([CLOSE_INVALID_ID, CLOSE_NOT_FOUND, CLOSE_DELETED]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isDocumentId(value: string): boolean {
  return UUID.test(value);
}

/** Names of the shared types inside each document's Y.Doc. Changing them orphans data. */
export const CONTENT_FIELD = "content";
export const TITLE_FIELD = "title";
export const TITLE_MAX_LENGTH = 200;
