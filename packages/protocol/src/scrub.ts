/**
 * Strips personal data from an error event before it leaves the browser,
 * the Next server or the sync Worker (Sentry beforeSend). Shared by all
 * three so the rules cannot drift. No Sentry types: it works on the plain
 * event shape, field by field, and leaves everything else as it is.
 *
 * Removed: the user, request bodies, cookies, headers and query strings,
 * and console breadcrumbs (they can echo anything). Replaced wherever text
 * remains (messages, exception values, URLs, breadcrumb messages): email
 * addresses, JWT-like tokens (sync tokens), and share-link tokens.
 */

interface ScrubbableEvent {
  user?: unknown;
  message?: string;
  request?: { data?: unknown; cookies?: unknown; headers?: unknown; query_string?: unknown; url?: string };
  exception?: { values?: Array<{ value?: string }> };
  breadcrumbs?: Array<{ category?: string; message?: string; data?: Record<string, unknown> }>;
  extra?: unknown;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const JWT = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
// /s/<document id>/<link token>
const SHARE_LINK = /(\/s\/[0-9a-fA-F-]{36}\/)[^/?#\s"']+/g;

export function scrubText(text: string): string {
  return text.replace(JWT, "[token]").replace(EMAIL, "[email]").replace(SHARE_LINK, "$1[link-token]");
}

function scrubUrl(url: string): string {
  return scrubText(url.split("?")[0].split("#")[0]);
}

export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  delete event.user;
  delete event.extra;
  if (event.message) event.message = scrubText(event.message);
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.headers;
    delete event.request.query_string;
    if (event.request.url) event.request.url = scrubUrl(event.request.url);
  }
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = scrubText(exception.value);
  }
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs
      .filter((crumb) => crumb.category !== "console")
      .map((crumb) => {
        const data = crumb.data ? { ...crumb.data } : undefined;
        if (data) {
          for (const key of ["url", "from", "to"]) {
            if (typeof data[key] === "string") data[key] = scrubUrl(data[key] as string);
          }
          delete data.body;
          delete data.request_body_size;
          delete data.response_body_size;
        }
        return { ...crumb, message: crumb.message ? scrubText(crumb.message) : crumb.message, data };
      });
  }
  return event;
}
