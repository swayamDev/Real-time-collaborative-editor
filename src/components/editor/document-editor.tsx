"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { base64ToBytes } from "@/lib/base64";
import { TITLE_MAX_LENGTH, displayTitle } from "@/lib/title";
import { loadDoc } from "@/lib/yjs";
import { useDocuments } from "../app-shell";
import { TopBar } from "../top-bar";
import { BubbleToolbar } from "./bubble-toolbar";
import { buildExtensions } from "./extensions";
import { SaveStatus } from "./save-status";
import { useAutosave } from "./use-autosave";

interface DocumentEditorProps {
  id: string;
  initialTitle: string;
  /** Base64 of the stored Yjs state. */
  initialState: string;
}

export function DocumentEditor({ id, initialTitle, initialState }: DocumentEditorProps) {
  const { documents, setTitle, touch } = useDocuments();
  const title = documents.find((doc) => doc.id === id)?.title ?? initialTitle;

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
    editorProps: {
      attributes: {
        "aria-label": "Document body",
        "aria-multiline": "true",
        "data-testid": "editor",
        spellcheck: "true",
      },
    },
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
              setTitle(id, next);
              saveTitle(next);
            }}
            onKeyDown={(event) => {
              const field = event.currentTarget;
              const atEnd = field.selectionStart === field.value.length;
              if (event.key === "Enter" || (event.key === "ArrowDown" && atEnd)) {
                event.preventDefault();
                editor?.commands.focus("start");
              }
            }}
            className="doc-title block w-full resize-none overflow-hidden bg-transparent outline-none"
          />
          <div
            className="doc-prose mt-6"
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
