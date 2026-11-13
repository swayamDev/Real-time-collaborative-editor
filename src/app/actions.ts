"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DELETE_FAILED, RENAME_FAILED } from "@/lib/copy";
import { isDocumentId } from "@/lib/ids";
import { validateTitle } from "@/lib/title";
import { type DocumentSummary, createDocument, deleteDocument } from "@/server/documents";
import { SyncRequestError, deleteInSync, renameInSync } from "@/server/sync";

export type ActionResult<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

export async function createDocumentAction(): Promise<never> {
  const document = await createDocument();
  revalidatePath("/", "layout");
  redirect(`/d/${document.id}`);
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
export async function deleteDocumentAction(id: string): Promise<ActionResult> {
  if (!isDocumentId(id)) return { ok: false, error: "This document doesn't exist." };
  try {
    await deleteDocument(id, () => deleteInSync(id));
  } catch (error) {
    console.error("Delete failed", error);
    return { ok: false, error: DELETE_FAILED };
  }
  revalidatePath("/", "layout");
  return { ok: true, value: undefined };
}
