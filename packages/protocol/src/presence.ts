/**
 * Presence rules. Awareness states come from other people's browsers, so
 * every client treats them as untrusted input: names are sanitized and
 * rendered as text only, colors must be one of the six tokens.
 */

export const COLLAB_COLORS = ["indigo", "madder", "turmeric", "leaf", "lac", "kattha"] as const;
export type CollabColor = (typeof COLLAB_COLORS)[number];

export const NAME_MAX_LENGTH = 40;
export const DEFAULT_NAME = "Guest";

/**
 * A peer's presence, read from its awareness state. On the wire the state is
 * `user: { id, name, image, color, joinedAt }`; the sync server checks `id`
 * against the signed-in user and rewrites `name` and `image` from the token.
 */
export interface PresenceUser {
  name: string;
  color: CollabColor;
  /** The account id. Picks the preferred color and groups one person's tabs. */
  userId: string;
  /** Avatar URL from the account, https only; null shows initials. */
  image: string | null;
  /** Milliseconds since epoch when this client joined. Tie-break for colors. */
  joinedAt: number;
}

// C0 and C1 control characters, plus bidirectional overrides and isolates,
// which could visually reorder a name.
const UNSAFE_CHARACTERS = /[\u0000-\u001f\u007f-\u009f‎‏‪-‮⁦-⁩]/g;

export function sanitizeName(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_NAME;
  const cleaned = raw.replace(UNSAFE_CHARACTERS, " ").replace(/\s+/g, " ").trim();
  // Cap by code point so a surrogate pair is never split.
  const capped = [...cleaned].slice(0, NAME_MAX_LENGTH).join("").trim();
  return capped === "" ? DEFAULT_NAME : capped;
}

export function isCollabColor(value: unknown): value is CollabColor {
  return typeof value === "string" && (COLLAB_COLORS as readonly string[]).includes(value);
}

const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;
const IMAGE_MAX_LENGTH = 2048;

/** Only absolute https URLs, so an avatar can never be a script or data URL. */
export function sanitizeImage(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > IMAGE_MAX_LENGTH) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function sanitizeUserId(raw: unknown, clientId: number): string {
  return typeof raw === "string" && USER_ID.test(raw) ? raw : `client-${clientId}`;
}

function sanitizeJoinedAt(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : Number.MAX_SAFE_INTEGER;
}

/** FNV-1a, 32 bit. Small, fast and identical on every client. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function preferredColor(userId: string): CollabColor {
  return COLLAB_COLORS[hashString(userId) % COLLAB_COLORS.length];
}

/**
 * Read a peer's awareness state. Returns null when there is no `user`
 * object at all (for example a client that has only set its cursor).
 */
export function parsePeerUser(state: unknown, clientId: number): PresenceUser | null {
  if (typeof state !== "object" || state === null) return null;
  const user = (state as { user?: unknown }).user;
  if (typeof user !== "object" || user === null) return null;
  const raw = user as Record<string, unknown>;
  const userId = sanitizeUserId(raw.id, clientId);
  return {
    name: sanitizeName(raw.name),
    color: isCollabColor(raw.color) ? raw.color : preferredColor(userId),
    userId,
    image: sanitizeImage(raw.image),
    joinedAt: sanitizeJoinedAt(raw.joinedAt),
  };
}

export interface ColorCandidate {
  clientId: number;
  userId: string;
  joinedAt: number;
}

/**
 * Assign one color per person, the same way on every client. All of one
 * user's tabs share a color.
 *
 * People are ordered by their earliest joinedAt, then by Yjs client id. In
 * that order each takes its preferred color if it is free, otherwise the
 * next free color around the palette. Earlier joiners keep their color when
 * someone joins. Duplicates only happen with more than six people in a room.
 * Returns the color for every client id.
 */
export function assignColors(candidates: readonly ColorCandidate[]): Map<number, CollabColor> {
  const earliest = new Map<string, ColorCandidate>();
  for (const candidate of candidates) {
    const current = earliest.get(candidate.userId);
    if (
      !current ||
      candidate.joinedAt < current.joinedAt ||
      (candidate.joinedAt === current.joinedAt && candidate.clientId < current.clientId)
    ) {
      earliest.set(candidate.userId, candidate);
    }
  }
  const ordered = [...earliest.values()].sort((a, b) => a.joinedAt - b.joinedAt || a.clientId - b.clientId);
  const taken = new Set<CollabColor>();
  const byUser = new Map<string, CollabColor>();
  for (const candidate of ordered) {
    const start = COLLAB_COLORS.indexOf(preferredColor(candidate.userId));
    let color = COLLAB_COLORS[start];
    for (let step = 0; step < COLLAB_COLORS.length; step++) {
      const option = COLLAB_COLORS[(start + step) % COLLAB_COLORS.length];
      if (!taken.has(option)) {
        color = option;
        break;
      }
    }
    taken.add(color);
    byUser.set(candidate.userId, color);
  }
  return new Map(candidates.map((candidate) => [candidate.clientId, byUser.get(candidate.userId)!]));
}

/** Initials for an avatar: first letters of the first two words. */
export function initials(name: string): string {
  const words = sanitizeName(name).split(" ").filter(Boolean);
  const letters = words.slice(0, 2).map((word) => [...word][0] ?? "");
  return letters.join("").toUpperCase() || "?";
}
