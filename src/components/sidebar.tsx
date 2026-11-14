"use client";

import { PanelLeftClose, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteDocumentAction } from "@/app/actions";
import { DELETE_FAILED } from "@/lib/copy";
import { displayTitle } from "@/lib/title";
import type { DocumentSummary } from "@/server/documents";
import { useDocuments, useShell } from "./app-shell";
import { ConfirmDialog } from "./confirm-dialog";
import { DocumentRow } from "./document-row";
import { IconButton, iconProps } from "./icon-button";
import { NewDocumentButton } from "./new-document-button";
import { useDeviceDocuments, useOnline } from "./use-device";

export function activeDocumentId(pathname: string): string | null {
  const match = /^\/d\/([^/]+)/.exec(pathname);
  return match ? match[1] : null;
}

export function Sidebar({ variant }: { variant: "docked" | "drawer" }) {
  const { documents, remove } = useDocuments();
  const online = useOnline();
  const onDevice = useDeviceDocuments();
  // Offline, the server list may be a stale cached copy: add documents that
  // only this device knows about, so everything openable offline is listed.
  const listed = online
    ? documents
    : [
        ...documents,
        ...[...onDevice.values()]
          .filter((meta) => !documents.some((document) => document.id === meta.id))
          .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
          .map((meta) => ({
            id: meta.id,
            title: meta.title,
            updatedAt: new Date(meta.lastOpenedAt).toISOString(),
            role: meta.role ?? ("viewer" as const),
          })),
      ];
  const sections = [
    { label: "My documents", documents: listed.filter((document) => document.role === "owner") },
    { label: "Shared with me", documents: listed.filter((document) => document.role !== "owner") },
  ];
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
        setDeleteError(DELETE_FAILED);
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
        <div data-testid={`document-list-${variant}`}>
          {sections.map((section) => (
            <section key={section.label} aria-labelledby={`${variant}-${section.label}`} className="mt-2 first:mt-0">
              <h2 id={`${variant}-${section.label}`} className="px-2 pt-2 pb-1 text-meta font-medium text-ink-muted">
                {section.label}
              </h2>
              {section.documents.length === 0 ? (
                <p className="px-2 py-1.5 text-ui-sm text-ink-muted">
                  {section.label === "My documents" ? "No documents yet." : "Nothing shared with you yet."}
                </p>
              ) : (
                <ul className="flex flex-col gap-px">
                  {section.documents.map((document) => (
                    <DocumentRow
                      key={document.id}
                      document={document}
                      active={document.id === activeId}
                      unsynced={(onDevice.get(document.id)?.pendingCount ?? 0) > 0}
                      unavailableOffline={!online && !onDevice.has(document.id)}
                      onRequestDelete={() => {
                        setDeleteError(null);
                        setToDelete(document);
                      }}
                    />
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
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
