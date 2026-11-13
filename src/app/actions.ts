"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DELETE_FAILED, RENAME_FAILED, SAVE_COPY_FAILED } from "@/lib/copy";
import { isDocumentId } from "@/lib/ids";
import { validateTitle } from "@/lib/title";
import { type DocumentSummary, createDocument, tombstoneDocument } from "@/server/documents";
import { SyncRequestError, deleteInSync, renameInSync } from "@/server/sync";

export type ActionResult<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

export async function createDocumentAction(): Promise<never> {
  const document = await createDocument();
  revalidatePath("/", "layout");
  redirect(`/d/${document.id}`);
}

/**
 * An empty document to receive a local copy ("Save as new document" after
 * the original was deleted while this device was offline). The client
 * uploads the content itself through its offline queue.
 */
export async function createDocumentCopyAction(rawTitle: string): Promise<ActionResult<DocumentSummary>> {
  const result = validateTitle(rawTitle);
  const title = result.ok ? result.title : "";
  try {
    // The column stays empty: the copied content already carries the shared
    // title, and a non-empty column would make the sync server seed a
    // second copy of it. The first snapshot fills the column.
    const document = await createDocument();
    revalidatePath("/", "layout");
    return { ok: true, value: { ...document, title } };
  } catch (error) {
    console.error("Create failed", error);
    return { ok: false, error: SAVE_COPY_FAILED };
  }
}

/**
 * Rename through the sync server: it replaces the shared title, so open
 * editors update live, and snapshots the title into Postgres right away.
 * No revalidation: the sidebar already shows the new title locally.
 */
export async function renameDocumentAction(
  id: string,
  rawTitle: string,
): Promise<ActionResult<DocumentSummary>> {
  if (!isDocumentId(id)) return { ok: false, error: "This document doesn't exist." };
  const result = validateTitle(rawTitle);
  if (!result.ok) return result;

  try {
    const title = await renameInSync(id, result.title);
    return { ok: true, value: { id, title, updatedAt: new Date().toISOString() } };
  } catch (error) {
    if (error instanceof SyncRequestError && error.status === 404) {
      return { ok: false, error: "This document doesn't exist." };
    }
    console.error("Rename failed", error);
    return { ok: false, error: RENAME_FAILED };
  }
}

/** Delete the row and the live copy together; if either fails, keep both. */
/**
 * Delete in an order where any failure leaves a consistent state:
 *
 * 1. Tombstone the row. Once this commits, the document is deleted for the
 *    list, the page, the sync server and clients returning from offline.
 * 2. Ask the sync server to close sockets and erase the room. Best effort:
 *    if it fails, the room erases itself the next time anything reaches it,
 *    because loads and snapshots check the tombstone.
 */
export async function deleteDocumentAction(id: string): Promise<ActionResult> {
  if (!isDocumentId(id)) return { ok: false, error: "This document doesn't exist." };
  try {
    await tombstoneDocument(id);
  } catch (error) {
    console.error("Delete failed", error);
    return { ok: false, error: DELETE_FAILED };
  }
  try {
    await deleteInSync(id);
  } catch (error) {
    console.warn("Sync server cleanup deferred; the room will erase itself on next contact", error);
  }
  revalidatePath("/", "layout");
  return { ok: true, value: undefined };
}
