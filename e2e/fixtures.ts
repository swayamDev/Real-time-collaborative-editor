import { test as base } from "@playwright/test";
import { ensureSyncServer } from "./sync-server";

export { expect } from "@playwright/test";

/**
 * Every test starts with a healthy sync server. Global setup starts one, but
 * a test may stop it, and Playwright restarts its worker process (and with
 * it any server that worker spawned) after a failure.
 */
export const test = base.extend<{ syncServer: void }>({
  syncServer: [
    async ({}, use) => {
      await ensureSyncServer();
      await use();
    },
    { auto: true, timeout: 90_000 },
  ],
});
