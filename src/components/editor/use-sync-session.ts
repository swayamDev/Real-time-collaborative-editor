"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Awareness } from "y-protocols/awareness";
import type * as Y from "yjs";
import { preferredColor } from "@brahma/protocol";
import { readGuestIdentity } from "@/lib/collab/identity";
import { syncOwnColor } from "@/lib/collab/presence";
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
    // Publish who we are before connecting, so the first presence message
    // the server relays already carries a name and color.
    const { guestId, name } = readGuestIdentity();
    awareness.setLocalStateField("user", { name, guestId, joinedAt: Date.now(), color: preferredColor(guestId) });
    const onPresenceChange = () => syncOwnColor(awareness);
    awareness.on("change", onPresenceChange);

    const provider = new SyncProvider({ url: syncUrl(documentId), doc, awareness });
    // Connecting to an external system is what effects are for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSession({ provider, awareness });
    return () => {
      awareness.off("change", onPresenceChange);
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

/** True while local edits are not yet confirmed by the sync server. */
export function useUnconfirmedChanges(session: SyncSession | null): boolean {
  return useSyncExternalStore(
    session ? (listener) => session.provider.subscribe(listener) : noop,
    () => session?.provider.hasUnconfirmedChanges ?? false,
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
