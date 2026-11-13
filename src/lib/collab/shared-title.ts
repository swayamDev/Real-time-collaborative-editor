import "client-only";
import { TITLE_FIELD } from "@brahma/protocol";
import * as Y from "yjs";

/** Transaction origin for title edits typed in this browser. */
export const LOCAL_TITLE_ORIGIN = Symbol("local-title");

export interface TextChange {
  index: number;
  remove: number;
  insert: string;
}

/**
 * The smallest single replacement that turns `before` into `after`: keep the
 * common prefix and suffix, replace the middle. Applying minimal changes
 * (instead of replacing the whole title) lets concurrent edits by two
 * people merge instead of one overwriting the other.
 */
export function diffText(before: string, after: string): TextChange | null {
  if (before === after) return null;
  let start = 0;
  const shortest = Math.min(before.length, after.length);
  while (start < shortest && before[start] === after[start]) start++;
  // Do not split a surrogate pair.
  if (start > 0 && isHighSurrogate(before.charCodeAt(start - 1))) start--;

  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore--;
    endAfter--;
  }
  if (endBefore < before.length && isLowSurrogate(before.charCodeAt(endBefore))) {
    endBefore++;
    endAfter++;
  }
  return { index: start, remove: endBefore - start, insert: after.slice(start, endAfter) };
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

/** Titles are one line. */
export function normalizeTitleInput(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

/** Apply what the user typed to the shared title as a minimal change. */
export function applyTitleInput(text: Y.Text, value: string): void {
  const change = diffText(text.toString(), normalizeTitleInput(value));
  if (!change || !text.doc) return;
  text.doc.transact(() => {
    if (change.remove > 0) text.delete(change.index, change.remove);
    if (change.insert) text.insert(change.index, change.insert);
  }, LOCAL_TITLE_ORIGIN);
}

/**
 * Map a caret position through a remote change, so a collaborator's edit
 * does not move your cursor. `delta` is Y.YTextEvent.delta.
 */
export function transformIndex(index: number, delta: Y.YTextEvent["delta"]): number {
  let position = 0;
  let result = index;
  for (const op of delta) {
    if (op.retain !== undefined) {
      position += op.retain;
    } else if (typeof op.insert === "string") {
      if (position <= index) result += op.insert.length;
      position += op.insert.length;
    } else if (op.delete !== undefined) {
      if (position < index) result -= Math.min(op.delete, index - position);
    }
    if (position > index) break;
  }
  return Math.max(0, result);
}

export function titleText(doc: Y.Doc): Y.Text {
  return doc.getText(TITLE_FIELD);
}

/** Undo that only ever touches this browser's title edits. */
export function createTitleUndoManager(text: Y.Text): Y.UndoManager {
  return new Y.UndoManager(text, { trackedOrigins: new Set([LOCAL_TITLE_ORIGIN]), captureTimeout: 500 });
}
