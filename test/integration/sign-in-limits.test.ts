import { like } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { rateLimit } from "@/db/auth-schema";
import { appRateLimits } from "@/db/schema";

const BASE = "http://localhost:3100";

// Each test builds a fresh auth instance; the first import is slow.
vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => {
  process.env.BETTER_AUTH_URL = BASE;
  process.env.BETTER_AUTH_SECRET ??= "integration-test-secret-integration-test";
  process.env.EMAIL_TRANSPORT = "file";
  delete process.env.AUTH_CLIENT_IP_HEADER;
});

afterEach(() => {
  delete process.env.AUTH_CLIENT_IP_HEADER;
});

/** A fresh auth instance that reads the environment as it is now. */
async function loadAuth() {
  vi.resetModules();
  return (await import("@/server/auth")).auth;
}

function requestLink(auth: Awaited<ReturnType<typeof loadAuth>>, email: string, forwardedFor: string) {
  return auth.handler(
    new Request(`${BASE}/api/auth/sign-in/magic-link`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE, "x-forwarded-for": forwardedFor },
      body: JSON.stringify({ email, callbackURL: "/" }),
    }),
  );
}

const uniqueEmail = (name: string) => `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.test`;
const randomAddress = () => `203.0.113.${Math.floor(Math.random() * 250) + 1}`;

async function bucketsFor(address: string) {
  return db().select().from(rateLimit).where(like(rateLimit.key, `${address}|%`));
}

describe("client address", () => {
  it("ignores a forged X-Forwarded-For when no header is trusted", async () => {
    const auth = await loadAuth();
    const forged = randomAddress();
    expect((await requestLink(auth, uniqueEmail("forged"), forged)).status).toBe(200);
    expect(await bucketsFor(forged)).toEqual([]);
  });

  it("uses the configured header behind a trusted proxy", async () => {
    process.env.AUTH_CLIENT_IP_HEADER = "x-forwarded-for";
    const auth = await loadAuth();
    const address = randomAddress();
    expect((await requestLink(auth, uniqueEmail("proxied"), address)).status).toBe(200);
    expect(await bucketsFor(address)).toHaveLength(1);
  });
});

describe("sign-in link limits", () => {
  it("limits links per email address, whatever address the request claims", async () => {
    const auth = await loadAuth();
    const email = uniqueEmail("flood");
    for (let i = 0; i < 5; i++) expect((await requestLink(auth, email, randomAddress())).status).toBe(200);
    expect((await requestLink(auth, email, randomAddress())).status).toBe(429);
    // Another case is the same address.
    expect((await requestLink(auth, email.toUpperCase(), randomAddress())).status).toBe(429);
  });

  it("caps links site wide", async () => {
    const auth = await loadAuth();
    await db()
      .insert(appRateLimits)
      .values({ key: "magicLinkSiteWide:all", windowStart: new Date(), count: 300 })
      .onConflictDoUpdate({ target: appRateLimits.key, set: { windowStart: new Date(), count: 300 } });
    try {
      expect((await requestLink(auth, uniqueEmail("capped"), randomAddress())).status).toBe(429);
    } finally {
      await db().delete(appRateLimits).where(like(appRateLimits.key, "magicLinkSiteWide:%"));
    }
  });
});
