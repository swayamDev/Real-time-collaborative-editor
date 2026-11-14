/**
 * Who may do what. One pure function, used by every server action, page and
 * route, and mirrored in the interface. The sync server enforces the
 * editing rules again on its side.
 */

export type Role = "owner" | "editor" | "viewer";

export type Action =
  | "view"
  | "edit"
  | "rename"
  | "delete"
  | "share"
  | "changeRoles";

const ALLOWED: Record<Action, readonly Role[]> = {
  /** Open the document, receive live edits, see presence. */
  view: ["owner", "editor", "viewer"],
  /** Change the body (the title is "rename"). */
  edit: ["owner", "editor"],
  rename: ["owner", "editor"],
  delete: ["owner"],
  /** Invite people, manage the share link. */
  share: ["owner"],
  /** Change or remove other people's access. */
  changeRoles: ["owner"],
};

export const ACTIONS = Object.keys(ALLOWED) as Action[];
export const ROLES: readonly Role[] = ["owner", "editor", "viewer"];

export function can(role: Role | null, action: Action): boolean {
  return role !== null && ALLOWED[action].includes(role);
}

/** Roles that can write to the document over the sync socket. */
export function canWrite(role: Role | null): boolean {
  return can(role, "edit");
}
