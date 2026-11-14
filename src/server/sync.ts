import "server-only";
import { after } from "next/server";

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

async function call(path: string, init: RequestInit, timeoutMs = TIMEOUT_MS): Promise<Response> {
  const { url, secret } = config();
  let response: Response;
  try {
    response = await fetch(`${url}/internal/documents/${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
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
 * Deliver access changes after the response is sent, so the owner's action
 * never waits on the sync server or its retries. Two quick changes may be
 * delivered in either order; the room keeps the one with the higher access
 * version.
 */
export function scheduleAccessChanges(documentId: string, changes: SyncAccessChange[]): void {
  if (changes.length === 0) return;
  after(async () => {
    await applyAccessChanges(documentId, changes);
  });
}

/** Waits before each retry of an access change. Three attempts in all. */
export const ACCESS_RETRY_DELAYS_MS = [300, 1_000];
const ACCESS_TIMEOUT_MS = 2_000;

function retryable(error: unknown): boolean {
  if (!(error instanceof SyncRequestError)) return false;
  // Unreachable, timed out, overloaded or failing: worth another try. Any
  // other 4xx (bad secret, bad body) will not fix itself.
  return error.status === null || error.status === 429 || error.status >= 500;
}

/**
 * Tell the sync server about access changes so open sockets are downgraded
 * or closed at once. Retried, and never throws: the change is already
 * stored in Postgres. If every attempt fails, an open socket keeps its old
 * role until its token is refreshed (the new token carries the new access
 * version and role) or expires: at most one token lifetime plus the grace
 * period.
 */
export async function applyAccessChanges(
  documentId: string,
  changes: SyncAccessChange[],
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<boolean> {
  if (changes.length === 0) return true;
  const body = JSON.stringify({ changes });
  for (let attempt = 0; ; attempt++) {
    try {
      await call(`${documentId}/access`, { method: "POST", body }, ACCESS_TIMEOUT_MS);
      return true;
    } catch (error) {
      const delay = ACCESS_RETRY_DELAYS_MS[attempt];
      if (delay === undefined || !retryable(error)) {
        console.error(`Access change for ${documentId} not delivered to the sync server`, error);
        return false;
      }
      await sleep(delay);
    }
  }
}
