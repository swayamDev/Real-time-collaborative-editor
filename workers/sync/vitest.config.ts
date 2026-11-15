import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { generateTestKeys } from "./test/generate-keys.ts";

// A fresh key pair for every run, so the repo never holds a private key.
const keys = await generateTestKeys();

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          // In-memory snapshot store instead of Postgres.
          DATABASE_URL: "memory:",
          SYNC_INTERNAL_SECRET: "test-secret",
          SYNC_TOKEN_PUBLIC_KEYS: keys.publicKeys,
          // Test only: lets the tests sign tokens the Worker accepts.
          TEST_SIGNING_KEY: keys.privateJwk,
          // Tests check expiry without waiting a minute.
          TOKEN_GRACE_SECONDS: "0",
          // Room tests use schema versions 1 to 5.
          SCHEMA_VERSION_MIN: "1",
          SCHEMA_VERSION_MAX: "5",
        },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
  },
});
