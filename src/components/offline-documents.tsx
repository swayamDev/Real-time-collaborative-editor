"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { displayTitle } from "@/lib/title";
import { useShell } from "./app-shell";
import { useDeviceDocuments } from "./use-device";

declare global {
  interface Window {
    __brahmaRequestedPath?: string;
  }
}

/** The offline fallback: what was asked for, and what this device can open. */
export function OfflineDocuments() {
  const { user } = useShell();
  // Read after hydration, so the server render and the first client render agree.
  const requested = useSyncExternalStore(
    () => () => {},
    () => window.__brahmaRequestedPath ?? "",
    () => "",
  );
  const documents = [...useDeviceDocuments(user.id).values()].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  const askedForDocument = requested.startsWith("/d/");

  return (
    <div className="doc-column pt-14 sm:pt-24" data-testid="offline-page">
      <h1 className="doc-title is-quiet">
        {askedForDocument ? "This document isn't available offline." : "Documents on this device"}
      </h1>
      {askedForDocument && (
        <p className="mt-2 text-[19px] leading-[1.65] text-ink-muted">
          Open it once while online to keep a copy on this device.
        </p>
      )}
      <ul className="mt-8 flex flex-col gap-1 font-ui" aria-label="Documents on this device">
        {documents.length === 0 && (
          <li className="text-ui text-ink-muted">No documents are stored on this device yet.</li>
        )}
        {documents.map((meta) => (
          <li key={meta.id}>
            <Link href={`/d/${meta.id}`} className="text-ui text-indigo underline-offset-2 hover:underline">
              {displayTitle(meta.title)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
