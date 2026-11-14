/** Emails are compared and stored trimmed and lowercased everywhere (invites, claims, sign-in). */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isEmail(value: string): boolean {
  return value.length <= 254 && EMAIL.test(value);
}
