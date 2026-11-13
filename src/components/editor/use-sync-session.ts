"use client";

import { preferredColor } from "@brahma/protocol";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Awareness } from "y-protocols/awareness";
import { base64ToBytes } from "@/lib/base64";
import { readGuestIdentity } from "@/lib/collab/identity";
import { LocalDocument } from "@/lib/collab/local-document";
import { LocalStore } from "@/lib/collab/local-store";
import { syncOwnColor } from "@/lib/collab/presence";
import { SyncProvider, type SyncStatus } from "@/lib/collab/provider";
import { syncUrl } from "@/lib/collab/sync-url";

export interface SyncSession {
  local: LocalDocument;
  provider: SyncProvider;
  awareness: Awareness;
}

let storePromise: Promise<LocalStore | null> | null = null;

/**
 * The device store, opened once per page. Null when IndexedDB is not
 * available (some private browsing modes): the editor then works online
 * only, keeping edits in memory until the server acknowledges them.
 */
export function getLocalStore(): Promise<LocalStore | null> {
  storePromise ??= LocalStore.open().catch((error: unknown) => {
    console.warn("IndexedDB is unavailable; edits will not be kept on this device", error);
    return null;
  });
  return storePromise;
}

/**
 * Open a document from this device, render it, then connect it to the sync
 * server for as long as the editor is mounted. Created in an effect so a
 * StrictMode double render in development never leaves a socket open.
 */
export function useSyncSession(documentId: string, serverSnapshot: string): SyncSession | null {
  const [session, setSession] = useState<SyncSession | null>(null);

  useEffect(() => {
    let cancelled = false;
    let teardown = () => {};
    void (async () => {
      const store = await getLocalStore();
      const local = await LocalDocument.open(store, documentId, base64ToBytes(serverSnapshot));
      if (cancelled) {
        local.destroy();
        return;
      }
      const awareness = new Awareness(local.doc);
      // Publish who we are before connecting, so the first presence message
      // the server relays already carries a name and color.
      const { guestId, name } = readGuestIdentity();
      awareness.setLocalStateField("user", { name, guestId, joinedAt: Date.now(), color: preferredColor(guestId) });
      const onPresenceChange = () => syncOwnColor(awareness);
      awareness.on("change", onPresenceChange);
      const provider = new SyncProvider({ url: syncUrl(documentId), local, awareness });
      teardown = () => {
        awareness.off("change", onPresenceChange);
        provider.destroy();
        awareness.destroy();
        local.destroy();
      };
      setSession({ local, provider, awareness });
    })();
    return () => {
      cancelled = true;
      teardown();
      setSession(null);
    };
  }, [documentId, serverSnapshot]);

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

  return session;
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

export function useSyncStatus(session: SyncSession | null): SyncStatus {
  return useSyncExternalStore(
    session ? (listener) => session.provider.subscribe(listener) : noop,
    () => session?.provider.getStatus() ?? "connecting",
    () => "connecting",
  );
}
