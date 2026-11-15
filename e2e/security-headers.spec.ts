import { signIn, uniqueEmail } from "./auth";
import { expect, test } from "./fixtures";
import { createDocument } from "./helpers";

const EXPECTED: Record<string, RegExp> = {
  "content-security-policy": /frame-ancestors 'none'.*base-uri 'self'.*form-action 'self'.*object-src 'none'/,
  "x-frame-options": /^DENY$/,
  "referrer-policy": /^same-origin$/,
  "x-content-type-options": /^nosniff$/,
  "cross-origin-opener-policy": /^same-origin$/,
  "permissions-policy": /camera=\(\).*microphone=\(\).*geolocation=\(\)/,
};

test("every kind of response carries the security headers", async ({ page }) => {
  await signIn(page, uniqueEmail("headers"));
  const documentId = await createDocument(page);
  const responses = [
    await page.request.get("/sign-in"),
    await page.request.get(`/d/${documentId}`),
    await page.request.get("/api/auth/get-session"),
    await page.request.get("/sw.js"),
  ];
  for (const response of responses) {
    const headers = response.headers();
    for (const [name, pattern] of Object.entries(EXPECTED)) {
      expect(headers[name], `${name} on ${response.url()}`).toMatch(pattern);
    }
    expect(headers["x-powered-by"]).toBeUndefined();
  }
  // The service worker script is never answered from a cache.
  expect(responses[3].headers()["cache-control"]).toBe("no-cache");
});

test("the app cannot be framed by another site", async ({ page, baseURL }) => {
  // A page on another origin that frames the sign-in page, and (as a
  // control, so the test cannot pass because frames never load) a page
  // without these headers.
  await page.route("http://evil.example/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<iframe name="app" src="${baseURL}/sign-in"></iframe><iframe name="control" src="http://other.example/"></iframe>`,
    }),
  );
  await page.route("http://other.example/", (route) =>
    route.fulfill({ contentType: "text/html", body: "<p>Control page</p>" }),
  );
  await page.goto("http://evil.example/");
  await expect(page.frameLocator('iframe[name="control"]').locator("p")).toHaveText("Control page");
  await page.waitForTimeout(1_000);
  const app = page.frame({ name: "app" });
  const framedText = app ? await app.locator("body").innerText().catch(() => "") : "";
  expect(framedText).not.toContain("Sign in to Brahma");
});
