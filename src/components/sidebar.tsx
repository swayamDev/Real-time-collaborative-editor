"use client";

import { PanelLeftClose, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteDocumentAction } from "@/app/actions";
import { displayTitle } from "@/lib/title";
import type { DocumentSummary } from "@/server/documents";
import { useDocuments, useShell } from "./app-shell";
import { ConfirmDialog } from "./confirm-dialog";
import { DocumentRow } from "./document-row";
import { IconButton, iconProps } from "./icon-button";
import { NewDocumentButton } from "./new-document-button";

export function activeDocumentId(pathname: string): string | null {
  const match = /^\/d\/([^/]+)/.exec(pathname);
  return match ? match[1] : null;
}

export function Sidebar({ variant }: { variant: "docked" | "drawer" }) {
  const { documents, remove } = useDocuments();
  const { toggleSidebar, closeDrawer } = useShell();
  const pathname = usePathname();
  const router = useRouter();
  const activeId = activeDocumentId(pathname);

  const [toDelete, setToDelete] = useState<DocumentSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();

  const confirmDelete = () => {
    if (!toDelete) return;
    const { id } = toDelete;
    setDeleteError(null);
    startDelete(async () => {
      try {
        const result = await deleteDocumentAction(id);
        if (!result.ok) {
          setDeleteError(result.error);
          return;
        }
      } catch {
        setDeleteError("Couldn't delete. Check your connection and try again.");
        return;
      }
      remove(id);
      setToDelete(null);
      if (id === activeId) router.replace("/");
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between pr-2 pl-4">
        {/* Placeholder slot for the wordmark. */}
        <span className="text-brand font-semibold tracking-[-0.01em] text-ink">Brahma</span>
        {variant === "docked" ? (
          <IconButton label="Collapse sidebar" onClick={toggleSidebar}>
            <PanelLeftClose {...iconProps} />
          </IconButton>
        ) : (
          <IconButton label="Close sidebar" onClick={closeDrawer}>
            <X {...iconProps} />
          </IconButton>
        )}
      </div>

      <div className="shrink-0 px-2 pb-2">
        <NewDocumentButton />
      </div>

      <nav aria-label="Documents" className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {documents.length === 0 ? (
          <p className="px-2 py-1.5 text-ui-sm text-ink-muted">No documents yet.</p>
        ) : (
          <ul className="flex flex-col gap-px" data-testid={`document-list-${variant}`}>
            {documents.map((document) => (
              <DocumentRow
                key={document.id}
                document={document}
                active={document.id === activeId}
                onRequestDelete={() => {
                  setDeleteError(null);
                  setToDelete(document);
                }}
              />
            ))}
          </ul>
        )}
      </nav>

      <ConfirmDialog
        open={toDelete !== null}
        title={toDelete ? `Delete "${displayTitle(toDelete.title)}"?` : ""}
        description="This can't be undone."
        confirmLabel="Delete"
        pendingLabel="Deleting"
        pending={deleting}
        error={deleteError}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
