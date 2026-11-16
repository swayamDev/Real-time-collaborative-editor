"use client";

import { useEffect, useRef, useState } from "react";
import { Awareness } from "y-protocols/awareness";
import { LocalDocument } from "@/lib/collab/local-document";
import { selfPresence } from "@/lib/collab/presence";
import { type ProviderEnvironment, SyncProvider, browserEnvironment } from "@/lib/collab/provider";
import type { TokenResult } from "@/lib/collab/sync-token-client";
import { syncUrl } from "@/lib/collab/sync-url";
import type { SyncSession } from "../editor/use-sync-session";
import { clientSchemaVersion } from "../editor/schema-version";

export type DemoSeat = "a" | "b";

export const SEAT_NAMES: Record<DemoSeat, string> = { a: "Visitor A", b: "Visitor B" };

/** A token for this seat from the demo route (same answers as the document token route). */
async function fetchDemoToken(seat: DemoSeat): Promise<TokenResult> {
  let response: Response;
  try {
    response = await fetch(`/api/demo/token?seat=${seat}`, { method: "POST", credentials: "same-origin" });
  } catch {
    return { kind: "unavailable" };
  }
  if (response.status === 404) return { kind: "no-access" };
  if (response.status === 410) return { kind: "deleted" };
  if (!response.ok) return { kind: "unavailable" };
  try {
    const body = (await response.json()) as { token?: unknown; expiresIn?: unknown };
    if (typeof body.token !== "string" || typeof body.expiresIn !== "number") return { kind: "unavailable" };
    return { kind: "ok", token: body.token, role: "editor", expiresIn: body.expiresIn };
  } catch {
    return { kind: "unavailable" };
  }
}

/**
 * One demo seat, as if it were its own device. Unlike a document page it
 * keeps nothing on the device (no IndexedDB store) and has no channel to
 * other tabs, so the two seats on one page only ever meet through the sync
 * server. `online` is this seat's own switch: off, it behaves exactly like
 * a device that lost its network.
 */
export function useDemoSession(documentId: string, seat: DemoSeat, online: boolean, generation: number): SyncSession | null {
  const [session, setSession] = useState<SyncSession | null>(null);
  const onlineRef = useRef(online);
  const listeners = useRef(new Set<() => void>());

  useEffect(() => {
    onlineRef.current = online;
    listeners.current.forEach((listener) => listener());
  }, [online]);

  useEffect(() => {
    let cancelled = false;
    let teardown = () => {};
    void (async () => {
      const local = await LocalDocument.open(null, documentId, new Uint8Array());
      if (cancelled) {
        local.destroy();
        return;
      }
      const awareness = new Awareness(local.doc);
      awareness.setLocalStateField(
        "user",
        selfPresence({ id: `demo:${documentId}:${seat}`, name: SEAT_NAMES[seat], image: null }),
      );
      const environment: ProviderEnvironment = {
        ...browserEnvironment,
        isOnline: () => onlineRef.current && browserEnvironment.isOnline(),
        onConnectivityChange: (listener) => {
          listeners.current.add(listener);
          const stopBrowser = browserEnvironment.onConnectivityChange(listener);
          return () => {
            listeners.current.delete(listener);
            stopBrowser();
          };
        },
        // Each seat flushes on its own, as two devices would.
        locks: { request: (_name, callback) => callback() },
      };
      const provider = new SyncProvider({
        url: syncUrl(documentId),
        local,
        awareness,
        initialRole: "editor",
        schemaVersion: clientSchemaVersion(),
        fetchToken: () => fetchDemoToken(seat),
        environment,
      });
      teardown = () => {
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
  }, [documentId, seat, generation]);

  return session;
}
