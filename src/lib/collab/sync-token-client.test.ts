import { describe, expect, it } from "vitest";
import { fetchSyncToken } from "./sync-token-client";

const answer = (status: number, body: unknown = {}) => (async () =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;

describe("fetchSyncToken", () => {
  it("returns the token, role and lifetime", async () => {
    const result = await fetchSyncToken("d", answer(200, { token: "a.b.c", role: "viewer", expiresIn: 600 }));
    expect(result).toEqual({ kind: "ok", token: "a.b.c", role: "viewer", expiresIn: 600 });
  });

  it.each([
    [401, "signed-out"],
    [404, "no-access"],
    [410, "deleted"],
    [429, "unavailable"],
    [403, "unavailable"],
    [500, "unavailable"],
  ])("maps %i to %s", async (status, kind) => {
    expect((await fetchSyncToken("d", answer(status))).kind).toBe(kind);
  });

  it("treats a network failure or a malformed body as unavailable", async () => {
    const offline = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    expect((await fetchSyncToken("d", offline)).kind).toBe("unavailable");
    expect((await fetchSyncToken("d", answer(200, { token: 1, role: "viewer", expiresIn: 600 }))).kind).toBe("unavailable");
    expect((await fetchSyncToken("d", answer(200, { token: "t", role: "admin", expiresIn: 600 }))).kind).toBe("unavailable");
  });
});
