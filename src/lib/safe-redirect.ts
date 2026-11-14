/**
 * Only same-site paths may be used as a post sign-in destination, so the
 * sign-in page can never become an open redirect.
 */
export function safeReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return "/";
  return value;
}
