"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { DocumentMeta } from "@/lib/collab/local-store";
import { STORE_CHANNEL } from "@/lib/collab/local-store";
import { getLocalStore } from "@/lib/collab/device-store";

function subscribeOnline(listener: () => void): () => void {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

/** navigator.onLine. True during server rendering. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

/**
 * Documents stored on this device, keyed by id, kept current across tabs
 * through the store's BroadcastChannel. Empty until the store has loaded.
 */
export function useDeviceDocuments(userId: string): Map<string, DocumentMeta> {
  const [documents, setDocuments] = useState<Map<string, DocumentMeta>>(() => new Map());

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const store = await getLocalStore(userId);
      if (!store) return;
      const metas = await store.listDocuments().catch(() => []);
      if (!cancelled) setDocuments(new Map(metas.map((meta) => [meta.id, meta])));
    };
    void refresh();
    const channel = new BroadcastChannel(STORE_CHANNEL);
    channel.onmessage = () => void refresh();
    return () => {
      cancelled = true;
      channel.close();
    };
  }, [userId]);

  return documents;
}
