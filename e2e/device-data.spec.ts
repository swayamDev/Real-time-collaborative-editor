import type { Page } from "@playwright/test";
import { signIn, uniqueEmail } from "./auth";
import { expect, test } from "./fixtures";
import { createDocument, expectReadyOffline, expectSaved, uniqueTitle } from "./helpers";

/** Brahma's IndexedDB databases on this device. */
function databases(page: Page): Promise<string[]> {
  return page.evaluate(async () =>
    (await indexedDB.databases()).map((info) => info.name ?? "").filter((name) => name.startsWith("brahma")).sort(),
  );
}

/** Brahma's page caches on this device. */
function pageCaches(page: Page): Promise<string[]> {
  return page.evaluate(async () => (await caches.keys()).filter((name) => name.startsWith("brahma-pages")).sort());
}

// Each test signs in through email links and readies pages for offline use.
test.describe.configure({ timeout: 90_000 });

test("signing out deletes the user's data and signs out their other tabs", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, uniqueEmail("cara"));
  await createDocument(page);
  await page.getByTestId("title").fill(uniqueTitle("Cara private"));
  await expectSaved(page);
  await expectReadyOffline(page);
  expect(await databases(page)).toHaveLength(1);
  expect(await pageCaches(page)).toHaveLength(1);

  const otherTab = await context.newPage();
  await otherTab.goto(page.url());
  await expect(otherTab.getByTestId("editor")).toBeVisible();

  await page.getByTestId("account-menu").click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL(/\/sign-in/);
  await otherTab.waitForURL(/\/sign-in/);
  await expect.poll(() => databases(page)).toEqual([]);
  await expect.poll(() => pageCaches(page)).toEqual([]);
  await context.close();
});

test("a new user on the device never sees the previous user's data, even without sign-out", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  // Ada works on two documents, each kept for offline use.
  await signIn(page, uniqueEmail("ada"));
  const titles = [uniqueTitle("Ada private"), uniqueTitle("Ada private")];
  for (const title of titles) {
    await createDocument(page);
    await page.getByTestId("title").fill(title);
    await page.getByTestId("title").press("Enter");
    await page.keyboard.type("Only Ada should ever see this.");
    await expectSaved(page);
    await expectReadyOffline(page);
  }
  const adaDatabases = await databases(page);
  expect(adaDatabases).toHaveLength(1);
  const adaDatabase = adaDatabases[0];
  const adaId = adaDatabase.slice("brahma:".length);
  expect(await pageCaches(page)).toEqual([expect.stringMatching(new RegExp(`:${adaId}$`))]);

  // The session ends without sign-out running (expired, or cleared by the browser).
  await context.clearCookies();

  // Ben signs in on the same browser.
  await signIn(page, uniqueEmail("ben"));
  await expect.poll(() => databases(page), { timeout: 15_000 }).not.toContain(adaDatabase);
  await expect.poll(() => pageCaches(page), { timeout: 15_000 }).not.toContainEqual(expect.stringContaining(adaId));
  for (const title of titles) await expect(page.getByText(title)).toHaveCount(0);

  // Offline, nothing of Ada's is served from the page cache either.
  await context.setOffline(true);
  await page.goto("/offline").catch(() => {});
  for (const title of titles) await expect(page.getByText(title)).toHaveCount(0);
  await context.setOffline(false);
  await context.close();
});
