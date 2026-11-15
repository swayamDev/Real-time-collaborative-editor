import "client-only";
import type { Role } from "../permissions";

/**
 * What one tab learned from the server about a document: a role change
 * (null means access was removed), or that the document was deleted.
 */
export type AccessNotice = { docId: string; role: Role | null } | { docId: string; deleted: true };

const ROLES: ReadonlyArray<Role | null> = ["owner", "editor", "viewer", null];

function isNotice(value: unknown): value is AccessNotice {
  if (typeof value !== "object" || value === null) return false;
  const notice = value as Record<string, unknown>;
  if (typeof notice.docId !== "string") return false;
  if ("deleted" in notice) return notice.deleted === true;
  return ROLES.includes(notice.role as Role | null);
}

/**
 * Tells this user's other tabs about role changes and deletions, so a tab
 * that missed the server's message (asleep, offline, or connected through
 * another socket) cannot keep editing. A tab trusts a notice that lowers its access at once;
 * for one that raises it, it asks the server first.
 */
export class AccessChannel {
  private readonly channel: BroadcastChannel | null;

  constructor(userId: string, onNotice: (notice: AccessNotice) => void) {
    this.channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(`brahma-access:${userId}`);
    if (this.channel) {
      this.channel.onmessage = (event: MessageEvent<unknown>) => {
        if (isNotice(event.data)) onNotice(event.data);
      };
    }
  }

  post(notice: AccessNotice): void {
    this.channel?.postMessage(notice);
  }

  close(): void {
    this.channel?.close();
  }
}

const RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 };

/** Whether `next` gives less access than `current` (null is no access). */
export function isLowerAccess(current: Role, next: Role | null): boolean {
  return next === null || RANK[next] < RANK[current];
}
