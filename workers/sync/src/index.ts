import { isDocumentId } from "@brahma/protocol";
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
      return roomFor(env, socket[1]).fetch(request);
    }

    // Called by the Next app for rename and delete from the sidebar.
    const internal = /^\/internal\/documents\/([^/]+)(\/title)?$/.exec(url.pathname);
    if (internal) {
      if (!(await secretMatches(bearerToken(request), env.SYNC_INTERNAL_SECRET))) {
        return new Response("Unauthorized", { status: 401 });
      }
      if (!isDocumentId(internal[1])) return new Response("Invalid document id", { status: 400 });
      const isTitle = internal[2] === "/title";
      if ((isTitle && request.method !== "POST") || (!isTitle && request.method !== "DELETE")) {
        return new Response("Method not allowed", { status: 405 });
      }
      return roomFor(env, internal[1]).fetch(request);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
