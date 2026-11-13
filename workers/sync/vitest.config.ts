import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          // In-memory snapshot store instead of Postgres.
          DATABASE_URL: "memory:",
          SYNC_INTERNAL_SECRET: "test-secret",
        },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
  },
});
