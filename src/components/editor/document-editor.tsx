"use client";

import { Selection } from "@tiptap/pm/state";
import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import { TITLE_FIELD } from "@brahma/protocol";
import { downloadFile, documentHtml, exportFileName } from "@/lib/collab/export-html";
import { STORAGE_FULL, SYNC_HALTED, TOO_LARGE_TO_ADD } from "@/lib/copy";
import { displayTitle } from "@/lib/title";
import { useDocuments } from "../app-shell";
import { cachePageForOffline } from "../service-worker";
import { TopBar } from "../top-bar";
import { BubbleToolbar } from "./bubble-toolbar";
import { DocumentBanner } from "./document-banner";
import { DeletedDocument } from "./deleted-document";
import { EditorNotice } from "./editor-notice";
import { PresenceBar } from "./presence-bar";
import { buildExtensions } from "./extensions";
import { SharedTitleField } from "./shared-title-field";
import { SyncStatus } from "./sync-status";
import { TitleSkeleton } from "./title-skeleton";
import {
  type SyncSession,
  usePendingEdits,
  useStorageFull,
  useSyncSession,
  useSyncStatus,
} from "./use-sync-session";

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
  /** The row is tombstoned. */
  deleted: boolean;
}

export function DocumentEditor(props: DocumentEditorProps) {
  if (props.deleted) {
    return (
      <>
        <TopBar title={displayTitle(props.initialTitle)} titleMuted />
        <main id="main" className="flex-1 overflow-y-auto">
          <DeletedDocument id={props.id} reason="deleted" />
        </main>
      </>
    );
  }
  return <LiveDocumentEditor {...props} />;
}

function LiveDocumentEditor({ id, initialTitle, initialUpdatedAt, initialState }: DocumentEditorProps) {
  const { setTitle, touch, ensure, remove } = useDocuments();

  useEffect(() => {
    ensure({ id, title: initialTitle, updatedAt: initialUpdatedAt });
    // Keep this page for offline use, even when it was reached by a client-side navigation.
    cachePageForOffline(`/d/${id}`);
  }, [ensure, id, initialTitle, initialUpdatedAt]);

  // The Y.Doc opens from this device first, then the page's Postgres
  // snapshot, then whatever the sync server sends. Merging is idempotent.
  const session = useSyncSession(id, initialState);
  const status = useSyncStatus(session);
  const pending = usePendingEdits(session);
  const storageFull = useStorageFull(session);

  // The shared title is authoritative once this device has synced the
  // document, now or on an earlier visit. Before that, a Phase 1 title only
  // exists in the Postgres column, so the field stays read-only.
  const [syncedThisTab, setSyncedThisTab] = useState(false);
  if (!syncedThisTab && (status === "saved" || status === "syncing" || status === "saving")) setSyncedThisTab(true);
  const synced = syncedThisTab || (session?.local.everSynced ?? false);

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
  const [notice, setNotice] = useState<string | null>(null);
  const dismissNotice = useCallback(() => setNotice(null), []);
  const shownTitle = title === "" && !synced ? initialTitle : title;

  if (status === "deleted" || status === "not-found") {
    return (
      <>
        <TopBar title={displayTitle(shownTitle)} titleMuted />
        <main id="main" className="flex-1 overflow-y-auto">
          <DeletedDocument id={id} reason={status} />
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar
        title={displayTitle(shownTitle)}
        titleMuted={shownTitle.trim() === ""}
        status={<SyncStatus status={status} pending={pending} />}
        presence={session && <PresenceBar awareness={session.awareness} />}
      />
      <main id="main" className="flex-1 overflow-y-auto" data-testid="document-scroll">
        {status === "halted" && (
          <DocumentBanner
            testId="sync-halted"
            message={SYNC_HALTED}
            action={{
              label: "Download a copy",
              onClick: () => {
                const currentTitle = session?.local.doc.getText(TITLE_FIELD).toString() ?? title;
                downloadFile(exportFileName(currentTitle), documentHtml(currentTitle, editorRef.current?.getHTML() ?? ""));
              },
            }}
          />
        )}
        {storageFull && status !== "halted" && <DocumentBanner testId="storage-full" message={STORAGE_FULL} />}
        <article className="doc-column pt-14 sm:pt-24">
          {session ? (
          <SharedTitleField
            ref={titleRef}
            doc={session.local.doc}
            fallbackTitle={initialTitle}
            synced={synced}
            autoFocus={initialTitle === ""}
            onTitleChange={onTitleChange}
            onExit={() => {
              if (editorRef.current) focusBodyStart(editorRef.current);
            }}
          />
          ) : (
            <TitleSkeleton title={initialTitle} />
          )}
          {session ? (
            <CollaborativeBody
              doc={session.local.doc}
              session={session}
              editorRef={editorRef}
              titleRef={titleRef}
              onNotice={setNotice}
            />
          ) : (
            <div className="doc-prose doc-body mt-6" />
          )}
        </article>
      </main>
      <EditorNotice message={notice} onDismiss={dismissNotice} />
    </>
  );
}

function CollaborativeBody({
  doc,
  session,
  editorRef,
  titleRef,
  onNotice,
}: {
  doc: Y.Doc;
  session: SyncSession;
  onNotice: (message: string) => void;
  editorRef: React.RefObject<Editor | null>;
  titleRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const [linkMode, setLinkMode] = useState(false);
  const [extensions] = useState(() =>
    buildExtensions(doc, {
      onRequestLink: () => setLinkMode(true),
      onFocusToolbar: () =>
        document.querySelector<HTMLButtonElement>('[data-testid="bubble-toolbar"] button')?.focus(),
      onTooLarge: () => onNotice(TOO_LARGE_TO_ADD),
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
