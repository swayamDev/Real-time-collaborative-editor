import { readFileSync } from "node:fs";
import type { Page, Request } from "@playwright/test";
import { signIn, uniqueEmail } from "./auth";
import { expect, test } from "./fixtures";
import {
  bodyText,
  caretAtEnd,
  createDocument,
  expectBody,
  expectReadyOffline,
  expectSaved,
  expectStatus,
  setAccess,
  share,
  sidebarRow,
  uniqueTitle,
} from "./helpers";

test.describe.configure({ timeout: 120_000 });

/** Ada's new document with a title and text. */
async function adasDocument(page: Page, text: string): Promise<{ url: string; title: string }> {
  await createDocument(page);
  const title = uniqueTitle("Ada's");
  await page.getByTestId("title").fill(title);
  await page.getByTestId("title").press("Enter");
  await page.keyboard.type(text);
  await expectSaved(page);
  return { url: page.url(), title };
}

test("1. a viewer sees live edits but cannot type", async ({ page: ada, accounts, openAs }) => {
  const { url } = await adasDocument(ada, "Hello.");
  await share(ada, accounts.grace.email, "viewer");
  const grace = await openAs(accounts.grace);
  await grace.goto(url);
  await expectSaved(grace);
  await expect(grace.getByTestId("view-only")).toHaveText("View only");

  await caretAtEnd(ada);
  await ada.keyboard.type(" Live from Ada.");
  await expectBody(grace, "Hello. Live from Ada.");

  // Typing, pasting and title edits do nothing.
  await expect(grace.getByTestId("editor")).toHaveAttribute("contenteditable", "false");
  await grace.getByTestId("editor").click();
  await grace.keyboard.type(" Grace typed.");
  await grace.getByTestId("title").click();
  await grace.keyboard.type(" renamed");
  await expectBody(grace, "Hello. Live from Ada.");
  await expect(grace.getByTestId("bubble-toolbar")).toHaveCount(0);
  await expect(grace.getByTestId("title")).not.toHaveValue(/renamed/);
  expect(await bodyText(ada)).toBe("Hello. Live from Ada.");
});

test("2. upgrading a viewer to editor lets them type without reloading", async ({ page: ada, accounts, openAs }) => {
  const { url } = await adasDocument(ada, "Start.");
  await share(ada, accounts.grace.email, "viewer");
  const grace = await openAs(accounts.grace);
  await grace.goto(url);
  await expect(grace.getByTestId("view-only")).toBeVisible();
  const navigations: string[] = [];
  grace.on("framenavigated", (frame) => frame === grace.mainFrame() && navigations.push(frame.url()));

  await setAccess(ada, accounts.grace.email, "editor");
  await expect(grace.getByTestId("view-only")).toHaveCount(0);
  await caretAtEnd(grace);
  await grace.keyboard.type(" Grace can edit now.");
  await expectSaved(grace);
  await expectBody(ada, "Start. Grace can edit now.");
  expect(navigations).toEqual([]);
});

test("3. revoking access live removes the other person with the message", async ({ page: ada, accounts, openAs }) => {
  const { url, title } = await adasDocument(ada, "Private.");
  await share(ada, accounts.grace.email, "editor");
  const grace = await openAs(accounts.grace);
  await grace.goto(url);
  await expectSaved(grace);

  await setAccess(ada, accounts.grace.email, null);
  const revoked = grace.getByTestId("access-revoked");
  await expect(revoked).toContainText("You no longer have access to this document.");
  await expect(grace.getByTestId("editor")).toHaveCount(0);
  await expect(sidebarRow(grace, title)).toHaveCount(0);
});

test("4. revoked while offline: queued edits are refused, the download keeps them, the local copy is cleared", async ({
  page: ada,
  accounts,
  contextAs,
}) => {
  const { url } = await adasDocument(ada, "Shared.");
  await share(ada, accounts.grace.email, "editor");
  const graceContext = await contextAs(accounts.grace);
  const grace = await graceContext.newPage();
  // Shown in the run's output: a failed or skipped local cleanup warns.
  grace.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") console.log(`[grace ${message.type()}] ${message.text()}`);
  });
  await grace.goto(url);
  await expectSaved(grace);
  await expectReadyOffline(grace);
  const documentId = url.split("/d/")[1];

  await graceContext.setOffline(true);
  await caretAtEnd(grace);
  await grace.keyboard.type(" Grace offline.");
  await expectStatus(grace, "Saved on this device");

  await setAccess(ada, accounts.grace.email, null);
  await graceContext.setOffline(false);
  const revoked = grace.getByTestId("access-revoked");
  await expect(revoked).toContainText("You no longer have access to this document.", { timeout: 20_000 });

  const download = grace.waitForEvent("download");
  await revoked.getByRole("button", { name: "Download a copy" }).click();
  const copy = readFileSync(await (await download).path(), "utf8");
  expect(copy).toContain("Grace offline.");

  // The local copy is gone from Grace's device, and Ada never got the edit.
  // The poll returns what is still stored, so a failure shows which fields
  // (pending count, halted, last opened) were written, and by what.
  await expect
    .poll(() =>
      grace.evaluate(async (id) => {
        const names = (await indexedDB.databases()).map((info) => info.name ?? "").filter((n) => n.startsWith("brahma:"));
        if (names.length === 0) return null;
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(names[0]);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const record = await new Promise<unknown>((resolve) => {
          const request = db.transaction("documents").objectStore("documents").get(id);
          request.onsuccess = () => resolve(request.result ?? null);
          request.onerror = () => resolve({ readError: String(request.error) });
        });
        db.close();
        return record === null ? null : { databases: names, record };
      }, documentId),
    )
    .toBeNull();
  await ada.reload();
  await expectSaved(ada);
  expect(await bodyText(ada)).toBe("Shared.");
});

