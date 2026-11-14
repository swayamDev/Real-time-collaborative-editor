import { describe, expect, it } from "vitest";
import { type CloseAction, type CloseContext, RECONNECTING_ACTIONS, closeAction } from "./close-policy";

const fresh: CloseContext = { refreshedSinceLastSync: false, viewer: false, isolating: false, unackedEntries: 0 };
const ctx = (patch: Partial<CloseContext> = {}): CloseContext => ({ ...fresh, ...patch });

describe("closeAction: one row per code", () => {
  const rows: Array<[string, number, Partial<CloseContext>, CloseAction]> = [
    ["4401 refreshes the token and reconnects", 4401, {}, "refresh-token"],
    ["4401 again before any sync ends the session", 4401, { refreshedSinceLastSync: true }, "session-ended"],
    ["4403 runs revoke handling", 4403, {}, "revoked"],
    ["4403 as a viewer is still revoked", 4403, { viewer: true }, "revoked"],
    ["4405 as an editor runs downgrade handling", 4405, {}, "downgraded"],
    ["4405 as a viewer halts instead of looping", 4405, { viewer: true }, "halt"],
    ["4410 runs deleted handling", 4410, {}, "deleted"],
    ["4426 updates and reloads instead of reconnecting", 4426, {}, "outdated"],
    ["4426 with edits in flight still does not reconnect", 4426, { unackedEntries: 3 }, "outdated"],
    ["4427 (schema newer than the deployment accepts) halts, no reload", 4427, {}, "halt"],
    ["4404 is not found", 4404, {}, "not-found"],
    ["4400 is not found", 4400, {}, "not-found"],
    ["1007 with a batch of edits isolates once", 1007, { unackedEntries: 3 }, "isolate"],
    ["1007 while isolating halts", 1007, { unackedEntries: 1, isolating: true }, "halt"],
    ["1007 with a single edit halts", 1007, { unackedEntries: 1 }, "halt"],
    ["1007 with no edits in flight halts", 1007, {}, "halt"],
    ["1009 with a batch of edits isolates once", 1009, { unackedEntries: 2 }, "isolate"],
    ["1009 while isolating halts", 1009, { unackedEntries: 5, isolating: true }, "halt"],
    ["1009 with no edits in flight halts", 1009, {}, "halt"],
    ["1008 halts", 1008, { unackedEntries: 4 }, "halt"],
    ["1006 (dropped) reconnects with backoff", 1006, {}, "reconnect"],
    ["1001 (server going away) reconnects with backoff", 1001, {}, "reconnect"],
    ["1011 (server error) reconnects with backoff", 1011, {}, "reconnect"],
    ["1000 reconnects with backoff", 1000, {}, "reconnect"],
    ["an unknown application code halts", 4499, {}, "halt"],
  ];

  it.each(rows)("%s", (_label, code, patch, expected) => {
    expect(closeAction(code, ctx(patch))).toBe(expected);
  });
});

describe("closeAction: no reconnect loops", () => {
  const allContexts: CloseContext[] = [];
  for (const refreshedSinceLastSync of [false, true])
    for (const viewer of [false, true])
      for (const isolating of [false, true])
        for (const unackedEntries of [0, 1, 5]) allContexts.push({ refreshedSinceLastSync, viewer, isolating, unackedEntries });

  it("refresh-token never repeats without a sync in between", () => {
    for (const context of allContexts) {
      if (context.refreshedSinceLastSync) expect(closeAction(4401, context)).toBe("session-ended");
    }
  });

  it("isolation is tried at most once per failure", () => {
    for (const code of [1007, 1009]) {
      for (const context of allContexts) {
        if (context.isolating) expect(closeAction(code, context)).toBe("halt");
      }
    }
  });

  it("downgrade handling cannot repeat once the socket is a viewer", () => {
    for (const context of allContexts) {
      if (context.viewer) expect(closeAction(4405, context)).toBe("halt");
    }
  });

  it("every application code (4000 to 4999) stops, apart from the bounded token refresh", () => {
    for (let code = 4000; code <= 4999; code++) {
      for (const context of allContexts) {
        const action = closeAction(code, context);
        if (code === 4426) expect(action).toBe("outdated");
        if (RECONNECTING_ACTIONS.has(action)) {
          expect(code).toBe(4401);
          expect(action).toBe("refresh-token");
          expect(context.refreshedSinceLastSync).toBe(false);
        }
      }
    }
  });
});
