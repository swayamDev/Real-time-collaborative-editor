"use server";

import type { MemberRole } from "@/db/schema";
import { isDocumentId } from "@/lib/ids";
import { RATE_LIMITED } from "@/lib/copy";
import { guardDocument } from "@/server/guards";
import { allow } from "@/server/rate-limit";
import {
  type SharingState,
  getSharing,
  inviteByEmail,
  removeMember,
  revokeInvite,
  setMemberRole,
  setShareLink,
} from "@/server/sharing";
import { scheduleAccessChanges } from "@/server/sync";

type Result<T = undefined> = { ok: true; value: T } | { ok: false; error: string };

function parseRole(value: unknown): MemberRole | null {
  return value === "editor" || value === "viewer" ? value : null;
}

/*
 * Only the owner shares, invites and changes roles. Each action checks
 * that itself; server actions are public endpoints.
 */

export async function getSharingAction(documentId: unknown): Promise<Result<SharingState>> {
  const guard = await guardDocument(documentId, "share");
  if (!guard.ok) return guard;
  return { ok: true, value: await getSharing(documentId as string) };
}

export async function inviteAction(documentId: unknown, email: unknown, role: unknown): Promise<Result<SharingState>> {
  const guard = await guardDocument(documentId, "share");
  if (!guard.ok) return guard;
  const parsedRole = parseRole(role);
  if (typeof email !== "string" || !parsedRole) return { ok: false, error: "Enter a valid email address." };
  if (!(await allow("invite", guard.value.user.id))) return { ok: false, error: RATE_LIMITED };

  const result = await inviteByEmail(documentId as string, guard.value.user, email, parsedRole);
  if (!result.ok) return result;
  if (result.change) scheduleAccessChanges(documentId as string, [result.change]);
  return { ok: true, value: await getSharing(documentId as string) };
}

export async function changeRoleAction(documentId: unknown, userId: unknown, role: unknown): Promise<Result<SharingState>> {
  const guard = await guardDocument(documentId, "changeRoles");
  if (!guard.ok) return guard;
  const parsedRole = parseRole(role);
  if (typeof userId !== "string" || !parsedRole) return { ok: false, error: "Choose a role." };
  const change = await setMemberRole(documentId as string, userId, parsedRole);
  if (change) scheduleAccessChanges(documentId as string, [change]);
  return { ok: true, value: await getSharing(documentId as string) };
}

export async function removeMemberAction(documentId: unknown, userId: unknown): Promise<Result<SharingState>> {
  const guard = await guardDocument(documentId, "changeRoles");
  if (!guard.ok) return guard;
  if (typeof userId !== "string") return { ok: false, error: "Choose a person." };
  const change = await removeMember(documentId as string, userId);
  if (change) scheduleAccessChanges(documentId as string, [change]);
  return { ok: true, value: await getSharing(documentId as string) };
}

export async function revokeInviteAction(documentId: unknown, inviteId: unknown): Promise<Result<SharingState>> {
  const guard = await guardDocument(documentId, "share");
  if (!guard.ok) return guard;
  if (typeof inviteId !== "string" || !isDocumentId(inviteId)) return { ok: false, error: "Choose an invite." };
  await revokeInvite(documentId as string, inviteId);
  return { ok: true, value: await getSharing(documentId as string) };
}

export async function setShareLinkAction(documentId: unknown, enabled: unknown, role: unknown): Promise<Result<SharingState>> {
  const guard = await guardDocument(documentId, "share");
  if (!guard.ok) return guard;
  const parsedRole = parseRole(role);
  if (typeof enabled !== "boolean" || !parsedRole) return { ok: false, error: "Choose a role." };
  const changes = await setShareLink(documentId as string, { enabled, role: parsedRole });
  scheduleAccessChanges(documentId as string, changes);
  return { ok: true, value: await getSharing(documentId as string) };
}
