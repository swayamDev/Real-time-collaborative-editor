"use client";

import { Selection } from "@tiptap/pm/state";
import { type Editor, EditorContent, useEditor } from "@tiptap/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import {
  ACCESS_DOWNGRADED,
  ACCESS_REVOKED,
  SESSION_ENDED,
  STORAGE_FULL,
  SYNC_HALTED,
  TOO_LARGE_TO_ADD,
  VIEW_ONLY,
} from "@/lib/copy";
import { type Role, can, canWrite } from "@/lib/permissions";
import { displayTitle } from "@/lib/title";
import { useDocuments, useShell } from "../app-shell";
import { cachePageForOffline } from "../service-worker";
import { ShareButton } from "../share-dialog";
import { TopBar } from "../top-bar";
import { BubbleToolbar } from "./bubble-toolbar";
import { DocumentBanner } from "./document-banner";
import { type DocumentCopy, documentCopy, downloadCopy } from "./document-copy";
import { DeletedDocument } from "./deleted-document";
import { EditorNotice } from "./editor-notice";
import { PresenceBar } from "./presence-bar";
import { ReadOnlyState, buildExtensions } from "./extensions";
import { SharedTitleField } from "./shared-title-field";
import { SyncStatus } from "./sync-status";
import { TitleSkeleton } from "./title-skeleton";
import {
  type SyncSession,
  usePendingEdits,
  useRole,
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
  /** The current user's role on this document. */
  role: Role;
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

function LiveDocumentEditor({ id, initialTitle, initialUpdatedAt, initialState, role: pageRole }: DocumentEditorProps) {
  const { setTitle, touch, ensure, remove, setRole } = useDocuments();
  const { user } = useShell();
  const router = useRouter();

  useEffect(() => {
    ensure({ id, title: initialTitle, updatedAt: initialUpdatedAt, role: pageRole });
    // Keep this page for offline use, even when it was reached by a client-side navigation.
    cachePageForOffline(`/d/${id}`);
  }, [ensure, id, initialTitle, initialUpdatedAt, pageRole]);

  // The Y.Doc opens from this device first, then the page's Postgres
  // snapshot, then whatever the sync server sends. Merging is idempotent.
  const { session, rebuildAsViewer, clearLocalCopy } = useSyncSession(id, initialState, user, pageRole);
  const status = useSyncStatus(session);
  // The server's word on the role replaces the page's once a token arrives.
  const role = useRole(session, pageRole);
  const readOnlyBody = !canWrite(role);
  const readOnlyTitle = !can(role, "rename");

  useEffect(() => {
    setRole(id, role);
  }, [setRole, id, role]);

  // Downgrade handling: keep a copy of what this device had (it includes
  // the edits the server refused), then rebuild the local copy as a viewer.
  const [refusedCopy, setRefusedCopy] = useState<DocumentCopy | null>(null);
  useEffect(() => {
    if (!session) return;
    let handled = false;
    return session.provider.subscribe(() => {
      if (handled || session.provider.getStatus() !== "downgraded") return;
      handled = true;
      setRefusedCopy(documentCopy(session.local.doc));
      rebuildAsViewer();
    });
  }, [session, rebuildAsViewer]);

  // Access removed: the page keeps its in-memory copy for "Download a copy";
  // this device's copy goes.
  useEffect(() => {
    if (status !== "revoked") return;
    void clearLocalCopy();
    remove(id);
  }, [status, clearLocalCopy, remove, id]);
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

  if (status === "revoked") {
    return (
      <>
        <TopBar title={displayTitle(shownTitle)} titleMuted />
        <main id="main" className="flex-1 overflow-y-auto">
          <div className="doc-column pt-14 sm:pt-24" data-testid="access-revoked">
            <h1 className="doc-title is-quiet">{ACCESS_REVOKED}</h1>
            <div className="mt-8 flex flex-wrap gap-2 font-ui">
              <button
                type="button"
                onClick={() => session && downloadCopy(documentCopy(session.local.doc))}
                className="inline-flex h-9 items-center rounded-sm bg-indigo px-3.5 text-ui font-medium text-on-indigo transition-colors duration-100 hover:bg-indigo-hover"
              >
                Download a copy
              </button>
            </div>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar
        title={displayTitle(shownTitle)}
        titleMuted={shownTitle.trim() === ""}
        status={
          <>
            {readOnlyBody && (
              <span data-testid="view-only" className="px-2 text-ui-sm whitespace-nowrap text-ink-muted">
                {VIEW_ONLY}
              </span>
            )}
            <SyncStatus status={status} pending={pending} />
          </>
        }
        presence={session && <PresenceBar awareness={session.awareness} />}
        actions={can(role, "share") ? <ShareButton documentId={id} title={displayTitle(shownTitle)} /> : null}
      />
      <main id="main" className="flex-1 overflow-y-auto" data-testid="document-scroll">
        {refusedCopy && (
          <DocumentBanner
            testId="access-downgraded"
            message={ACCESS_DOWNGRADED}
            action={{ label: "Download a copy", onClick: () => downloadCopy(refusedCopy) }}
          />
        )}
        {status === "session-ended" && (
          <DocumentBanner
            testId="session-ended"
            message={SESSION_ENDED}
            action={{ label: "Sign in", onClick: () => router.push(`/sign-in?next=${encodeURIComponent(`/d/${id}`)}`) }}
          />
        )}
        {status === "halted" && (
          <DocumentBanner
            testId="sync-halted"
            message={SYNC_HALTED}
            action={{
              label: "Download a copy",
              onClick: () => session && downloadCopy(documentCopy(session.local.doc)),
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
            readOnly={readOnlyTitle}
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
              key={session.local.doc.guid}
              doc={session.local.doc}
              session={session}
              readOnly={readOnlyBody}
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
  readOnly,
  editorRef,
  titleRef,
  onNotice,
}: {
  doc: Y.Doc;
  session: SyncSession;
  /** A viewer: no typing, paste, drop, toolbar or undo. */
  readOnly: boolean;
  onNotice: (message: string) => void;
  editorRef: React.RefObject<Editor | null>;
  titleRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const [linkMode, setLinkMode] = useState(false);
  // Read by the editor's read-only guard on every transaction.
  const [readOnlyState] = useState(() => new ReadOnlyState(readOnly));
  const [extensions] = useState(() =>
    buildExtensions(
      doc,
      {
        onRequestLink: () => setLinkMode(true),
        onFocusToolbar: () =>
          document.querySelector<HTMLButtonElement>('[data-testid="bubble-toolbar"] button')?.focus(),
        onTooLarge: () => onNotice(TOO_LARGE_TO_ADD),
      },
      session.awareness,
      readOnlyState,
    ),
  );

  const editor = useEditor({
    immediatelyRender: false,
    extensions,
    editable: !readOnly,
    editorProps: EDITOR_PROPS,
    onSelectionUpdate: () => setLinkMode(false),
  });

  useEffect(() => {
    readOnlyState.set(readOnly);
    editor?.setEditable(!readOnly);
  }, [editor, readOnly, readOnlyState]);

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
      {editor && !readOnly && <BubbleToolbar editor={editor} linkMode={linkMode} setLinkMode={setLinkMode} />}
    </div>
  );
}
