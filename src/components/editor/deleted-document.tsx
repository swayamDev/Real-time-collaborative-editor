"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createDocumentCopyAction } from "@/app/actions";
import { loadLocalCopy, moveLocalCopy } from "@/lib/collab/copy-document";
import { discardLocalCopy, disposeDocuments, getLocalStore } from "@/lib/collab/device-store";
import { DELETED_WHILE_OFFLINE, SAVE_COPY_FAILED } from "@/lib/copy";
import { useDocuments, useShell } from "../app-shell";
import { DocumentGone } from "./document-gone";

type State = "checking" | "offer" | "gone";

/**
 * A document that no longer exists on the server. If this device still has
 * edits the server never received, offer to keep them as a new document so
 * offline work is never silently lost. Otherwise clear the local copy.
 */
export function DeletedDocument({ id, reason }: { id: string; reason: "deleted" | "not-found" }) {
  const router = useRouter();
  const { ensure } = useDocuments();
  const { user } = useShell();
  const [state, setState] = useState<State>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const store = await getLocalStore(user.id);
      if (!store) {
        if (!cancelled) setState("gone");
        return;
      }
      const { pendingCount } = await loadLocalCopy(store, id).catch(() => ({ pendingCount: 0 }));
      if (cancelled) return;
      if (pendingCount > 0) {
        setState("offer");
      } else {
        await discardLocalCopy(user.id, id);
        if (!cancelled) setState("gone");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, user.id]);

  if (state === "checking") return <div className="doc-column pt-14 sm:pt-24" aria-busy="true" />;
  if (state === "gone") return <DocumentGone reason={reason} />;

  const saveAsNew = async () => {
    setBusy(true);
    setError(null);
    try {
      const store = await getLocalStore(user.id);
      if (!store) throw new Error("No device store");
      // The open document stops writing, so the copy read below is final.
      await disposeDocuments(id);
      const { doc } = await loadLocalCopy(store, id);
      const result = await createDocumentCopyAction(doc.getText("title").toString());
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await moveLocalCopy(store, id, result.value.id);
      ensure(result.value);
      router.push(`/d/${result.value.id}`);
    } catch {
      setError(SAVE_COPY_FAILED);
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    setBusy(true);
    await discardLocalCopy(user.id, id);
    setBusy(false);
    setState("gone");
  };

  return (
    <div className="doc-column pt-14 sm:pt-24" data-testid="deleted-while-offline">
      <h1 className="doc-title is-quiet">{DELETED_WHILE_OFFLINE}</h1>
      <p className="mt-2 text-[19px] leading-[1.65] text-ink-muted">
        Your edits from that time are still on this device. Keep them as a new document, or discard them.
      </p>
      {error && (
        <p role="alert" className="mt-4 font-ui text-ui text-madder">
          {error}
        </p>
      )}
      <div className="mt-8 flex flex-wrap gap-2 font-ui">
        <button
          type="button"
          onClick={saveAsNew}
          disabled={busy}
          className="inline-flex h-9 items-center rounded-sm bg-indigo px-3.5 text-ui font-medium text-on-indigo transition-colors duration-100 hover:bg-indigo-hover disabled:opacity-70"
        >
          Save as new document
        </button>
        <button
          type="button"
          onClick={discard}
          disabled={busy}
          className="inline-flex h-9 items-center rounded-sm px-3.5 text-ui font-medium text-ink transition-colors duration-100 hover:bg-hover"
        >
          Discard
        </button>
      </div>
    </div>
  );
}
