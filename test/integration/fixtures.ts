import { randomUUID } from "node:crypto";
import { db } from "@/db/client";
import { user } from "@/db/auth-schema";
import { documentMembers } from "@/db/schema";
import { createDocument } from "@/server/documents";
import type { CurrentUser } from "@/server/session";
import { session } from "./session";


export async function makeUser(label: string): Promise<CurrentUser> {
  const id = `test-${label}-${randomUUID()}`;
  const email = `${id}@example.test`;
  await db().insert(user).values({ id, name: label, email, emailVerified: true });
  return { id, name: label, email, image: null };
}

export interface World {
  owner: CurrentUser;
  editor: CurrentUser;
  viewer: CurrentUser;
  stranger: CurrentUser;
  documentId: string;
}

/** A document with an owner, an editor, a viewer and someone with no access. */
export async function makeWorld(): Promise<World> {
  const [owner, editor, viewer, stranger] = await Promise.all(
    ["owner", "editor", "viewer", "stranger"].map((label) => makeUser(label)),
  );
  const document = await createDocument(owner.id, "Plans");
  await db()
    .insert(documentMembers)
    .values([
      { documentId: document.id, userId: editor.id, role: "editor", source: "invite" },
      { documentId: document.id, userId: viewer.id, role: "viewer", source: "invite" },
    ]);
  return { owner, editor, viewer, stranger, documentId: document.id };
}

export function as(person: CurrentUser | null): void {
  session.current = person;
}
