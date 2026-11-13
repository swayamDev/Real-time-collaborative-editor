import * as encoding from "lib0/encoding";

/**
 * Encode a state vector from a map, in the format Y.encodeStateVector
 * produces. Used to ask Yjs for "everything except" some content: a
 * vector that claims to have every other client's structs.
 */
export function encodeStateVectorMap(vector: Map<number, number>): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, vector.size);
  vector.forEach((clock, client) => {
    encoding.writeVarUint(encoder, client);
    encoding.writeVarUint(encoder, clock);
  });
  return encoding.toUint8Array(encoder);
}
