"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isDocumentId } from "@/lib/ids";
import { validateTitle } from "@/lib/title";
import {
  type DocumentSummary,
  createDocument,
  deleteDocument,
  renameDocument,
} from "@/server/documents";

export type ActionResult<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

export async function createDocumentAction(): Promise<never> {
  const document = await createDocument();
  revalidatePath("/", "layout");
  redirect(`/d/${document.id}`);
}

export async function renameDocumentAction(
  id: string,
  rawTitle: string,
): Promise<ActionResult<DocumentSummary>> {
  if (!isDocumentId(id)) return { ok: false, error: "This document doesn't exist." };
  const result = validateTitle(rawTitle);
  if (!result.ok) return result;

  const document = await renameDocument(id, result.title);
  if (!document) return { ok: false, error: "This document doesn't exist." };
  revalidatePath("/", "layout");
  return { ok: true, value: document };
}

export async function deleteDocumentAction(id: string): Promise<ActionResult> {
  if (!isDocumentId(id)) return { ok: false, error: "This document doesn't exist." };
  await deleteDocument(id);
  revalidatePath("/", "layout");
  return { ok: true, value: undefined };
}
