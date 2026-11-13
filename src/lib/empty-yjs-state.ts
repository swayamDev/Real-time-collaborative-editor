/**
 * The encoded Yjs update of an empty document: zero structs, empty delete set.
 *
 * Server code uses this constant so it never has to import Yjs. A unit test in
 * src/lib/collab/yjs.test.ts checks it against Y.encodeStateAsUpdate(new Y.Doc()).
 */
export const EMPTY_YJS_STATE: Readonly<Uint8Array> = Uint8Array.of(0, 0);

export function emptyYjsState(): Uint8Array {
  return Uint8Array.from(EMPTY_YJS_STATE);
}
