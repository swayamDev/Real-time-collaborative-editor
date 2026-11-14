import { like } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { appRateLimits } from "@/db/schema";

const BASE = "http://localhost:3100";
vi.setConfig({ testTimeout: 30_000 });

let auth: (typeof import("@/server/auth"))["auth"];
beforeAll(async () => {
  process.env.BETTER_AUTH_URL = BASE;
  process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-integration-test";
  process.env.EMAIL_TRANSPORT = "file";
  vi.resetModules();
  auth = (await import("@/server/auth")).auth;
});

// The site-wide link count is shared with other runs (end-to-end tests send many).
beforeEach(async () => {
  await db().delete(appRateLimits).where(like(appRateLimits.key, "magicLinkSiteWide:%"));
});

function post(path: string, headers: Record<string, string>, body: unknown = {}) {
  return auth.handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "better-auth.session_token=x", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

const email = () => `origin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`;

describe("auth endpoints refuse other origins (CSRF)", () => {
  it("refuses a sign-in link request from another site", async () => {
    const response = await post("/sign-in/magic-link", { origin: "https://evil.example" }, { email: email(), callbackURL: "/" });
    expect(response.status).toBe(403);
  });

  it("refuses sign-out from another site", async () => {
    expect((await post("/sign-out", { origin: "https://evil.example" })).status).toBe(403);
  });

  it("refuses a redirect to another site after sign-in", async () => {
    const response = await post("/sign-in/magic-link", { origin: BASE }, { email: email(), callbackURL: "https://evil.example/" });
    expect(response.status).toBe(403);
  });

  it("accepts the app's own origin", async () => {
    const response = await post("/sign-in/magic-link", { origin: BASE }, { email: email(), callbackURL: "/d/x" });
    expect(response.status).toBe(200);
  });
});
