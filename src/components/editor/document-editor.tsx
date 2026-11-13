"use client";

import { Selection } from "@tiptap/pm/state";
import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import { base64ToBytes } from "@/lib/base64";
import { loadDoc } from "@/lib/collab/yjs";
import { displayTitle } from "@/lib/title";
import { useDocuments } from "../app-shell";
import { TopBar } from "../top-bar";
import { BubbleToolbar } from "./bubble-toolbar";
import { DocumentGone } from "./document-gone";
import { PresenceBar } from "./presence-bar";
import { buildExtensions } from "./extensions";
import { SharedTitleField } from "./shared-title-field";
import { SyncStatus } from "./sync-status";
import { type SyncSession, useSyncSession, useSyncStatus } from "./use-sync-session";

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
  /** Base64 of the Postgres snapshot, shown while the sync server connects. */
  initialState: string;
}

export function DocumentEditor({ id, initialTitle, initialUpdatedAt, initialState }: DocumentEditorProps) {
  const { setTitle, touch, ensure, remove } = useDocuments();

  useEffect(() => {
    ensure({ id, title: initialTitle, updatedAt: initialUpdatedAt });
  }, [ensure, id, initialTitle, initialUpdatedAt]);

  // The Y.Doc starts from the Postgres snapshot; the sync server fills in
  // anything newer. Merging the same updates twice is harmless.
  const [ydoc] = useState(() => loadDoc(base64ToBytes(initialState)));
  const session = useSyncSession(id, ydoc);
  const status = useSyncStatus(session);

  // Synced at least once: the shared title is authoritative from then on.
  const [synced, setSynced] = useState(false);
  if (!synced && (status === "saved" || status === "saving")) setSynced(true);

  const [title, setLocalTitle] = useState(initialTitle);
  const onTitleChange = useCallback(
    (next: string) => {
      setLocalTitle(next);
      setTitle(id, next);
    },
    [id, setTitle],
  );

  // Move this document to the top of the list once local edits are stored.
  useEffect(() => {
    if (!session) return;
    return session.provider.onAllAcked(() => touch(id, new Date().toISOString()));
  }, [session, touch, id]);

  useEffect(() => {
    if (status === "deleted" || status === "not-found") remove(id);
  }, [status, remove, id]);

  // Edits save continuously; keep Mod+S from opening the browser's save dialog.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const titleRef = useRef<HTMLTextAreaElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const shownTitle = title === "" && !synced ? initialTitle : title;

  if (status === "deleted" || status === "not-found") {
    return (
      <>
        <TopBar title={displayTitle(shownTitle)} titleMuted />
        <main id="main" className="flex-1 overflow-y-auto">
          <DocumentGone reason={status} />
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar
        title={displayTitle(shownTitle)}
        titleMuted={shownTitle.trim() === ""}
        status={<SyncStatus status={status} />}
        presence={session && <PresenceBar awareness={session.awareness} />}
      />
      <main id="main" className="flex-1 overflow-y-auto" data-testid="document-scroll">
        <article className="doc-column pt-14 sm:pt-24">
          <SharedTitleField
            ref={titleRef}
            doc={ydoc}
            fallbackTitle={initialTitle}
            synced={synced}
            autoFocus={initialTitle === ""}
            onTitleChange={onTitleChange}
            onExit={() => {
              if (editorRef.current) focusBodyStart(editorRef.current);
            }}
          />
          {session ? (
            <CollaborativeBody doc={ydoc} session={session} editorRef={editorRef} titleRef={titleRef} />
          ) : (
            <div className="doc-prose doc-body mt-6" />
          )}
        </article>
      </main>
    </>
  );
}

function CollaborativeBody({
  doc,
  session,
  editorRef,
  titleRef,
}: {
  doc: Y.Doc;
  session: SyncSession;
  editorRef: React.RefObject<Editor | null>;
  titleRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const [linkMode, setLinkMode] = useState(false);
  const [extensions] = useState(() =>
    buildExtensions(doc, {
      onRequestLink: () => setLinkMode(true),
      onFocusToolbar: () =>
        document.querySelector<HTMLButtonElement>('[data-testid="bubble-toolbar"] button')?.focus(),
    }, session.awareness),
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    editorProps: EDITOR_PROPS,
    onSelectionUpdate: () => setLinkMode(false),
  });

  useEffect(() => {
    editorRef.current = editor;
    return () => {
      editorRef.current = null;
    };
  }, [editor, editorRef]);

  return (
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
      {editor && <BubbleToolbar editor={editor} linkMode={linkMode} setLinkMode={setLinkMode} />}
    </div>
  );
}
