/**
 * Document content is untrusted: any editor can send raw Yjs data that
 * never went through the editor UI. A link may only point to http, https
 * or mailto. Everything else (javascript:, data:, vbscript:, relative and
 * protocol-relative URLs) is refused wherever a link is rendered: in the
 * editor and in "Download a copy".
 */
const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

// Browsers ignore leading and trailing control characters and spaces, and
// tabs and newlines anywhere, when they parse a URL ("java\tscript:").
const IGNORED_BY_BROWSERS = /^[\u0000- ]+|[\u0000- ]+$|[\t\n\r]/g;

export function isSafeHref(href: unknown): href is string {
  if (typeof href !== "string" || href.length > 2048) return false;
  const cleaned = href.replace(IGNORED_BY_BROWSERS, "");
  if (cleaned === "") return false;
  try {
    // No base URL: relative and protocol-relative hrefs fail to parse.
    return ALLOWED_PROTOCOLS.has(new URL(cleaned).protocol);
  } catch {
    return false;
  }
}
