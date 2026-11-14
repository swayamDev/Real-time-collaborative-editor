/**
 * Factories for vi.mock, shared by the integration tests. Each test file
 * calls vi.mock at its top level (so it is hoisted) with these.
 */
import { session } from "./session";

export const sessionModule = () => ({
  getCurrentUser: async () => session.current,
  requireUserOrRedirect: async () => {
    if (!session.current) throw new Error("redirect:/sign-in");
    return session.current;
  },
});

export const cacheModule = () => ({ revalidatePath: () => {} });

export const navigationModule = () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
});

/** The sync server's internal API, recorded instead of called. */
export const syncCalls: Array<{ call: string; args: unknown[] }> = [];

export const syncModule = () => ({
  SyncRequestError: class SyncRequestError extends Error {
    status: number | null = null;
  },
  renameInSync: async (...args: unknown[]) => {
    syncCalls.push({ call: "rename", args });
    return args[1];
  },
  deleteInSync: async (...args: unknown[]) => {
    syncCalls.push({ call: "delete", args });
  },
  scheduleAccessChanges: (documentId: string, changes: unknown[]) => {
    if (changes.length > 0) syncCalls.push({ call: "access", args: [documentId, changes] });
  },
});
