import { isDocumentId, schemaFromSubprotocols, tokenFromSubprotocols, verifySyncToken } from "@brahma/protocol";
import { identityFromClaims, publicKeys, withoutIdentityHeaders, writeIdentity } from "./identity";
import { bearerToken, secretMatches } from "./secret";

export { DocumentRoom } from "./room";

function originAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get("Origin");
  // Non-browser clients send no Origin. Browsers always do, so this still
  // stops other websites from opening sockets with a visitor's browser.
  if (origin === null) return true;
  return env.ALLOWED_ORIGINS.split(",").map((value) => value.trim()).includes(origin);
}

function roomFor(env: Env, documentId: string): DurableObjectStub {
  return env.DOCUMENT_ROOM.get(env.DOCUMENT_ROOM.idFromName(documentId.toLowerCase()));
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") return new Response("ok");

    const socket = /^\/documents\/([^/]+)$/.exec(url.pathname);
    if (socket) {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return new Response("Expected a WebSocket upgrade", { status: 426 });
      }
      // Validate before a Durable Object is ever created for this id.
      if (!isDocumentId(socket[1])) return new Response("Invalid document id", { status: 400 });
      if (!originAllowed(request, env)) return new Response("Origin not allowed", { status: 403 });

      // Authenticate before a Durable Object is ever touched. The token
      // travels in the subprotocol header, so it stays out of URLs and logs.
      const offered = request.headers.get("Sec-WebSocket-Protocol");
      const token = tokenFromSubprotocols(offered);
      if (!token) return new Response("Missing sync token", { status: 401 });
      let identity;
      try {
        identity = identityFromClaims(await verifySyncToken(token, publicKeys(env), socket[1]), schemaFromSubprotocols(offered));
      } catch {
        return new Response("Invalid sync token", { status: 401 });
      }
      const headers = withoutIdentityHeaders(request.headers);
      writeIdentity(headers, identity);
      return roomFor(env, socket[1]).fetch(new Request(request.url, { method: "GET", headers }));
    }

    // Called by the Next app for rename and delete from the sidebar.
    const internal = /^\/internal\/documents\/([^/]+)(\/title|\/access)?$/.exec(url.pathname);
    if (internal) {
      if (!(await secretMatches(bearerToken(request), env.SYNC_INTERNAL_SECRET))) {
        return new Response("Unauthorized", { status: 401 });
      }
      if (!isDocumentId(internal[1])) return new Response("Invalid document id", { status: 400 });
      const expected = internal[2] ? "POST" : "DELETE";
      if (request.method !== expected) {
        return new Response("Method not allowed", { status: 405 });
      }
      return roomFor(env, internal[1]).fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
