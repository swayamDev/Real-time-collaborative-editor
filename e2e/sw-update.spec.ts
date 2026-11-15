import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { createDocument, expectBody, expectReadyOffline, expectSaved, uniqueTitle } from "./helpers";

test.describe.configure({ timeout: 120_000 });

const SW_FILE = join(__dirname, "..", "public", "sw.js");

function cacheNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => (await caches.keys()).filter((name) => name.startsWith("brahma")).sort());
}

function refreshPending(page: Page): Promise<boolean> {
  return page.evaluate(async () => Boolean(await caches.match("/__brahma/refresh-pending", { cacheName: "brahma-user" })));
}

test("a deploy keeps offline copies working, and refreshes them only for a confirmed user", async ({ page, context, accounts }) => {
  await createDocument(page);
  await page.getByTestId("title").fill(uniqueTitle("Through a deploy"));
  await page.getByTestId("title").press("Enter");
  await page.keyboard.type("Written before the deploy.");
  await expectSaved(page);
  await expectReadyOffline(page);
  const path = new URL(page.url()).pathname;
  const before = await cacheNames(page);
  const oldStatic = before.find((name) => name.startsWith("brahma-static-"))!;
  const pagesCache = before.find((name) => name.startsWith("brahma-pages:"))!;
  expect(pagesCache).toMatch(/^brahma-pages:[^:]+$/);

  // Deploy: the next request for sw.js gets a new version.
  const original = readFileSync(SW_FILE, "utf8");
  const version = /const VERSION = "([^"]+)"/.exec(original)![1];
  writeFileSync(SW_FILE, original.replace(`const VERSION = "${version}"`, 'const VERSION = "e2e-next-deploy"'));
  try {
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
    await expect.poll(() => cacheNames(page), { timeout: 30_000 }).toContain("brahma-static-e2e-next-deploy");

    // 1. Activation keeps the earlier version's files and the page copies.
    await expect.poll(() => refreshPending(page)).toBe(true);
    expect(await cacheNames(page)).toEqual(expect.arrayContaining([oldStatic, pagesCache]));
    expect(await page.evaluate(async (url) => Boolean(await caches.match(url)), path)).toBe(true);

    // 2. The server says someone else (Grace) is signed in, and a stale page
    // tells the worker it is Ada. Without the gate the refresh would fetch
    // Ada's pages with Grace's session: her document answers 404 (Ada's
    // offline copy deleted) and Grace's pages would land in Ada's cache.
    const cookies = await context.cookies();
    const grace = JSON.parse(readFileSync(accounts.grace.storageState, "utf8")) as { cookies: Parameters<typeof context.addCookies>[0] };
    await context.clearCookies();
    await context.addCookies(grace.cookies);
    await page.evaluate(async (userId) => {
      (await navigator.serviceWorker.ready).active!.postMessage({ type: "set-user", userId });
    }, pagesCache.slice("brahma-pages:".length));
    await page.waitForTimeout(2_000);
    expect(await cacheNames(page)).toContain(oldStatic);
    expect(await refreshPending(page)).toBe(true);
    expect(await page.evaluate(async (url) => Boolean(await caches.match(url)), path)).toBe(true);
    await context.clearCookies();
    await context.addCookies(cookies);

    // 3. A confirmed load refreshes the copies and drops the old files.
    await page.reload();
    await expectSaved(page);
    await expect.poll(() => cacheNames(page), { timeout: 20_000 }).not.toContain(oldStatic);
    expect(await refreshPending(page)).toBe(false);
    expect(await page.evaluate(async (url) => Boolean(await caches.match(url)), path)).toBe(true);

    await context.setOffline(true);
    await page.reload();
    await expectBody(page, "Written before the deploy.");
    await context.setOffline(false);
  } finally {
    writeFileSync(SW_FILE, original);
  }
});
