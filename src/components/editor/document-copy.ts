import { TITLE_FIELD } from "@brahma/protocol";
import { getHTMLFromFragment, getSchema } from "@tiptap/core";
import { yXmlFragmentToProseMirrorRootNode } from "@tiptap/y-tiptap";
import type * as Y from "yjs";
import { documentHtml, downloadFile, exportFileName } from "@/lib/collab/export-html";
import { CONTENT_FIELD } from "@/lib/collab/yjs";
import { contentExtensions } from "./extensions";

export interface DocumentCopy {
  fileName: string;
  html: string;
}

/**
 * A standalone HTML copy of a document straight from its Y.Doc, so it can be
 * taken after the editor is gone (access removed) or before the local copy
 * is rebuilt (access lowered). Browser only: it serializes through the DOM.
 */
export function documentCopy(doc: Y.Doc): DocumentCopy {
  const title = doc.getText(TITLE_FIELD).toString();
  const schema = getSchema(contentExtensions());
  const root = yXmlFragmentToProseMirrorRootNode(doc.getXmlFragment(CONTENT_FIELD), schema);
  return { fileName: exportFileName(title), html: documentHtml(title, getHTMLFromFragment(root.content, schema)) };
}

export function downloadCopy(copy: DocumentCopy): void {
  downloadFile(copy.fileName, copy.html);
}
