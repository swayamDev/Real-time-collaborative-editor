import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import * as syncProtocol from "y-protocols/sync";
import type * as Y from "yjs";

/**
 * Wire format: every WebSocket message is binary and starts with a varUint
 * message type. This follows the y-websocket framing so the sync and
 * awareness payloads are exactly what y-protocols reads and writes.
 *
 *   0 SYNC              followed by a sync sub-type (below)
 *   1 AWARENESS         an awareness update (presence: name, color, cursor)
 *   3 QUERY_AWARENESS   no payload; "please send me your awareness state"
 *   4 ACK               varUint count; Brahma-specific, server to client only
 *   5 AUTH              varString token; client to server, a refreshed sync token
 *   6 ROLE              varString role; server to client, the socket's role changed live
 *
 * Sync sub-types, from y-protocols/sync:
 *   0 STEP_1  varUint8Array state vector: "this is what I have"
 *   1 STEP_2  varUint8Array update: "this is everything you were missing"
 *   2 UPDATE  varUint8Array update: one incremental change
 */
export const MESSAGE_SYNC = 0;
export const MESSAGE_AWARENESS = 1;
export const MESSAGE_QUERY_AWARENESS = 3;
export const MESSAGE_ACK = 4;
export const MESSAGE_AUTH = 5;
export const MESSAGE_ROLE = 6;

export const SYNC_STEP_1 = syncProtocol.messageYjsSyncStep1;
export const SYNC_STEP_2 = syncProtocol.messageYjsSyncStep2;
export const SYNC_UPDATE = syncProtocol.messageYjsUpdate;

export type Message =
  | { type: "sync-step-1"; stateVector: Uint8Array }
  | { type: "sync-step-2"; update: Uint8Array }
  | { type: "update"; update: Uint8Array }
  | { type: "awareness"; update: Uint8Array }
  | { type: "query-awareness" }
  | { type: "ack"; count: number }
  | { type: "auth"; token: string }
  | { type: "role"; role: "owner" | "editor" | "viewer" };

export class ProtocolError extends Error {
  override name = "ProtocolError";
}

function frame(write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  write(encoder);
  return encoding.toUint8Array(encoder);
}

/** Step 1: send our state vector so the other side can reply with what we lack. */
export function encodeSyncStep1(doc: Y.Doc): Uint8Array {
  return frame((encoder) => {
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);
  });
}

/** Step 2: everything in `doc` that a peer with `stateVector` is missing. */
export function encodeSyncStep2(doc: Y.Doc, stateVector?: Uint8Array): Uint8Array {
  return frame((encoder) => {
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep2(encoder, doc, stateVector);
  });
}

export function encodeUpdate(update: Uint8Array): Uint8Array {
  return frame((encoder) => {
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
  });
}

export function encodeAwareness(update: Uint8Array): Uint8Array {
  return frame((encoder) => {
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, update);
  });
}

export function encodeQueryAwareness(): Uint8Array {
  return frame((encoder) => encoding.writeVarUint(encoder, MESSAGE_QUERY_AWARENESS));
}

/**
 * Ack: the server has durably stored `count` document messages (Step 2 or
 * Update) from this connection. The count is cumulative per connection, so
 * one ack can cover a whole batch.
 */
export function encodeAck(count: number): Uint8Array {
  return frame((encoder) => {
    encoding.writeVarUint(encoder, MESSAGE_ACK);
    encoding.writeVarUint(encoder, count);
  });
}

/** A refreshed sync token, sent on the open socket before the current one expires. */
export function encodeAuth(token: string): Uint8Array {
  return frame((encoder) => {
    encoding.writeVarUint(encoder, MESSAGE_AUTH);
    encoding.writeVarString(encoder, token);
  });
}

/** The socket's role changed (downgrade or upgrade); the client adjusts without reconnecting. */
export function encodeRole(role: "owner" | "editor" | "viewer"): Uint8Array {
  return frame((encoder) => {
    encoding.writeVarUint(encoder, MESSAGE_ROLE);
    encoding.writeVarString(encoder, role);
  });
}

/**
 * Parse one message without applying it. Throws ProtocolError for unknown
 * types, truncated payloads or trailing bytes, so a caller can reject the
 * message without touching the document.
 */
export function decodeMessage(data: Uint8Array): Message {
  try {
    const decoder = decoding.createDecoder(data);
    const message = readMessage(decoder);
    if (decoding.hasContent(decoder)) throw new ProtocolError("Trailing bytes after message");
    return message;
  } catch (error) {
    if (error instanceof ProtocolError) throw error;
    throw new ProtocolError(`Malformed message: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readMessage(decoder: decoding.Decoder): Message {
  const type = decoding.readVarUint(decoder);
  switch (type) {
    case MESSAGE_SYNC: {
      const subtype = decoding.readVarUint(decoder);
      const payload = decoding.readVarUint8Array(decoder);
      if (subtype === SYNC_STEP_1) return { type: "sync-step-1", stateVector: payload };
      if (subtype === SYNC_STEP_2) return { type: "sync-step-2", update: payload };
      if (subtype === SYNC_UPDATE) return { type: "update", update: payload };
      throw new ProtocolError(`Unknown sync message ${subtype}`);
    }
    case MESSAGE_AWARENESS:
      return { type: "awareness", update: decoding.readVarUint8Array(decoder) };
    case MESSAGE_QUERY_AWARENESS:
      return { type: "query-awareness" };
    case MESSAGE_ACK:
      return { type: "ack", count: decoding.readVarUint(decoder) };
    case MESSAGE_AUTH:
      return { type: "auth", token: decoding.readVarString(decoder) };
    case MESSAGE_ROLE: {
      const role = decoding.readVarString(decoder);
      if (role !== "owner" && role !== "editor" && role !== "viewer") throw new ProtocolError(`Unknown role ${role}`);
      return { type: "role", role };
    }
    default:
      throw new ProtocolError(`Unknown message type ${type}`);
  }
}
