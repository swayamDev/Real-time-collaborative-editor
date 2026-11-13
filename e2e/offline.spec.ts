import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  bodyText,
  createDocument,
  expectBody,
  expectReadyOffline,
  expectSaved,
  expectStatus,
  mod,
  sidebarRow,
  uniqueTitle,
} from "./helpers";

const opened: BrowserContext[] = [];

async function newContext(browser: Browser, name: string): Promise<BrowserContext> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addCookies([{ name: "brahma-name", value: encodeURIComponent(name), url: "http://localhost:3100" }]);
  opened.push(context);
  return context;
}

test.afterEach(async () => {
  for (const context of opened.splice(0)) await context.close();
});

async function caretAtEnd(page: Page): Promise<void> {
  await page.getByTestId("editor").click();
  await page.keyboard.press(`${mod}+End`);
}

/** A document with a title and some text, synced and ready to work offline. */
async function documentReadyOffline(page: Page, text: string): Promise<string> {
  await createDocument(page);
  await page.getByTestId("title").fill(uniqueTitle("Offline"));
  await page.getByTestId("title").press("Enter");
  await page.keyboard.type(text);
  await expectSaved(page);
  await expectReadyOffline(page);
  return page.url();
}

test("edits made offline survive a reload while still offline", async ({ browser }) => {
  const context = await newContext(browser, "Ada");
  const page = await context.newPage();
  await documentReadyOffline(page, "Online.");

  await context.setOffline(true);
  await caretAtEnd(page);
  await page.keyboard.type(" Offline.");
  await expectStatus(page, "Saved on this device");

  await page.reload();
  await expectBody(page, "Online. Offline.");
  await expectStatus(page, "Saved on this device");
  // The title stays editable offline: this device has synced the document.
  await expect(page.getByTestId("title")).toBeEditable();
});

test("edits from a tab closed offline reach the server and another person", async ({ browser }) => {
  const context = await newContext(browser, "Ada");
  let page = await context.newPage();
  const url = await documentReadyOffline(page, "Start.");

  await context.setOffline(true);
  await caretAtEnd(page);
  await page.keyboard.type(" Written offline.");
  await expectStatus(page, "Saved on this device");
  await expect(sidebarRow(page, "Offline").getByTestId("unsynced-marker")).toBeVisible();
  await page.close();

  // Reopen while still offline, then the network returns.
  page = await context.newPage();
  await page.goto(url);
  await expectBody(page, "Start. Written offline.");
  await context.setOffline(false);
  await expectSaved(page);
  await expect(sidebarRow(page, "Offline").getByTestId("unsynced-marker")).toHaveCount(0);

  const other = await (await newContext(browser, "Grace")).newPage();
  await other.goto(url);
  await expectSaved(other);
  await expectBody(other, "Start. Written offline.");
});

test("two people editing the same paragraph offline converge to identical text", async ({ browser }) => {
  const aContext = await newContext(browser, "Ada");
  const a = await aContext.newPage();
  const url = await documentReadyOffline(a, "Shared paragraph.");
  const bContext = await newContext(browser, "Grace");
  const b = await bContext.newPage();
  await b.goto(url);
  await expectSaved(b);
  await expectReadyOffline(b);

  await aContext.setOffline(true);
  await bContext.setOffline(true);
  await caretAtEnd(a);
  await a.keyboard.type(" Ada adds this.");
  await caretAtEnd(b);
  await b.keyboard.type(" Grace adds that.");
  await expectStatus(a, "Saved on this device");
  await expectStatus(b, "Saved on this device");

  await aContext.setOffline(false);
  await bContext.setOffline(false);
  await expectSaved(a);
  await expectSaved(b);
  await expect.poll(async () => (await bodyText(a)) === (await bodyText(b)), { timeout: 15_000 }).toBe(true);
  const merged = await bodyText(a);
  expect(merged).toContain("Shared paragraph.");
  expect(merged).toContain("Ada adds this.");
  expect(merged).toContain("Grace adds that.");
});

