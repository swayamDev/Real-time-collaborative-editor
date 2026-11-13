"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import { SyncProvider, type SyncStatus } from "@/lib/collab/provider";
import { syncUrl } from "@/lib/collab/sync-url";

export interface SyncSession {
  provider: SyncProvider;
  awareness: Awareness;
}

/**
 * Connect a document to the sync server for as long as the editor is
 * mounted. Created in an effect (not during render) so a StrictMode double
 * render in development never opens a socket that nobody closes.
 */
export function useSyncSession(documentId: string, doc: Y.Doc): SyncSession | null {
  const [session, setSession] = useState<SyncSession | null>(null);

  useEffect(() => {
    const awareness = new Awareness(doc);
    const provider = new SyncProvider({ url: syncUrl(documentId), doc, awareness });
    // Connecting to an external system is what effects are for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession({ provider, awareness });
    return () => {
      provider.destroy();
      awareness.destroy();
    };
  }, [documentId, doc]);

  // Leaving the page with edits the server has not confirmed: warn.
  useEffect(() => {
    if (!session) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!session.provider.hasUnconfirmedChanges) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [session]);

  return session;
}

const noop = () => () => {};

export function useSyncStatus(session: SyncSession | null): SyncStatus {
  return useSyncExternalStore(
    session ? (listener) => session.provider.subscribe(listener) : noop,
    () => session?.provider.getStatus() ?? "connecting",
    () => "connecting",
  );
}
