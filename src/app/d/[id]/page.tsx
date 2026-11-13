import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { DocumentEditorLoader } from "@/components/editor/document-editor-loader";
import { bytesToBase64 } from "@/lib/base64";
import { isDocumentId } from "@/lib/ids";
import { displayTitle } from "@/lib/title";
import { getDocument } from "@/server/documents";

// Metadata and the page share one database read per request.
const loadDocument = cache(getDocument);

export async function generateMetadata({ params }: PageProps<"/d/[id]">): Promise<Metadata> {
  const { id } = await params;
  const document = isDocumentId(id) ? await loadDocument(id) : null;
  return { title: document ? displayTitle(document.title) : "Not found" };
}

export default async function DocumentPage({ params }: PageProps<"/d/[id]">) {
  const { id } = await params;
  if (!isDocumentId(id)) notFound();
  const document = await loadDocument(id);
  if (!document) notFound();

  return (
    <DocumentEditorLoader
      key={document.id}
      id={document.id}
      initialTitle={document.title}
      initialUpdatedAt={document.updatedAt}
      initialState={bytesToBase64(document.state)}
      deleted={document.deleted}
    />
  );
}
