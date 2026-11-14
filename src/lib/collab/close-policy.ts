import {
  CLOSE_ACCESS_REVOKED,
  CLOSE_CLIENT_OUTDATED,
  CLOSE_DELETED,
  CLOSE_INVALID_ID,
  CLOSE_MALFORMED,
  CLOSE_NOT_FOUND,
  CLOSE_POLICY,
  CLOSE_READ_ONLY,
  CLOSE_TOO_LARGE,
  CLOSE_UNAUTHENTICATED,
} from "@brahma/protocol";

/**
 * What the client does when the sync server closes the socket. This table
 * is the only place close codes are interpreted, so every code has exactly
 * one, tested, outcome. Only two actions ever open a new socket, and both
 * are bounded:
 *   reconnect          backoff with jitter, up to 10 s; for transient closes
 *   refresh-token      once per failure; a second 4401 before syncing ends
 *                      the session instead
 * `downgraded` reconnects once as a viewer, after the local copy is rebuilt;
 * a viewer that is closed for writing is halted, not reconnected.
 */
export type CloseAction =
  /** Transient (network, server restart): reconnect with backoff. */
  | "reconnect"
  /** The token expired or failed: fetch a new one and reconnect now. */
  | "refresh-token"
  /** Signed out or the session cannot be renewed: stop and show the banner. */
  | "session-ended"
  /** Access was removed: stop for good and run revoke handling. */
  | "revoked"
  /** Wrote as a viewer: stop, run downgrade handling, rebuild as a viewer, reconnect. */
  | "downgraded"
  | "deleted"
  | "not-found"
  /** This bundle's document schema is older than the document's: update and reload. */
  | "outdated"
  /** One bounded retry that sends queued edits one per message to find the rejected one. */
  | "isolate"
  /** Stop syncing this document and show the couldn't-sync banner. Nothing is retried. */
  | "halt";

export interface CloseContext {
  /** A 4401 already led to a fresh token, and no connection has synced since. */
  refreshedSinceLastSync: boolean;
  /** The socket was open as a viewer. */
  viewer: boolean;
  /** This connection was already sending edits one at a time. */
  isolating: boolean;
  /** Queued edit entries sent on this connection and not acknowledged. */
  unackedEntries: number;
}

export function closeAction(code: number, context: CloseContext): CloseAction {
  switch (code) {
    case CLOSE_UNAUTHENTICATED:
      return context.refreshedSinceLastSync ? "session-ended" : "refresh-token";
    case CLOSE_ACCESS_REVOKED:
      return "revoked";
    case CLOSE_READ_ONLY:
      // A viewer never sends writes; if the server still says it did, stop
      // rather than loop through downgrade handling again.
      return context.viewer ? "halt" : "downgraded";
    case CLOSE_DELETED:
      return "deleted";
    case CLOSE_CLIENT_OUTDATED:
      // Reconnecting would be refused again: only a newer bundle helps.
      return "outdated";
    case CLOSE_NOT_FOUND:
    case CLOSE_INVALID_ID:
      return "not-found";
    case CLOSE_MALFORMED:
    case CLOSE_TOO_LARGE:
      // Never skip an edit and never retry blindly. Try once with one edit
      // per message so the rejected edit is found; if that is already
      // happening, or there is nothing to split, halt.
      return context.isolating || context.unackedEntries <= 1 ? "halt" : "isolate";
    case CLOSE_POLICY:
      return "halt";
    default:
      // Codes 4000 to 4999 are ours. One this client does not know means a
      // newer server is telling it something specific: stop, do not loop.
      if (code >= 4000 && code <= 4999) return "halt";
      return "reconnect";
  }
}

/** Actions that open another socket. Everything else stops this provider. */
export const RECONNECTING_ACTIONS: ReadonlySet<CloseAction> = new Set(["reconnect", "refresh-token", "isolate"]);
