import "client-only";
import {
  type CollabColor,
  type PresenceUser,
  assignColors,
  isCollabColor,
  parsePeerUser,
  preferredColor,
  sanitizeName,
} from "@brahma/protocol";
import type { Awareness } from "y-protocols/awareness";

export interface Participant {
  /** The client id of this person's earliest tab in the room. */
  clientId: number;
  userId: string;
  name: string;
  image: string | null;
  color: CollabColor;
  isSelf: boolean;
}

/** What this tab publishes as its presence, from the signed-in account. */
export function selfPresence(user: { id: string; name: string; image: string | null }, joinedAt = Date.now()) {
  return { id: user.id, name: sanitizeName(user.name), image: user.image, joinedAt, color: preferredColor(user.id) };
}

/**
 * Everyone in the room, one entry per person: self first, then by join
 * order. Your own other tabs count as you. Colors come from the
 * deterministic assignment, so every client shows the same colors no matter
 * what a peer claims.
 */
export function participants(awareness: Awareness): Participant[] {
  const selfId = awareness.clientID;
  const users: Array<{ clientId: number; user: PresenceUser }> = [];
  awareness.getStates().forEach((state, clientId) => {
    const user = parsePeerUser(state, clientId);
    if (user) users.push({ clientId, user });
  });
  const colors = assignColors(users.map(({ clientId, user }) => ({ clientId, userId: user.userId, joinedAt: user.joinedAt })));
  const selfUserId = users.find(({ clientId }) => clientId === selfId)?.user.userId;

  const byUser = new Map<string, { clientId: number; user: PresenceUser }>();
  for (const entry of users) {
    const current = byUser.get(entry.user.userId);
    if (!current || entry.user.joinedAt < current.user.joinedAt || (entry.user.joinedAt === current.user.joinedAt && entry.clientId < current.clientId)) {
      byUser.set(entry.user.userId, entry);
    }
  }
  return [...byUser.values()]
    .map(({ clientId, user }) => ({
      clientId,
      userId: user.userId,
      name: user.name,
      image: user.image,
      color: colors.get(clientId) ?? user.color,
      isSelf: user.userId === selfUserId,
    }))
    .sort((a, b) => {
      if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
      const joined = (p: Participant) => byUser.get(p.userId)!.user.joinedAt;
      return joined(a) - joined(b) || a.clientId - b.clientId;
    });
}

/**
 * Publish our assigned color when it differs from what we last published.
 * Every client runs the same assignment, so this converges in one round.
 */
export function syncOwnColor(awareness: Awareness): void {
  const self = participants(awareness).find((participant) => participant.isSelf);
  const current = awareness.getLocalState()?.user as Record<string, unknown> | undefined;
  if (self && current && current.color !== self.color) {
    awareness.setLocalStateField("user", { ...current, color: self.color });
  }
}

/** Collaborator token for a caret, from untrusted awareness data. */
export function caretColor(user: Record<string, unknown>): CollabColor {
  if (isCollabColor(user.color)) return user.color;
  return preferredColor(typeof user.id === "string" ? user.id : "");
}

export function caretName(user: Record<string, unknown>): string {
  return sanitizeName(user.name);
}

/** Text color that passes contrast on the given collaborator color. */
export function onCollabVar(color: CollabColor): string {
  return color === "turmeric" ? "var(--on-collab-turmeric)" : "var(--on-collab)";
}
