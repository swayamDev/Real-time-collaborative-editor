import "client-only";

/** WebSocket URL for a document on the sync server. */
export function syncUrl(documentId: string): string {
  const base = (process.env.NEXT_PUBLIC_SYNC_URL ?? "ws://localhost:8787").replace(/\/$/, "");
  return `${base}/documents/${documentId}`;
}
