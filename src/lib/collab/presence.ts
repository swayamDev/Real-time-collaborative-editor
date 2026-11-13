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
  clientId: number;
  name: string;
  color: CollabColor;
  isSelf: boolean;
}

/**
 * Everyone in the room, self first, then by join order. Colors come from
 * the deterministic assignment, so every client shows the same colors no
 * matter what a peer claims.
 */
export function participants(awareness: Awareness): Participant[] {
  const selfId = awareness.clientID;
  const users: Array<{ clientId: number; user: PresenceUser }> = [];
  awareness.getStates().forEach((state, clientId) => {
    const user = parsePeerUser(state, clientId);
    if (user) users.push({ clientId, user });
  });
  const colors = assignColors(users.map(({ clientId, user }) => ({ clientId, guestId: user.guestId, joinedAt: user.joinedAt })));
  return users
    .sort((a, b) => {
      if (a.clientId === selfId) return -1;
      if (b.clientId === selfId) return 1;
      return a.user.joinedAt - b.user.joinedAt || a.clientId - b.clientId;
    })
    .map(({ clientId, user }) => ({
      clientId,
      name: user.name,
      color: colors.get(clientId) ?? user.color,
      isSelf: clientId === selfId,
    }));
}

/**
 * Publish our assigned color when it differs from what we last published.
 * Every client runs the same assignment, so this converges in one round.
 */
export function syncOwnColor(awareness: Awareness): void {
  const self = participants(awareness).find((participant) => participant.isSelf);
  const current = awareness.getLocalState()?.user as Partial<PresenceUser> | undefined;
  if (self && current && current.color !== self.color) {
    awareness.setLocalStateField("user", { ...current, color: self.color });
  }
}

/** Collaborator token for a caret, from untrusted awareness data. */
export function caretColor(user: Record<string, unknown>): CollabColor {
  if (isCollabColor(user.color)) return user.color;
  const guestId = typeof user.guestId === "string" ? user.guestId : "";
  return preferredColor(guestId);
}

export function caretName(user: Record<string, unknown>): string {
  return sanitizeName(user.name);
}

/** Text color that passes contrast on the given collaborator color. */
export function onCollabVar(color: CollabColor): string {
  return color === "turmeric" ? "var(--on-collab-turmeric)" : "var(--on-collab)";
}
