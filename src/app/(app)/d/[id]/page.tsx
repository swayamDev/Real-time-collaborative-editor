import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { DocumentEditorLoader } from "@/components/editor/document-editor-loader";
import { bytesToBase64 } from "@/lib/base64";
import { isDocumentId } from "@/lib/ids";
import { displayTitle } from "@/lib/title";
import { getAccess } from "@/server/authz";
import { getDocument } from "@/server/documents";
import { requireUserOrRedirect } from "@/server/session";

/**
 * The document if this user has access to it. A tombstoned document is still
 * returned to people who had access, so a device holding unsynced edits can
 * offer to keep them. Everyone else gets the same 404 as a missing document.
 */
const loadDocument = cache(async (id: string) => {
  const user = await requireUserOrRedirect(`/d/${id}`);
  if (!isDocumentId(id)) return null;
  const access = await getAccess(user.id, id, { includeDeleted: true });
  if (!access) return null;
  return getDocument(id, access.role);
});

export async function generateMetadata({ params }: PageProps<"/d/[id]">): Promise<Metadata> {
  const document = await loadDocument((await params).id);
  return { title: document ? displayTitle(document.title) : "Not found" };
}

export default async function DocumentPage({ params }: PageProps<"/d/[id]">) {
  const document = await loadDocument((await params).id);
  if (!document) notFound();

  return (
    <DocumentEditorLoader
      key={document.id}
      id={document.id}
      role={document.role}
      initialTitle={document.title}
      initialUpdatedAt={document.updatedAt}
      initialState={document.deleted ? "" : bytesToBase64(document.state)}
      deleted={document.deleted}
    />
  );
}
