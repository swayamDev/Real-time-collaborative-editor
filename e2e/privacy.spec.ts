import { expect, test } from "./fixtures";
import { createDocument, expectReadyOffline, expectSaved } from "./helpers";

test("the privacy policy opens without signing in, and the sign-in page links to it", async ({ browser }) => {
  // Contexts inherit the default account's session (fixtures.ts): start from nothing.
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  expect(await context.cookies()).toEqual([]);
  const page = await context.newPage();

  const response = await page.goto("/privacy");
  expect(response?.status()).toBe(200);
  expect(new URL(page.url()).pathname).toBe("/privacy");
  await expect(page.getByRole("heading", { level: 1, name: "Privacy policy" })).toBeVisible();
  for (const text of ["Neon Postgres, in Singapore", "Cloudflare", "Resend", "Sentry", "Signing out deletes"]) {
    await expect(page.getByText(text).first()).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "open an issue on GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/swayamDev/Real-time-collaborative-editor/issues/new",
  );

  await page.goto("/sign-in");
  await page.getByRole("link", { name: "Privacy policy" }).click();
  await expect(page).toHaveURL(/\/privacy$/);
  await context.close();
});

test("a signed-in visit does not keep the privacy policy in that person's page cache", async ({ page }) => {
  // Signed in with a controlling service worker that caches pages for this user.
  await createDocument(page);
  await expectSaved(page);
  await expectReadyOffline(page);

  await page.goto("/privacy");
  await expect(page.getByRole("heading", { level: 1, name: "Privacy policy" })).toBeVisible();
  // The document page went into the user's cache; the policy did not.
  const cached = await page.evaluate(async () => {
    const names = (await caches.keys()).filter((name) => name.startsWith("brahma-pages"));
    const paths: string[] = [];
    for (const name of names) {
      for (const request of await (await caches.open(name)).keys()) paths.push(new URL(request.url).pathname);
    }
    return paths;
  });
  expect(cached.some((path) => path.startsWith("/d/"))).toBe(true);
  expect(cached).not.toContain("/privacy");
});