test("two tabs on one device stay in sync while offline", async ({ browser }) => {
  const context = await newContext(browser, "Ada");
  const first = await context.newPage();
  const url = await documentReadyOffline(first, "Tab one.");
  const second = await context.newPage();
  await second.goto(url);
  await expectSaved(second);

  await context.setOffline(true);
  await caretAtEnd(first);
  await first.keyboard.type(" Typed in tab one while offline.");
  await expectBody(second, "Tab one. Typed in tab one while offline.");
  await caretAtEnd(second);
  await second.keyboard.type(" And tab two.");
  await expectBody(first, "Tab one. Typed in tab one while offline. And tab two.");
});

test("more than 1 MiB of offline edits syncs", async ({ browser }) => {
  const context = await newContext(browser, "Ada");
  const page = await context.newPage();
  const url = await documentReadyOffline(page, "Big.");

  await context.setOffline(true);
  await caretAtEnd(page);
  // Each paste stays under the single-edit limit; together they exceed 1 MiB.
  const chunk = "y".repeat(200_000);
  for (let i = 0; i < 6; i++) await page.keyboard.insertText(chunk);
  await expectStatus(page, "Saved on this device", 30_000);

  const sent: number[] = [];
  page.on("websocket", (socket) => socket.on("framesent", (frame) => sent.push(frame.payload.length)));
  await context.setOffline(false);
  await expectSaved(page);

  // Delivered as several messages, none over Brahma's 4 MiB cap.
  expect(sent.filter((size) => size > 100_000).length).toBeGreaterThan(1);
  expect(Math.max(...sent)).toBeLessThan(4 * 1024 * 1024);

  const other = await (await newContext(browser, "Grace")).newPage();
  await other.goto(url);
  await expectSaved(other);
  await expect.poll(async () => (await bodyText(other)).length, { timeout: 20_000 }).toBe(4 + 1_200_000);
});

test("a document deleted while offline offers to keep the offline edits", async ({ browser }) => {
  const aContext = await newContext(browser, "Ada");
  const a = await aContext.newPage();
  const url = await documentReadyOffline(a, "Before.");
  const title = await a.getByTestId("title").inputValue();

  await aContext.setOffline(true);
  await caretAtEnd(a);
  await a.keyboard.type(" Kept offline.");
  await expectStatus(a, "Saved on this device");

  // Someone else deletes it meanwhile.
  const b = await (await newContext(browser, "Grace")).newPage();
  await b.goto(url);
  await expectSaved(b);
  const row = sidebarRow(b, title);
  await row.hover();
  await row.getByRole("button", { name: `Actions for ${title}` }).click();
  await b.getByRole("menuitem", { name: "Delete" }).click();
  await b.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(sidebarRow(b, title)).toHaveCount(0);

  await aContext.setOffline(false);
  const notice = a.getByTestId("deleted-while-offline");
  await expect(notice).toContainText("This document was deleted while you were offline.", { timeout: 20_000 });
  await notice.getByRole("button", { name: "Save as new document" }).click();

  await a.waitForURL((next) => next.href !== url && /\/d\//.test(next.pathname));
  await expectSaved(a);
  await expectBody(a, "Before. Kept offline.");
  await expect(a.getByTestId("title")).toHaveValue(title);

  const copyUrl = a.url();
  const c = await (await newContext(browser, "Katherine")).newPage();
  await c.goto(copyUrl);
  await expectSaved(c);
  await expectBody(c, "Before. Kept offline.");
});

test("clearing IndexedDB recovers the document from the server", async ({ browser }) => {
  const context = await newContext(browser, "Ada");
  let page = await context.newPage();
  await createDocument(page);
  const title = uniqueTitle("Recover");
  await page.getByTestId("title").fill(title);
  await page.getByTestId("title").press("Enter");
  await page.keyboard.type("Stored on the server.");
  await expectSaved(page);
  const url = page.url();
  await page.close();

  // A page on this origin with no app code holding the database open.
  page = await context.newPage();
  await page.goto("/sw.js");
  const deleted = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const request = indexedDB.deleteDatabase("brahma");
        request.onsuccess = () => resolve("deleted");
        request.onerror = () => resolve("error");
        request.onblocked = () => resolve("blocked");
      }),
  );
  expect(deleted).toBe("deleted");

  await page.goto(url);
  await expectSaved(page);
  await expectBody(page, "Stored on the server.");
  await expect(page.getByTestId("title")).toHaveValue(title);
});
