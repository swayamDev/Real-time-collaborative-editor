import { isDocumentId, schemaFromSubprotocols, scrubEvent, tokenFromSubprotocols, verifySyncToken } from "@brahma/protocol";
import * as Sentry from "@sentry/cloudflare";
import { identityFromClaims, publicKeys, withoutIdentityHeaders, writeIdentity } from "./identity";
import { logEvent } from "./log";
import { bearerToken, secretMatches } from "./secret";

import { DocumentRoom as Room } from "./room";

/**
 * Errors only, no personal data (scrubEvent, shared with the app), and
 * nothing at all without SENTRY_DSN (development and tests).
 */
function sentryOptions(env: Env) {
  return { dsn: env.SENTRY_DSN, enabled: Boolean(env.SENTRY_DSN), sendDefaultPii: false, tracesSampleRate: 0, beforeSend: scrubEvent };
}

export const DocumentRoom = Sentry.instrumentDurableObjectWithSentry(sentryOptions, Room);

function originAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  // Non-browser clients send no Origin. Browsers always do, so this still
  // stops other websites from opening sockets with a visitor's browser.
  if (origin === null) return true;
  return env.ALLOWED_ORIGINS.split(",").map((value) => value.trim()).includes(origin);
}

/** Refuse a request before any Durable Object, and log why. */
function refused(status: number, reason: string): Response {
  logEvent("request_refused", { status, reason });
  return new Response(reason, { status });
}

function roomFor(env: Env, documentId: string): DurableObjectStub {
  return env.DOCUMENT_ROOM.get(env.DOCUMENT_ROOM.idFromName(documentId.toLowerCase()));
}

export default Sentry.withSentry(sentryOptions, {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") return new Response("ok");

    const socket = /^\/documents\/([^/]+)$/.exec(url.pathname);
    if (socket) {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return refused(426, "Expected a WebSocket upgrade");
      }
      // Validate before a Durable Object is ever created for this id.
      if (!isDocumentId(socket[1])) return refused(400, "Invalid document id");
      if (!originAllowed(request, env)) return refused(403, "Origin not allowed");

      // Authenticate before a Durable Object is ever touched. The token
      // travels in the subprotocol header, so it stays out of URLs and logs.
      const offered = request.headers.get("Sec-WebSocket-Protocol");
      const token = tokenFromSubprotocols(offered);
      if (!token) return refused(401, "Missing sync token");
      let identity;
      try {
        identity = identityFromClaims(await verifySyncToken(token, publicKeys(env), socket[1]), schemaFromSubprotocols(offered));
      } catch {
        return refused(401, "Invalid sync token");
      }
      const headers = withoutIdentityHeaders(request.headers);
      writeIdentity(headers, identity);
      return roomFor(env, socket[1]).fetch(new Request(request.url, { method: "GET", headers }));
    }

    // Called by the Next app for rename and delete from the sidebar.
    const internal = /^\/internal\/documents\/([^/]+)(\/title|\/access)?$/.exec(url.pathname);
    if (internal) {
      if (!(await secretMatches(bearerToken(request), env.SYNC_INTERNAL_SECRET))) {
        return refused(401, "Unauthorized");
      }
      if (!isDocumentId(internal[1])) return refused(400, "Invalid document id");
      const expected = internal[2] ? "POST" : "DELETE";
      if (request.method !== expected) {
        return refused(405, "Method not allowed");
      }
      return roomFor(env, internal[1]).fetch(request);
    }

    return refused(404, "Not found");
  },
} satisfies ExportedHandler<Env>);
