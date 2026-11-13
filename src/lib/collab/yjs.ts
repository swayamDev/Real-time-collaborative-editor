// Yjs must never load on the server: each server bundle would carry its own
// copy and they would collide in one Node process. This import fails the
// build if a server component or route ever pulls this module in.
import "client-only";
import * as Y from "yjs";

export { CONTENT_FIELD } from "@brahma/protocol";

/** Apply a stored state (the Postgres snapshot) to a fresh Y.Doc. */
export function loadDoc(state: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  if (state.byteLength > 0) Y.applyUpdate(doc, state);
  return doc;
}
