import { TITLE_FIELD } from "@brahma/protocol";
import { getHTMLFromFragment, getSchema } from "@tiptap/core";
import { yXmlFragmentToProseMirrorRootNode } from "@tiptap/y-tiptap";
import * as Y from "yjs";
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
 *
 * Content is untrusted. The conversion runs on a throwaway clone, because
 * it deletes anything that does not fit the schema from the document it
 * reads, and on the live document that deletion would sync. Links are
 * limited to http, https and mailto by the schema's link rendering, and
 * the DOM serializer escapes all text and attribute values.
 */
export function documentCopy(doc: Y.Doc): DocumentCopy {
  const clone = new Y.Doc();
  Y.applyUpdate(clone, Y.encodeStateAsUpdate(doc));
  const title = clone.getText(TITLE_FIELD).toString();
  const schema = getSchema(contentExtensions());
  const root = yXmlFragmentToProseMirrorRootNode(clone.getXmlFragment(CONTENT_FIELD), schema);
  const body = getHTMLFromFragment(root.content, schema);
  clone.destroy();
  return { fileName: exportFileName(title), html: documentHtml(title, body) };
}

export function downloadCopy(copy: DocumentCopy): void {
  downloadFile(copy.fileName, copy.html);
}
