import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/** Pages anyone can open without signing in (keep in step with PUBLIC_PAGES in sw/cache-policy.mjs). */
const PUBLIC_PATHS = ["/privacy"];

/**
 * Send visitors without a session cookie to sign in. This is only a fast
 * first gate: pages, actions and routes all verify the session themselves.
 */
export function proxy(request: NextRequest) {
  if (PUBLIC_PATHS.includes(request.nextUrl.pathname)) return NextResponse.next();
  if (getSessionCookie(request)) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = "/sign-in";
  url.search = `?next=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except sign-in, auth endpoints, API routes (they answer 401
  // themselves), static files and the service worker.
  matcher: ["/((?!sign-in|api/|_next/|sw\.js|favicon\.ico).*)"],
};
