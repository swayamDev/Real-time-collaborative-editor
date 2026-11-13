import { defineConfig, devices } from "@playwright/test";
import { SYNC_PORT, SYNC_SECRET, databaseUrl } from "./e2e/sync-server";

const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  // Tests share one database and one sync server, so run them one at a time.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  // Starts `wrangler dev` for the sync Worker; tests may restart it.
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    // CI builds in a separate step with the same NEXT_PUBLIC_SYNC_URL.
    command: process.env.CI ? `pnpm start --port ${PORT}` : `pnpm build && pnpm start --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      DATABASE_URL: databaseUrl(),
      NEXT_PUBLIC_SYNC_URL: `ws://localhost:${SYNC_PORT}`,
      SYNC_INTERNAL_URL: `http://localhost:${SYNC_PORT}`,
      SYNC_INTERNAL_SECRET: SYNC_SECRET,
    },
  },
});
