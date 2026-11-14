import "server-only";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { user } from "@/db/auth-schema";
import { type MemberRole, documentInvites, documentMembers, documents, shareLinks } from "@/db/schema";
import { isEmail, normalizeEmail } from "@/lib/email-address";
import { displayTitle } from "@/lib/title";
import { sendEmail } from "./email";
import type { CurrentUser } from "./session";
import { shareLinkToken, shareLinkTokenMatches } from "./share-link-token";

/** A change to someone's access, for the sync server to apply live. */
export interface AccessChange {
  userId: string;
  /** null: access removed. */
  role: MemberRole | null;
  accessVersion: number;
}

const RANK: Record<MemberRole, number> = { viewer: 1, editor: 2 };

type Transaction = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/**
 * Create or change a membership.
 *
 *   set      explicit choices (invites, invite claims, role changes): the
 *            role is set exactly; an invite turns a "link" membership into an
 *            "invite" one, so turning the link off never removes people who
 *            were invited directly.
 *   atLeast  opening a share link: never lowers an existing role and never
 *            changes how access was granted; a removed member comes back as
 *            a "link" member.
 *
 * Every change increments access_version. Returns null when nothing changed.
 */
async function upsertMember(
  tx: Transaction,
  documentId: string,
  userId: string,
  role: MemberRole,
  source: "invite" | "link",
  mode: "set" | "atLeast",
): Promise<AccessChange | null> {
  const [existing] = await tx
    .select()
    .from(documentMembers)
    .where(and(eq(documentMembers.documentId, documentId), eq(documentMembers.userId, userId)))
    .for("update");

  if (!existing) {
    await tx.insert(documentMembers).values({ documentId, userId, role, source, accessVersion: 1 });
    return { userId, role, accessVersion: 1 };
  }

  let nextRole: MemberRole;
  let nextSource = existing.source;
  if (mode === "set") {
    nextRole = role;
    if (source === "invite") nextSource = "invite";
  } else if (existing.role === "none") {
    nextRole = role;
    nextSource = "link";
  } else {
    nextRole = RANK[existing.role] >= RANK[role] ? existing.role : role;
  }
  if (nextRole === existing.role && nextSource === existing.source) return null;

  const accessVersion = existing.accessVersion + 1;
  await tx
    .update(documentMembers)
    .set({ role: nextRole, source: nextSource, accessVersion, updatedAt: sql`now()` })
    .where(and(eq(documentMembers.documentId, documentId), eq(documentMembers.userId, userId)));
  return { userId, role: nextRole, accessVersion };
}

async function removeMembership(tx: Transaction, documentId: string, userId: string): Promise<AccessChange | null> {
  const [row] = await tx
    .update(documentMembers)
    .set({ role: "none", accessVersion: sql`${documentMembers.accessVersion} + 1`, updatedAt: sql`now()` })
    .where(
      and(eq(documentMembers.documentId, documentId), eq(documentMembers.userId, userId), ne(documentMembers.role, "none")),
    )
    .returning({ accessVersion: documentMembers.accessVersion });
  return row ? { userId, role: null, accessVersion: row.accessVersion } : null;
}

function appUrl(path: string): string {
  return new URL(path, process.env.BETTER_AUTH_URL ?? "http://localhost:3000").toString();
}

async function documentTitle(documentId: string): Promise<string> {
  const [row] = await db().select({ title: documents.title }).from(documents).where(eq(documents.id, documentId));
  return displayTitle(row?.title ?? "");
}

// Reading

export interface SharingState {
  owner: { id: string; name: string; email: string; image: string | null };
  members: Array<{ userId: string; name: string; email: string; image: string | null; role: MemberRole }>;
  invites: Array<{ id: string; email: string; role: MemberRole }>;
  link: { enabled: boolean; role: MemberRole; url: string | null };
}

