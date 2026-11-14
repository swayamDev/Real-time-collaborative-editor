import { describe, expect, it } from "vitest";
import { RELOAD_WINDOW_MS, type ReloadEnvironment, reloadForUpdate } from "./update-reload";

function environment(now = 1_000_000) {
  const store = new Map<string, string>();
  const calls: string[] = [];
  const value: ReloadEnvironment & { clock: number } = {
    clock: now,
    now: () => value.clock,
    storage: { getItem: (key) => store.get(key) ?? null, setItem: (key, item) => void store.set(key, item) },
    updateServiceWorker: async () => void calls.push("update-worker"),
    reload: () => void calls.push("reload"),
  };
  return { value, calls };
}

describe("reloadForUpdate", () => {
  it("writes queued edits to the device, updates the service worker, then reloads", async () => {
    const { value, calls } = environment();
    const result = await reloadForUpdate(async () => void calls.push("device-written"), value);
    expect(result).toBe("reloading");
    expect(calls).toEqual(["device-written", "update-worker", "reload"]);
  });

  it("does not reload again if the reload did not help, so it can never loop", async () => {
    const { value, calls } = environment();
    await reloadForUpdate(async () => {}, value);
    calls.length = 0;
    value.clock += 5_000;
    expect(await reloadForUpdate(async () => {}, value)).toBe("already-tried");
    expect(calls).toEqual([]);
  });

  it("tries again after the window, for a later update", async () => {
    const { value, calls } = environment();
    await reloadForUpdate(async () => {}, value);
    value.clock += RELOAD_WINDOW_MS + 1;
    calls.length = 0;
    expect(await reloadForUpdate(async () => {}, value)).toBe("reloading");
    expect(calls).toContain("reload");
  });

  it("still reloads when the service worker cannot update", async () => {
    const { value, calls } = environment();
    value.updateServiceWorker = async () => {
      throw new Error("offline");
    };
    expect(await reloadForUpdate(async () => {}, value)).toBe("reloading");
    expect(calls).toEqual(["reload"]);
  });
});
