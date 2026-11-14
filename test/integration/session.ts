import type { CurrentUser } from "@/server/session";

/** The user the mocked session returns; null means signed out. */
export const session: { current: CurrentUser | null } = { current: null };
