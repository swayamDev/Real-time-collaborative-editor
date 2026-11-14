import "client-only";
import * as Y from "yjs";

export const MIRROR_ORIGIN = Symbol("mirror");

export interface Mirror {
  doc: Y.Doc;
  /** Start following the source; returns a function that stops and frees the mirror. */
  follow(): () => void;
}

/**
 * A copy of a document that follows it one way. A viewer's editor is bound
 * to the mirror, so nothing the editor binding writes (it removes shared
 * content that does not fit the schema, and merges adjacent text) can ever
 * reach the real document, be queued, or be sent.
 *
 * Creating it only copies; following starts in an effect, so a render that
 * React throws away leaves no listener behind.
 */
export function createMirror(source: Y.Doc): Mirror {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(source), MIRROR_ORIGIN);
  return {
    doc,
    follow: () => {
      // Catch up on anything that arrived between creation and now.
      Y.applyUpdate(doc, Y.encodeStateAsUpdate(source, Y.encodeStateVector(doc)), MIRROR_ORIGIN);
      const onUpdate = (update: Uint8Array) => Y.applyUpdate(doc, update, MIRROR_ORIGIN);
      source.on("update", onUpdate);
      return () => {
        source.off("update", onUpdate);
        doc.destroy();
      };
    },
  };
}
