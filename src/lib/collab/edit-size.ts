import type { Fragment } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";
import { ReplaceAroundStep, ReplaceStep } from "@tiptap/pm/transform";

const encoder = new TextEncoder();

/** Per node and per mark: element names, attributes and Yjs item headers. */
const NODE_OVERHEAD_BYTES = 24;
const MARK_OVERHEAD_BYTES = 16;

/**
 * Rough size of content once encoded as a Yjs update: UTF-8 text plus a
 * fixed overhead per node and mark. Deliberately generous; the limit it is
 * compared against leaves 4x headroom under the server's message cap.
 */
export function estimateFragmentBytes(fragment: Fragment): number {
  let bytes = 0;
  fragment.descendants((node) => {
    bytes += NODE_OVERHEAD_BYTES + node.marks.length * MARK_OVERHEAD_BYTES;
    if (node.isText && node.text) bytes += encoder.encode(node.text).byteLength;
    return true;
  });
  return bytes;
}

/** Estimated size of everything a transaction inserts. */
export function estimateInsertedBytes(transaction: Transaction): number {
  let bytes = 0;
  for (const step of transaction.steps) {
    if (step instanceof ReplaceStep || step instanceof ReplaceAroundStep) {
      bytes += estimateFragmentBytes(step.slice.content);
    }
  }
  return bytes;
}
