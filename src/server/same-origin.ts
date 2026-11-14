import "server-only";

/**
 * CSRF check for route handlers, which do not get Next's server action
 * origin check. Browsers send Sec-Fetch-Site on every request and Origin on
 * POST; either proving same-origin is enough.
 */
export function isSameOrigin(request: Request): boolean {
  if (request.headers.get("sec-fetch-site") === "same-origin") return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const expected = new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000").origin;
  return origin === expected;
}
