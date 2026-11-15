import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { checkProductionEnvironment, mustPassPreflight } from "./preflight";

function productionKey(kid = "prod-20261115"): string {
  const { privateKey } = generateKeyPairSync("ed25519");
  return JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid });
}

/** A complete, valid production environment (values are made up for the test). */
function production(): Record<string, string> {
  return {
    VERCEL: "1",
    VERCEL_ENV: "production",
    DATABASE_URL: "postgres://app:pw@ep-calm-sea-123456-pooler.ap-southeast-1.aws.neon.tech/brahma?sslmode=require",
    BETTER_AUTH_SECRET: "Zm9vYmFyYmF6cXV4cXV1eGNvcmdlZ3JhdWx0Z2FycGx5",
    BETTER_AUTH_URL: "https://editor.swayam.space",
    GOOGLE_CLIENT_ID: "client-id.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: "client-secret",
    EMAIL_TRANSPORT: "resend",
    RESEND_API_KEY: "re_live_key",
    EMAIL_FROM: "Brahma <signin@editor.swayam.space>",
    SYNC_TOKEN_PRIVATE_KEY: productionKey(),
    SYNC_INTERNAL_URL: "https://brahma-sync.someone.workers.dev",
    SYNC_INTERNAL_SECRET: "c3luYy1pbnRlcm5hbC1zZWNyZXQtYmFzZTY0LXZhbHVl",
    NEXT_PUBLIC_SYNC_URL: "wss://brahma-sync.someone.workers.dev",
    NEXT_PUBLIC_SENTRY_DSN: "https://key@o0.ingest.sentry.io/0",
    AUTH_CLIENT_IP_HEADER: "x-forwarded-for",
  };
}

const problemsWith = (patch: Record<string, string | undefined>) => checkProductionEnvironment({ ...production(), ...patch });

describe("production preflight", () => {
  it("accepts a complete production environment", () => {
    expect(checkProductionEnvironment(production())).toEqual([]);
  });

  it("names every missing variable at once", () => {
    const problems = checkProductionEnvironment({ VERCEL: "1" });
    for (const name of ["DATABASE_URL", "BETTER_AUTH_SECRET", "RESEND_API_KEY", "SYNC_TOKEN_PRIVATE_KEY", "NEXT_PUBLIC_SYNC_URL"]) {
      expect(problems).toContain(`${name} is not set.`);
    }
  });

  it.each([
    ["console email", { EMAIL_TRANSPORT: "console" }, /EMAIL_TRANSPORT/],
    ["file email", { EMAIL_TRANSPORT: "file" }, /EMAIL_TRANSPORT/],
    ["test hooks", { NEXT_PUBLIC_E2E_HOOKS: "1" }, /test-only/],
    ["no trusted address header on Vercel", { AUTH_CLIENT_IP_HEADER: undefined }, /AUTH_CLIENT_IP_HEADER/],
    ["the wrong app URL", { BETTER_AUTH_URL: "https://brahma.swayam.space" }, /BETTER_AUTH_URL/],
    ["an http app URL", { BETTER_AUTH_URL: "http://editor.swayam.space" }, /BETTER_AUTH_URL/],
    ["a short secret", { BETTER_AUTH_SECRET: "short" }, /at least 32/],
    ["the example secret", { SYNC_INTERNAL_SECRET: "change-me-local-only-change-me-local-only" }, /placeholder/],
    ["a dev or CI sync key", { SYNC_TOKEN_PRIVATE_KEY: productionKey("e2e") }, /production key/],
    ["a local database", { DATABASE_URL: "postgres://brahma:brahma@localhost:5432/brahma?sslmode=require" }, /local database/],
    ["the direct (unpooled) database", { DATABASE_URL: "postgres://a:b@ep-calm-sea-123456.ap-southeast-1.aws.neon.tech/brahma?sslmode=require" }, /pooled/],
    ["no TLS to the database", { DATABASE_URL: "postgres://a:b@ep-x-pooler.aws.neon.tech/brahma" }, /sslmode/],
    ["a local sync server", { NEXT_PUBLIC_SYNC_URL: "ws://localhost:8787" }, /wss/],
    ["sync URLs on different hosts", { SYNC_INTERNAL_URL: "https://other.workers.dev" }, /same sync server/],
    ["another sending domain", { EMAIL_FROM: "Brahma <signin@example.com>" }, /editor\.swayam\.space/],
    ["a link limit above the email quota", { MAGIC_LINK_DAILY_LIMIT: "500" }, /quota/],
  ])("refuses %s", (_label, patch, message) => {
    expect(problemsWith(patch).join("\n")).toMatch(message);
  });

  it("runs on every Vercel build and server, previews included, or when asked", () => {
    expect(mustPassPreflight({ VERCEL: "1", VERCEL_ENV: "preview" })).toBe(true);
    expect(mustPassPreflight({ BRAHMA_PREFLIGHT: "1" })).toBe(true);
    expect(mustPassPreflight({})).toBe(false);
  });

  it("refuses this repository's development settings", () => {
    const development = {
      VERCEL: "1",
      DATABASE_URL: "postgres://brahma:brahma@localhost:5432/brahma",
      BETTER_AUTH_SECRET: "change-me-local-only-change-me-local-only",
      BETTER_AUTH_URL: "http://localhost:3000",
      EMAIL_TRANSPORT: "console",
      SYNC_INTERNAL_SECRET: "change-me-local-only",
      NEXT_PUBLIC_SYNC_URL: "ws://localhost:8787",
      SYNC_INTERNAL_URL: "http://localhost:8787",
    };
    expect(checkProductionEnvironment(development).length).toBeGreaterThan(8);
  });
});