export async function getSharing(documentId: string): Promise<SharingState> {
  const [[owner], members, invites, [link]] = await Promise.all([
    db()
      .select({ id: user.id, name: user.name, email: user.email, image: user.image })
      .from(documents)
      .innerJoin(user, eq(user.id, documents.ownerId))
      .where(eq(documents.id, documentId)),
    db()
      .select({ userId: user.id, name: user.name, email: user.email, image: user.image, role: documentMembers.role })
      .from(documentMembers)
      .innerJoin(user, eq(user.id, documentMembers.userId))
      .where(and(eq(documentMembers.documentId, documentId), ne(documentMembers.role, "none")))
      .orderBy(asc(user.email)),
    db()
      .select({ id: documentInvites.id, email: documentInvites.email, role: documentInvites.role })
      .from(documentInvites)
      .where(eq(documentInvites.documentId, documentId))
      .orderBy(asc(documentInvites.email)),
    db().select().from(shareLinks).where(eq(shareLinks.documentId, documentId)),
  ]);
  return {
    owner,
    members: members.map((member) => ({ ...member, role: member.role as MemberRole })),
    invites,
    link: link
      ? {
          enabled: link.enabled,
          role: link.role,
          url: link.enabled ? appUrl(`/s/${documentId}/${shareLinkToken(documentId, link.version)}`) : null,
        }
      : { enabled: false, role: "viewer", url: null },
  };
}

// Invites

export type InviteResult =
  | { ok: true; kind: "member" | "invited"; change: AccessChange | null }
  | { ok: false; error: string };

/**
 * Invite by email. An existing account becomes a member right away; any
 * other address gets a pending invite, applied on its first sign-in with
 * that verified email. Emails are trimmed and lowercased.
 */
export async function inviteByEmail(
  documentId: string,
  inviter: CurrentUser,
  rawEmail: string,
  role: MemberRole,
): Promise<InviteResult> {
  const email = normalizeEmail(rawEmail);
  if (!isEmail(email)) return { ok: false, error: "Enter a valid email address." };

  const outcome = await db().transaction(async (tx) => {
    const [document] = await tx.select({ ownerId: documents.ownerId }).from(documents).where(eq(documents.id, documentId));
    const [invitee] = await tx.select({ id: user.id }).from(user).where(eq(user.email, email));
    if (invitee && invitee.id === document?.ownerId) {
      return { kind: undefined, change: null, error: "You already own this document." } as const;
    }
    if (invitee) {
      return { kind: "member", change: await upsertMember(tx, documentId, invitee.id, role, "invite", "set") } as const;
    }
    await tx
      .insert(documentInvites)
      .values({ documentId, email, role, invitedBy: inviter.id })
      .onConflictDoUpdate({ target: [documentInvites.documentId, documentInvites.email], set: { role } });
    return { kind: "invited", change: null } as const;
  });
  if (outcome.kind === undefined) return { ok: false, error: outcome.error };

  const title = await documentTitle(documentId);
  const inviterName = inviter.name || inviter.email;
  const path = `/d/${documentId}`;
  await sendEmail({
    to: email,
    subject: `${inviterName} shared "${title}" with you`,
    text: `${inviterName} invited you to ${role === "editor" ? "edit" : "view"} "${title}" in Brahma.\n\n${appUrl(
      outcome.kind === "member" ? path : `/sign-in?next=${encodeURIComponent(path)}`,
    )}\n`,
  }).catch((error: unknown) => console.error("Invite email failed", error));
  return { ok: true, kind: outcome.kind, change: outcome.change };
}

export async function revokeInvite(documentId: string, inviteId: string): Promise<void> {
  await db()
    .delete(documentInvites)
    .where(and(eq(documentInvites.documentId, documentId), eq(documentInvites.id, inviteId)));
}

/**
 * Apply every pending invite for this verified email. Called when a user
 * signs in, so invites sent before the account existed take effect.
 */
