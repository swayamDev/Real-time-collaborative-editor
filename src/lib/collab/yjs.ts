// Yjs must never load on the server: each server bundle would carry its own
// copy and they would collide in one Node process. This import fails the
// build if a server component or route ever pulls this module in.
import "client-only";
import * as Y from "yjs";

/**
 * Name of the Y.XmlFragment that holds the rich text. TipTap's Collaboration
 * extension binds to it. Changing it orphans existing content, so it is fixed.
 */
export const CONTENT_FIELD = "content";

/** The encoded state of a brand new, empty document. */
export function createEmptyState(): Uint8Array {
  return Y.encodeStateAsUpdate(new Y.Doc());
}

/** Apply a stored state to a fresh Y.Doc. */
export function loadDoc(state: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  if (state.byteLength > 0) {
    Y.applyUpdate(doc, state);
  }
  return doc;
}

/** Cheap structural check that a byte array is a Yjs update. */
export function isValidUpdate(update: Uint8Array): boolean {
  if (update.byteLength === 0) return false;
  try {
    Y.decodeUpdate(update);
    return true;
  } catch {
    return false;
  }
}

/**
 * Merge an incoming update into the stored state without instantiating a
 * Y.Doc. Merging is commutative and idempotent, so a retried save that the
 * server already applied does no harm.
 */
export function mergeIntoState(stored: Uint8Array, incoming: Uint8Array): Uint8Array {
  return Y.mergeUpdates([stored, incoming]);
}

export interface PendingUpdate {
  /** Everything the server has not acknowledged yet. */
  update: Uint8Array;
  /** State vector at the moment of encoding. Becomes the new ack point on success. */
  stateVector: Uint8Array;
}

/**
 * Encode the changes made since `ackedStateVector`.
 *
 * Note: Yjs deletions do not advance the state vector, so callers must not
 * use state vector equality to decide whether there is anything to save.
 * The encoded update always carries the full delete set, which is small.
 */
export function encodeUpdateSince(doc: Y.Doc, ackedStateVector: Uint8Array | null): PendingUpdate {
  const stateVector = Y.encodeStateVector(doc);
  const update = ackedStateVector
    ? Y.encodeStateAsUpdate(doc, ackedStateVector)
    : Y.encodeStateAsUpdate(doc);
  return { update, stateVector };
}
