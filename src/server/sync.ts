import "server-only";

/**
 * Calls to the sync server's internal API. The Durable Object is the only
 * writer of a document's content and title, so rename and delete go
 * through it rather than straight to Postgres.
 */

const TIMEOUT_MS = 5_000;

export class SyncRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "SyncRequestError";
  }
}

function config(): { url: string; secret: string } {
  const url = process.env.SYNC_INTERNAL_URL;
  const secret = process.env.SYNC_INTERNAL_SECRET;
  if (!url || !secret) {
    throw new SyncRequestError("SYNC_INTERNAL_URL and SYNC_INTERNAL_SECRET must be set.", null);
  }
  return { url: url.replace(/\/$/, ""), secret };
}

async function call(path: string, init: RequestInit): Promise<Response> {
  const { url, secret } = config();
  let response: Response;
  try {
    response = await fetch(`${url}/internal/documents/${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    throw new SyncRequestError(`Sync server unreachable: ${String(error)}`, null);
  }
  if (!response.ok) throw new SyncRequestError(`Sync server returned ${response.status}`, response.status);
  return response;
}

/** Replace the shared title. Returns the title as stored (cleaned). */
export async function renameInSync(documentId: string, title: string): Promise<string> {
  const response = await call(`${documentId}/title`, { method: "POST", body: JSON.stringify({ title }) });
  const body = (await response.json()) as { title?: unknown };
  return typeof body.title === "string" ? body.title : title;
}

/** Close every open editor and erase the room's live state. */
export async function deleteInSync(documentId: string): Promise<void> {
  await call(documentId, { method: "DELETE" });
}

/** A change to one person's access, as the sync server applies it. */
export interface SyncAccessChange {
  userId: string;
  role: "editor" | "viewer" | null;
  accessVersion: number;
}

/**
 * Tell the sync server about access changes so open sockets are downgraded
 * or closed at once. Wired to the Worker in a later commit.
 */
export async function applyAccessChanges(documentId: string, changes: SyncAccessChange[]): Promise<void> {
  void documentId;
  void changes;
}
