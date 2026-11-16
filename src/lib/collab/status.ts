/**
 * The single status shown in the top bar, as a pure function of what the
 * provider and the local store know. Rules are checked in order; the first
 * match wins.
 *
 *  1. deleted / not-found   terminal; the editor is replaced by a message
 *     revoked               terminal; access removed (message, Download a copy)
 *     downgraded            sync stopped; the copy is rebuilt as a viewer
 *     session-ended         sync stopped until the user signs in again (banner)
 *     outdated              this bundle's schema is older than the document's:
 *                           update and reload, keeping queued edits
 *  2. halted                the server refused an edit; sync stopped (banner)
 *  3. saving                a local edit has waited over 1s to be written on
 *                           the device (or cannot be, because storage is full)
 *  4. saved-on-device       the browser is offline
 *  5. connecting            online, never synced in this tab yet
 *  6. reconnecting-local    online, socket down, every local edit written
 *                           on the device ("Reconnecting. Saved on this device.")
 *  7. reconnecting          online, socket down, something not yet on the device
 *  8. syncing               connected, sending edits queued while disconnected
 *                           and verifying the server holds everything
 *  9. saving                connected, an acknowledgement is over 1s late
 * 10. saved                 connected, everything acknowledged
 */
/** Why a provider stopped for good. */
export type StopReason =
  | "deleted"
  | "not-found"
  | "revoked"
  | "downgraded"
  | "session-ended"
  | "outdated"
  /** Demo: this seat moved to another connection (another device). */
  | "seat-moved"
  /** Demo: the demo document reached its limit. */
  | "demo-limit";

export type SyncStatus =
  | StopReason
  | "halted"
  | "saving"
  | "saved-on-device"
  | "connecting"
  | "reconnecting-local"
  | "reconnecting"
  | "syncing"
  | "saved";

export interface StatusInputs {
  terminal: StopReason | null;
  halted: boolean;
  online: boolean;
  /** Socket open and the server's Step 2 received on it. */
  socketSynced: boolean;
  /** This tab has completed a sync at least once. */
  everSyncedThisTab: boolean;
  /** When the oldest local edit not yet written to the device was made. */
  unwrittenSince: number | null;
  /** Sending the offline queue or verifying convergence. */
  flushing: boolean;
  /** When the oldest unacknowledged live message was sent. */
  oldestUnackedAt: number | null;
  now: number;
}

export const LATE_AFTER_MS = 1_000;

export function computeStatus(input: StatusInputs): SyncStatus {
  if (input.terminal) return input.terminal;
  if (input.halted) return "halted";
  if (input.unwrittenSince !== null && input.now - input.unwrittenSince >= LATE_AFTER_MS) return "saving";
  if (!input.online) return "saved-on-device";
  if (!input.socketSynced) {
    if (!input.everSyncedThisTab) return "connecting";
    return input.unwrittenSince === null ? "reconnecting-local" : "reconnecting";
  }
  if (input.flushing) return "syncing";
  if (input.oldestUnackedAt !== null && input.now - input.oldestUnackedAt >= LATE_AFTER_MS) return "saving";
  return "saved";
}

/** Top bar copy. Halted and terminal states show their message elsewhere. */
export const STATUS_LABELS: Record<SyncStatus, string> = {
  deleted: "",
  "not-found": "",
  revoked: "",
  downgraded: "",
  "session-ended": "Not syncing",
  outdated: "",
  "seat-moved": "",
  "demo-limit": "",
  halted: "",
  saving: "Saving",
  "saved-on-device": "Saved on this device",
  connecting: "Connecting",
  "reconnecting-local": "Reconnecting. Saved on this device.",
  reconnecting: "Reconnecting",
  syncing: "Syncing",
  saved: "Saved",
};
