import "client-only";
import { DEFAULT_NAME, sanitizeName } from "@brahma/protocol";
import { writePreferenceCookie } from "../preferences";

/**
 * Guest identity until accounts arrive in Phase 4. Both values live in
 * cookies: the name so it survives reloads, the guest id so a person keeps
 * the same preferred color.
 */
export const NAME_COOKIE = "brahma-name";
export const GUEST_COOKIE = "brahma-guest";

function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      try {
        return decodeURIComponent(trimmed.slice(prefix.length));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export interface GuestIdentity {
  guestId: string;
  name: string;
}

export function readGuestIdentity(): GuestIdentity {
  let guestId = readCookie(GUEST_COOKIE);
  if (!guestId || !/^[A-Za-z0-9-]{1,64}$/.test(guestId)) {
    guestId = crypto.randomUUID();
    writePreferenceCookie(GUEST_COOKIE, guestId);
  }
  return { guestId, name: sanitizeName(readCookie(NAME_COOKIE) ?? DEFAULT_NAME) };
}

/** Save a display name. Returns it as stored (sanitized). */
export function saveGuestName(raw: string): string {
  const name = sanitizeName(raw);
  writePreferenceCookie(NAME_COOKIE, encodeURIComponent(name));
  return name;
}