test("5. a share link works, then stops working once turned off", async ({ page: ada, accounts, openAs }) => {
  const { url } = await adasDocument(ada, "Linked.");
  await ada.getByTestId("share-button").click();
  const dialog = ada.getByTestId("share-dialog");
  await dialog.getByText("Anyone with the link").click();
  const link = await dialog.getByTestId("copy-link").getAttribute("data-url");
  expect(link).toMatch(/\/s\/[0-9a-f-]{36}\/\S+$/);
  await ada.keyboard.press("Escape");

  const grace = await openAs(accounts.grace);
  await grace.goto(link!);
  await grace.waitForURL(url);
  await expectSaved(grace);
  await expectBody(grace, "Linked.");
  await expect(grace.getByTestId("view-only")).toBeVisible();

  // Turning the link off removes the people who joined through it, live.
  await ada.getByTestId("share-button").click();
  await dialog.getByText("Anyone with the link").click();
  await expect(dialog.getByText("Link turned off. Old links no longer work.")).toBeVisible();
  await ada.keyboard.press("Escape");
  await expect(grace.getByTestId("access-revoked")).toBeVisible({ timeout: 15_000 });

  await grace.goto(link!);
  await expect(grace.getByTestId("share-link-invalid")).toContainText("This link doesn't work.");
});

test("6. signing out and in as someone else shows none of the previous user's data, online or offline", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await signIn(page, uniqueEmail("first"));
  await createDocument(page);
  const title = uniqueTitle("First's secret");
  await page.getByTestId("title").fill(title);
  await page.getByTestId("title").press("Enter");
  await page.keyboard.type("Only the first person may read this.");
  await expectSaved(page);
  await expectReadyOffline(page);
  const secretUrl = page.url();

  await page.getByTestId("account-menu").click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL(/\/sign-in/);

  await signIn(page, uniqueEmail("second"));
  await expect(page.getByText(title)).toHaveCount(0);
  await page.goto(secretUrl);
  await expect(page.getByRole("heading", { name: "This document doesn't exist." })).toBeVisible();

  await context.setOffline(true);
  for (const path of ["/offline", "/", secretUrl]) {
    await page.goto(path).catch(() => {});
    await expect(page.getByText(title)).toHaveCount(0);
    await expect(page.getByText("Only the first person may read this.")).toHaveCount(0);
  }
  await context.setOffline(false);
  await context.close();
});

/** Capture the next server action request the page makes. */
function nextServerAction(page: Page): Promise<Request> {
  return page.waitForRequest((request) => request.method() === "POST" && Boolean(request.headers()["next-action"]));
}

/** Send a captured server action again, with its arguments rewritten. */
async function replay(page: Page, captured: Request, from: string, to: string): Promise<string> {
  const headers = await captured.allHeaders();
  const response = await page.request.post(captured.url(), {
    headers: Object.fromEntries(
      Object.entries(headers).filter(([name]) => !["content-length", "cookie", "host"].includes(name.toLowerCase())),
    ),
    data: (captured.postData() ?? "").replaceAll(from, to),
  });
  return response.text();
}

test("7. nobody can open, rename or delete a document without access, in the UI or by calling the action", async ({
  page: ada,
  accounts,
  openAs,
}) => {
  const { url, title } = await adasDocument(ada, "Ada only.");
  const adaDocumentId = url.split("/d/")[1];

  // Through the UI: not found, and not listed.
  const grace = await openAs(accounts.grace);
  await grace.goto(url);
  await expect(grace.getByRole("heading", { name: "This document doesn't exist." })).toBeVisible();
  await expect(grace.getByTestId("editor")).toHaveCount(0);
  await expect(sidebarRow(grace, title)).toHaveCount(0);

  // Directly: Grace renames and deletes her own documents, and the same
  // requests are replayed against Ada's document id.
  const ownId = await createDocument(grace);
  const ownTitle = uniqueTitle("Grace's");
  await grace.getByTestId("title").fill(ownTitle);
  await expectSaved(grace);
  const row = sidebarRow(grace, ownTitle);
  await row.hover();
  await row.getByRole("button", { name: `Actions for ${ownTitle}` }).click();
  await grace.getByRole("menuitem", { name: "Rename" }).click();
  const renameRequest = nextServerAction(grace);
  const input = grace.getByRole("textbox", { name: "Document title" });
  await input.fill("Taken over");
  await input.press("Enter");
  const rename = await renameRequest;
  await expect(sidebarRow(grace, "Taken over")).toBeVisible();

  const renamed = await replay(grace, rename, ownId, adaDocumentId);
  expect(renamed).toContain("This document doesn't exist.");

  const deleteRow = sidebarRow(grace, "Taken over");
  await deleteRow.hover();
  await deleteRow.getByRole("button", { name: "Actions for Taken over" }).click();
  await grace.getByRole("menuitem", { name: "Delete" }).click();
  const deleteRequest = nextServerAction(grace);
  await grace.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
  const deletion = await deleteRequest;
  await expect(sidebarRow(grace, "Taken over")).toHaveCount(0);

  const deleted = await replay(grace, deletion, ownId, adaDocumentId);
  expect(deleted).toContain("This document doesn't exist.");

  // Ada's document is untouched.
  await ada.reload();
  await expectSaved(ada);
  await expect(ada.getByTestId("title")).toHaveValue(title);
  expect(await bodyText(ada)).toBe("Ada only.");
});
