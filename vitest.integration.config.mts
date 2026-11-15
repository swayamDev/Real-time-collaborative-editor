import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { defineConfig } from "vitest/config";
import { missingIntegrationEnv } from "./test/integration/required-env";

config({ path: [".env.local", ".env"], quiet: true });

// Fail before any test runs, naming everything missing at once.
const missing = missingIntegrationEnv(process.env);
if (missing.length > 0) {
  throw new Error(
    `Integration tests need these environment variables: ${missing.join(", ")}. ` +
      "Set them in .env.local (see .env.example) or in the workflow.",
  );
}

/**
 * Server actions and authorization against a real Postgres (the local
 * container, or the CI service). Only the request context is faked.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // server-only throws outside a server bundle; the guard is irrelevant here.
      "server-only": fileURLToPath(new URL("./test/integration/empty-module.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["test/integration/**/*.test.ts"],
    // One database; files run one after another.
    fileParallelism: false,
  },
});
