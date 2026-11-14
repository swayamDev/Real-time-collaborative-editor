import { describe, expect, it } from "vitest";
import { ACTIONS, type Action, ROLES, type Role, can, canWrite } from "./permissions";

/** The whole matrix, written out so a change to it is a visible diff. */
const EXPECTED: Record<Role, Record<Action, boolean>> = {
  owner: { view: true, edit: true, rename: true, delete: true, share: true, changeRoles: true },
  editor: { view: true, edit: true, rename: true, delete: false, share: false, changeRoles: false },
  viewer: { view: true, edit: false, rename: false, delete: false, share: false, changeRoles: false },
};

describe("can", () => {
  for (const role of ROLES) {
    for (const action of ACTIONS) {
      it(`${role} ${EXPECTED[role][action] ? "may" : "may not"} ${action}`, () => {
        expect(can(role, action)).toBe(EXPECTED[role][action]);
      });
    }
  }

  it("denies everything without a role", () => {
    for (const action of ACTIONS) expect(can(null, action)).toBe(false);
  });

  it("only owners and editors write over the sync socket", () => {
    expect(ROLES.filter(canWrite)).toEqual(["owner", "editor"]);
    expect(canWrite(null)).toBe(false);
  });
});