export async function claimInvites(userId: string, rawEmail: string): Promise<Array<{ documentId: string; change: AccessChange }>> {
  const email = normalizeEmail(rawEmail);
  return db().transaction(async (tx) => {
    const invites = await tx.select().from(documentInvites).where(eq(documentInvites.email, email)).for("update");
    const changes: Array<{ documentId: string; change: AccessChange }> = [];
    for (const invite of invites) {
      const [document] = await tx.select({ ownerId: documents.ownerId }).from(documents).where(eq(documents.id, invite.documentId));
      if (document && document.ownerId !== userId) {
        const change = await upsertMember(tx, invite.documentId, userId, invite.role, "invite", "set");
        if (change) changes.push({ documentId: invite.documentId, change });
      }
      await tx.delete(documentInvites).where(eq(documentInvites.id, invite.id));
    }
    return changes;
  });
}

// Members

export async function setMemberRole(documentId: string, userId: string, role: MemberRole): Promise<AccessChange | null> {
  return db().transaction(async (tx) => {
    const [existing] = await tx
      .select({ role: documentMembers.role, source: documentMembers.source })
      .from(documentMembers)
      .where(and(eq(documentMembers.documentId, documentId), eq(documentMembers.userId, userId)));
    if (!existing || existing.role === "none") return null;
    return upsertMember(tx, documentId, userId, role, existing.source, "set");
  });
}

export async function removeMember(documentId: string, userId: string): Promise<AccessChange | null> {
  return db().transaction((tx) => removeMembership(tx, documentId, userId));
}

// Share link

/**
 * Turn the link on or off, or change its role.
 *
 * Turning it on (again) bumps the version, so any older link stops working.
 * Turning it off removes everyone whose access came only from the link.
 * Changing the role applies to people who joined through the link.
 */
export async function setShareLink(
  documentId: string,
  settings: { enabled: boolean; role: MemberRole },
): Promise<AccessChange[]> {
  return db().transaction(async (tx) => {
    const [link] = await tx.select().from(shareLinks).where(eq(shareLinks.documentId, documentId)).for("update");
    if (!link) {
      if (settings.enabled) await tx.insert(shareLinks).values({ documentId, role: settings.role, enabled: true, version: 1 });
      return [];
    }
    const turningOn = settings.enabled && !link.enabled;
    await tx
      .update(shareLinks)
      .set({
        enabled: settings.enabled,
        role: settings.role,
        version: turningOn ? link.version + 1 : link.version,
        updatedAt: sql`now()`,
      })
      .where(eq(shareLinks.documentId, documentId));

    const linkMembers = await tx
      .select({ userId: documentMembers.userId, role: documentMembers.role })
      .from(documentMembers)
      .where(
        and(eq(documentMembers.documentId, documentId), eq(documentMembers.source, "link"), ne(documentMembers.role, "none")),
      );
    const changes: AccessChange[] = [];
    for (const member of linkMembers) {
      const change = !settings.enabled
        ? await removeMembership(tx, documentId, member.userId)
        : member.role !== settings.role
          ? await upsertMember(tx, documentId, member.userId, settings.role, "link", "set")
          : null;
      if (change) changes.push(change);
    }
    return changes;
  });
}

export type JoinResult = { ok: true; change: AccessChange | null } | { ok: false };

/** Open a share link as `userId`. Never lowers a role the user already has. */
export async function joinByLink(documentId: string, token: string, userId: string): Promise<JoinResult> {
  return db().transaction(async (tx) => {
    const [document] = await tx
      .select({ ownerId: documents.ownerId, deletedAt: documents.deletedAt })
      .from(documents)
      .where(eq(documents.id, documentId));
    const [link] = await tx.select().from(shareLinks).where(eq(shareLinks.documentId, documentId));
    if (!document || document.deletedAt || !link?.enabled || !shareLinkTokenMatches(documentId, link.version, token)) {
      return { ok: false } as const;
    }
    if (document.ownerId === userId) return { ok: true, change: null } as const;
    return { ok: true, change: await upsertMember(tx, documentId, userId, link.role, "link", "atLeast") } as const;
  });
}
