"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import {
  LOCAL_TITLE_ORIGIN,
  applyTitleInput,
  createTitleUndoManager,
  titleText,
  transformIndex,
} from "@/lib/collab/shared-title";
import { TITLE_MAX_LENGTH } from "@/lib/title";

interface SharedTitleFieldProps {
  doc: Y.Doc;
  /** Shown until the first sync; Phase 1 titles only live in the Postgres column. */
  fallbackTitle: string;
  /** Read-only until the first sync, so a first edit cannot race the seeded title. */
  synced: boolean;
  autoFocus: boolean;
  onTitleChange: (title: string) => void;
  /** Enter, or ArrowDown at the end: move into the body. */
  onExit: () => void;
}

/**
 * The document title, bound to a shared Y.Text. Typing applies minimal
 * changes, remote changes keep your caret in place, and Mod+Z undoes only
 * your own title edits.
 */
export const SharedTitleField = forwardRef<HTMLTextAreaElement, SharedTitleFieldProps>(function SharedTitleField(
  { doc, fallbackTitle, synced, autoFocus, onTitleChange, onExit },
  forwardedRef,
) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(forwardedRef, () => ref.current!, []);
  const [text] = useState(() => titleText(doc));
  const [undo] = useState(() => createTitleUndoManager(text));
  const [value, setValue] = useState(() => text.toString());
  const pendingSelection = useRef<[number, number] | null>(null);
  const onTitleChangeRef = useRef(onTitleChange);
  useEffect(() => {
    onTitleChangeRef.current = onTitleChange;
  }, [onTitleChange]);

  // Remote changes (and undo) arrive here; local typing is already in state.
  useEffect(() => {
    const observer = (event: Y.YTextEvent) => {
      const next = text.toString();
      if (event.transaction.origin !== LOCAL_TITLE_ORIGIN) {
        const field = ref.current;
        if (field && document.activeElement === field) {
          pendingSelection.current = [
            transformIndex(field.selectionStart, event.delta),
            transformIndex(field.selectionEnd, event.delta),
          ];
        }
        setValue(next);
      }
      onTitleChangeRef.current(next);
    };
    text.observe(observer);
    return () => text.unobserve(observer);
  }, [text]);

  useEffect(() => () => undo.destroy(), [undo]);

  const display = value === "" && !synced ? fallbackTitle : value;

  // Grow with the content, and restore the caret after a remote change.
  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
    if (pendingSelection.current) {
      field.setSelectionRange(...pendingSelection.current);
      pendingSelection.current = null;
    }
  }, [display]);

  useLayoutEffect(() => {
    if (autoFocus && synced) ref.current?.focus();
  }, [autoFocus, synced]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      const field = event.currentTarget;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod && key === "z") {
        event.preventDefault();
        if (event.shiftKey) undo.redo();
        else undo.undo();
        return;
      }
      if (mod && key === "y") {
        event.preventDefault();
        undo.redo();
        return;
      }
      const atEnd = field.selectionStart === field.value.length;
      if (event.key === "Enter" || (event.key === "ArrowDown" && atEnd)) {
        event.preventDefault();
        onExit();
      }
    },
    [undo, onExit],
  );

  return (
    <textarea
      ref={ref}
      rows={1}
      value={display}
      readOnly={!synced}
      maxLength={TITLE_MAX_LENGTH}
      placeholder="Untitled"
      aria-label="Title"
      data-testid="title"
      spellCheck
      onChange={(event) => {
        applyTitleInput(text, event.target.value);
        setValue(text.toString());
      }}
      onKeyDown={onKeyDown}
      className="doc-title block w-full resize-none overflow-hidden bg-transparent outline-none"
    />
  );
});
