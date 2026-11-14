import { like } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { rateLimit } from "@/db/auth-schema";
import { appRateLimits } from "@/db/schema";

const BASE = "http://localhost:3100";

/** What the mocked Resend API answers next. */
const resendAnswer: { error: { name: string; message: string; statusCode: number | null } | null } = { error: null };
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: async () => ({ data: null, error: resendAnswer.error }) };
  },
}));

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
  resendAnswer.error = null;
  vi.restoreAllMocks();
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
      .values({ key: "magicLinkSiteWide:all", windowStart: new Date(), count: 80 })
      .onConflictDoUpdate({ target: appRateLimits.key, set: { windowStart: new Date(), count: 80 } });
    try {
      expect((await requestLink(auth, uniqueEmail("capped"), randomAddress())).status).toBe(429);
    } finally {
      await db().delete(appRateLimits).where(like(appRateLimits.key, "magicLinkSiteWide:%"));
    }
  });
});

describe("the email provider's quota", () => {
  const quotaError = { name: "daily_quota_exceeded", message: "You have reached your daily email sending quota.", statusCode: 429 };

  it("tells quota refusals apart from other failures, and logs them", async () => {
    const { EmailQuotaError, sendWithResend } = await import("@/server/email");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = (error: typeof quotaError | null) => ({ emails: { send: async () => ({ error }) } });
    const email = { to: "a@example.test", subject: "s", text: "t" };

    await expect(sendWithResend(client(quotaError), "from@example.test", email)).rejects.toBeInstanceOf(EmailQuotaError);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("daily_quota_exceeded"));
    await expect(
      sendWithResend(client({ name: "validation_error", message: "bad", statusCode: 422 }), "from@example.test", email),
    ).rejects.not.toBeInstanceOf(EmailQuotaError);
  });

  it("answers a sign-in request with 429, which the form shows as Too many attempts", async () => {
    process.env.EMAIL_TRANSPORT = "resend";
    process.env.RESEND_API_KEY = "re_test";
    process.env.EMAIL_FROM = "Brahma <signin@example.test>";
    resendAnswer.error = quotaError;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const auth = await loadAuth();
      const response = await requestLink(auth, uniqueEmail("quota"), randomAddress());
      expect(response.status).toBe(429);
      expect(errors).toHaveBeenCalledWith(expect.stringContaining("daily_quota_exceeded"));
    } finally {
      delete process.env.RESEND_API_KEY;
      delete process.env.EMAIL_FROM;
    }
  });
});
