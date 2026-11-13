"use client";

import { Selection } from "@tiptap/pm/state";
import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { base64ToBytes } from "@/lib/base64";
import { TITLE_MAX_LENGTH, displayTitle } from "@/lib/title";
import { loadDoc } from "@/lib/collab/yjs";
import { useDocuments } from "../app-shell";
import { TopBar } from "../top-bar";
import { BubbleToolbar } from "./bubble-toolbar";
import { buildExtensions } from "./extensions";
import { SaveStatus } from "./save-status";
import { useAutosave } from "./use-autosave";

/**
 * Move the caret to the start of the body synchronously. TipTap's focus
 * command waits a frame, which drops keystrokes typed right after Enter.
 */
function focusBodyStart(editor: Editor): void {
  const { state, view } = editor;
  view.dispatch(state.tr.setSelection(Selection.atStart(state.doc)));
  view.focus();
}

// Module-level so its identity never changes. useEditor compares options on
// every render and resets the view's props when they differ, which can drop
// a selection change the browser has made but ProseMirror has not read yet.
const EDITOR_PROPS = {
  attributes: {
    "aria-label": "Document body",
    "aria-multiline": "true",
    "data-testid": "editor",
    spellcheck: "true",
  },
};

interface DocumentEditorProps {
  id: string;
  initialTitle: string;
  initialUpdatedAt: string;
  /** Base64 of the stored Yjs state. */
  initialState: string;
}

export function DocumentEditor({ id, initialTitle, initialUpdatedAt, initialState }: DocumentEditorProps) {
  const { documents, setTitle, touch, ensure } = useDocuments();

  // The title field owns its value. It follows the shared list only when the
  // document is renamed elsewhere (the sidebar), so typing never depends on
  // the list being up to date.
  const [title, setLocalTitle] = useState(initialTitle);
  const listedTitle = documents.find((doc) => doc.id === id)?.title;
  const [seenListedTitle, setSeenListedTitle] = useState(listedTitle);
  if (listedTitle !== seenListedTitle) {
    setSeenListedTitle(listedTitle);
    if (listedTitle !== undefined && listedTitle !== title) setLocalTitle(listedTitle);
  }

  useEffect(() => {
    ensure({ id, title: initialTitle, updatedAt: initialUpdatedAt });
  }, [ensure, id, initialTitle, initialUpdatedAt]);

  // The Y.Doc is created once per mounted document and is the source of truth.
  const [ydoc] = useState(() => loadDoc(base64ToBytes(initialState)));

  const onSaved = useCallback((updatedAt: string) => touch(id, updatedAt), [touch, id]);
  const { status, saveTitle, saveNow } = useAutosave({ id, ydoc, onSaved });

  // Mod+S saves right away instead of opening the browser's save dialog.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveNow();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveNow]);

  const [linkMode, setLinkMode] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  const [extensions] = useState(() =>
    buildExtensions(ydoc, {
      onRequestLink: () => setLinkMode(true),
      onFocusToolbar: () =>
        document.querySelector<HTMLButtonElement>('[data-testid="bubble-toolbar"] button')?.focus(),
    }),
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    editorProps: EDITOR_PROPS,
    onSelectionUpdate: () => setLinkMode(false),
  });

  // Grow the title field with its content.
  const resizeTitle = useCallback(() => {
    const field = titleRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }, []);
  useLayoutEffect(resizeTitle, [resizeTitle, title]);

  // A new, empty document starts with the cursor in the title.
  useLayoutEffect(() => {
    if (initialTitle === "") titleRef.current?.focus();
  }, [initialTitle]);

  return (
    <>
      <TopBar
        title={displayTitle(title)}
        titleMuted={title.trim() === ""}
        status={<SaveStatus status={status} onRetry={saveNow} />}
      />
      <main id="main" className="flex-1 overflow-y-auto" data-testid="document-scroll">
        <article className="doc-column pt-14 sm:pt-24">
          <textarea
            ref={titleRef}
            rows={1}
            value={title}
            maxLength={TITLE_MAX_LENGTH}
            placeholder="Untitled"
            aria-label="Title"
            data-testid="title"
            spellCheck
            onChange={(event) => {
              const next = event.target.value.replace(/\n/g, " ");
              setLocalTitle(next);
              setTitle(id, next);
              saveTitle(next);
            }}
            onKeyDown={(event) => {
              const field = event.currentTarget;
              const atEnd = field.selectionStart === field.value.length;
              if (event.key === "Enter" || (event.key === "ArrowDown" && atEnd)) {
                event.preventDefault();
                if (editor) focusBodyStart(editor);
              }
            }}
            className="doc-title block w-full resize-none overflow-hidden bg-transparent outline-none"
          />
          <div
            className="doc-prose doc-body mt-6"
            onKeyDown={(event) => {
              // ArrowUp on the first line moves back to the title.
              if (event.key !== "ArrowUp" || !editor) return;
              const { $from, empty } = editor.state.selection;
              if (empty && $from.pos <= 2 && $from.parentOffset === 0) {
                event.preventDefault();
                titleRef.current?.focus();
              }
            }}
          >
            <EditorContent editor={editor} />
            {editor && (
              <BubbleToolbar
                editor={editor}
                linkMode={linkMode}
                setLinkMode={setLinkMode}
              />
            )}
          </div>
        </article>
      </main>
    </>
  );
}
