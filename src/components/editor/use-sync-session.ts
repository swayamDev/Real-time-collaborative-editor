"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Awareness } from "y-protocols/awareness";
import { base64ToBytes } from "@/lib/base64";
import { AccessChannel } from "@/lib/collab/access-channel";
import { discardLocalCopy, getLocalStore, trackDocument } from "@/lib/collab/device-store";
import { LocalDocument } from "@/lib/collab/local-document";
import { selfPresence, syncOwnColor } from "@/lib/collab/presence";
import { SyncProvider, type SyncStatus } from "@/lib/collab/provider";
import { fetchSyncToken } from "@/lib/collab/sync-token-client";
import { syncUrl } from "@/lib/collab/sync-url";
import { TabChannel } from "@/lib/collab/tab-channel";
import type { Role } from "@/lib/permissions";
import type { ShellUser } from "../app-shell";
import { clientSchemaVersion } from "./schema-version";

export interface SyncSession {
  local: LocalDocument;
  provider: SyncProvider;
  awareness: Awareness;
}

export interface SyncSessionHandle {
  session: SyncSession | null;
  /**
   * Downgrade handling: drop this device's copy (it holds edits the server
   * refused) and open the document again from the server, as a viewer.
   */
  rebuildAsViewer: () => void;
  /** Access removed: drop this device's copy. The open page keeps its in-memory copy. */
  clearLocalCopy: () => Promise<void>;
}

/**
 * Open a document from this device, render it, then connect it to the sync
 * server for as long as the editor is mounted. Created in an effect so a
 * StrictMode double render in development never leaves a socket open.
 */
export function useSyncSession(
  documentId: string,
  serverSnapshot: string,
  user: ShellUser,
  initialRole: Role,
): SyncSessionHandle {
  const [session, setSession] = useState<SyncSession | null>(null);
  const [generation, setGeneration] = useState(0);
  const clearFirst = useRef(false);
  // The latest role this tab knows; a rebuilt session starts from it.
  const role = useRef(initialRole);
  const userRef = useRef(user);
  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    let teardown = () => {};
    void (async () => {
      if (clearFirst.current) {
        clearFirst.current = false;
        await discardLocalCopy(user.id, documentId);
      }
      const store = await getLocalStore(user.id);
      const local = await LocalDocument.open(store, documentId, base64ToBytes(serverSnapshot));
      if (cancelled) {
        local.destroy();
        return;
      }
      const untrack = trackDocument(local);
      const me = userRef.current;
      // Other tabs of this document on this device, online or not.
      const tabs = new TabChannel(documentId, local.doc);
      tabs.setAcceptEdits(role.current !== "viewer");
      const awareness = new Awareness(local.doc);
      // Publish who we are before connecting, so the first presence message
      // the server relays already carries a name and color.
      awareness.setLocalStateField("user", selfPresence(me));
      const onPresenceChange = () => syncOwnColor(awareness);
      awareness.on("change", onPresenceChange);

      let provider: SyncProvider | null = null;
      // Role changes this user's other tabs learned from the server.
      const access = new AccessChannel(me.id, (notice) => {
        if (notice.docId === documentId) provider?.applyAccessNotice(notice.role);
      });
      provider = new SyncProvider({
        url: syncUrl(documentId),
        local,
        awareness,
        initialRole: role.current,
        schemaVersion: clientSchemaVersion(),
        fetchToken: () => fetchSyncToken(documentId),
        onAccessLearned: (learned) => {
          if (learned) role.current = learned;
          tabs.setAcceptEdits(learned !== null && learned !== "viewer");
          access.post({ docId: documentId, role: learned });
        },
      });
      const current = provider;
      teardown = () => {
        awareness.off("change", onPresenceChange);
        current.destroy();
        access.close();
        tabs.close();
        awareness.destroy();
        untrack();
        local.destroy();
      };
      setSession({ local, provider: current, awareness });
    })();
    return () => {
      cancelled = true;
      teardown();
      setSession(null);
    };
  }, [documentId, serverSnapshot, user.id, generation]);

  // Warn before leaving only if an edit is neither acknowledged by the
  // server nor written on this device.
  useEffect(() => {
    if (!session) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!session.provider.hasUnsavedChanges) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [session]);

  const rebuildAsViewer = useCallback(() => {
    role.current = "viewer";
    clearFirst.current = true;
    setGeneration((value) => value + 1);
  }, []);

  // The open document stops writing first, then its copy is deleted. The
  // page keeps the Y.Doc in memory for "Download a copy".
  const clearLocalCopy = useCallback(() => discardLocalCopy(user.id, documentId), [documentId, user.id]);

  return { session, rebuildAsViewer, clearLocalCopy };
}

const noop = () => () => {};

/** True while local edits are not yet acknowledged by the sync server. */
export function usePendingEdits(session: SyncSession | null): boolean {
  return useSyncExternalStore(
    session ? (listener) => session.provider.subscribe(listener) : noop,
    () => session?.provider.hasPendingEdits ?? false,
    () => false,
  );
}

/** An edit exists that is neither acknowledged by the server nor written on this device. */
export function useUnsavedChanges(session: SyncSession | null): boolean {
  return useSyncExternalStore(
    session ? (listener) => session.provider.subscribe(listener) : noop,
    () => session?.provider.hasUnsavedChanges ?? false,
    () => false,
  );
}

/** The device ran out of storage; edits are kept in memory until acknowledged. */
export function useStorageFull(session: SyncSession | null): boolean {
  return useSyncExternalStore(
    session ? (listener) => session.provider.subscribe(listener) : noop,
    () => session?.local.storageFull ?? false,
    () => false,
  );
}

export function useSyncStatus(session: SyncSession | null): SyncStatus {
  return useSyncExternalStore(
    session ? (listener) => session.provider.subscribe(listener) : noop,
    () => session?.provider.getStatus() ?? "connecting",
    () => "connecting",
  );
}

/** The role the server last gave this tab; the page's role until a session exists. */
export function useRole(session: SyncSession | null, fallback: Role): Role {
  return useSyncExternalStore(
    session ? (listener) => session.provider.subscribe(listener) : noop,
    () => session?.provider.getRole() ?? fallback,
    () => fallback,
  );
}
