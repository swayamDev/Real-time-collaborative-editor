import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyAccessChanges } from "@/server/sync";

const change = { userId: "user-1", role: "viewer" as const, accessVersion: 3 };
const noSleep = async () => {};

let calls: Array<{ url: string; init: RequestInit }>;
function answer(...results: Array<number | "network">) {
  calls = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const result = results[Math.min(calls.length - 1, results.length - 1)];
    if (result === "network") throw new TypeError("fetch failed");
    return new Response(null, { status: result });
  });
}

beforeEach(() => {
  process.env.SYNC_INTERNAL_URL = "http://sync.test";
  process.env.SYNC_INTERNAL_SECRET = "secret";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("applyAccessChanges", () => {
  it("posts the changes to the room with the shared secret", async () => {
    answer(204);
    expect(await applyAccessChanges("doc-1", [change], noSleep)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://sync.test/internal/documents/doc-1/access");
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer secret");
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ changes: [change] });
  });

  it("retries when the sync server is unreachable or failing", async () => {
    answer("network", 503, 204);
    expect(await applyAccessChanges("doc-1", [change], noSleep)).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it("gives up after three attempts without throwing", async () => {
    answer(502);
    expect(await applyAccessChanges("doc-1", [change], noSleep)).toBe(false);
    expect(calls).toHaveLength(3);
    expect(console.error).toHaveBeenCalled();
  });

  it("does not retry a refusal that will not fix itself", async () => {
    answer(401);
    expect(await applyAccessChanges("doc-1", [change], noSleep)).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it("sends nothing when there are no changes", async () => {
    answer(204);
    expect(await applyAccessChanges("doc-1", [], noSleep)).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
