import type { Page } from "@playwright/test";
import { type Accounts, expect, test } from "./fixtures";
import { caretAtEnd, createDocument, expectSaved, mod, share, sidebarRow, uniqueTitle } from "./helpers";
import { startSyncServer, stopSyncServer } from "./sync-server";

// Signed-in people on several devices: more setup than a single page.
test.describe.configure({ timeout: 90_000 });

/** Ada creates a document and shares it with Grace as an editor; both have it open. */
async function pair(
  { accounts, openAs }: { accounts: Accounts; openAs: (account: Accounts["ada"]) => Promise<Page> },
): Promise<{ a: Page; b: Page; url: string }> {
  const a = await openAs(accounts.ada);
  const b = await openAs(accounts.grace);
  await createDocument(a);
  await expectSaved(a);
  await share(a, accounts.grace.email, "editor");
  const url = a.url();
  await b.goto(url);
  await expectSaved(b);
  return { a, b, url };
}

function body(page: Page) {
  return page.getByTestId("editor");
}

/** Document text without collaborator caret flags. */
function text(page: Page): Promise<string> {
  return body(page).evaluate((element) => {
    const copy = element.cloneNode(true) as HTMLElement;
    copy.querySelectorAll(".collab-caret").forEach((caret) => caret.remove());
    // A detached copy has no layout, so read textContent.
    return copy.textContent ?? "";
  });
}

async function expectText(page: Page, expected: string): Promise<void> {
  await expect.poll(() => text(page), { timeout: 10_000 }).toBe(expected);
}

test("typing in A appears in B", async ({ accounts, openAs }) => {
  const { a, b } = await pair({ accounts, openAs });
  await a.getByTestId("title").press("Enter");
  await a.keyboard.type("Hello from Ada");
  await expectText(b, "Hello from Ada");
});

test("concurrent typing at the same position converges in both", async ({ accounts, openAs }) => {
  const { a, b } = await pair({ accounts, openAs });
  await a.getByTestId("title").press("Enter");
  await a.keyboard.type("Start.");
  await expectText(b, "Start.");
  await caretAtEnd(a);
  await caretAtEnd(b);

  await Promise.all([
    a.keyboard.type(" Ada one two three", { delay: 15 }),
    b.keyboard.type(" Grace four five six", { delay: 15 }),
  ]);
  await expectSaved(a);
  await expectSaved(b);

  await expect.poll(async () => (await text(a)) === (await text(b)), { timeout: 10_000 }).toBe(true);
  const merged = await text(a);
  // Both people's characters survive, each in order.
  for (const word of ["Ada", "one", "two", "three", "Grace", "four", "five", "six"]) {
    expect(merged).toContain(word);
  }
});

test("title edits sync both ways", async ({ accounts, openAs }) => {
  const { a, b } = await pair({ accounts, openAs });
  await a.getByTestId("title").fill("Launch review");
  await expect(b.getByTestId("title")).toHaveValue("Launch review");
  await expect(b.getByTestId("breadcrumb-title")).toHaveText("Launch review");

  await b.getByTestId("title").press("End");
  await b.keyboard.type(" notes");
  await expect(a.getByTestId("title")).toHaveValue("Launch review notes");
});

test("carets and names are visible to the other person", async ({ accounts, openAs }) => {
  const { a, b } = await pair({ accounts, openAs });
  await a.getByTestId("title").press("Enter");
  await a.keyboard.type("Where is everyone?");
  await caretAtEnd(b);

  await expect(a.locator(".collab-caret-label", { hasText: "Grace" })).toBeVisible();
  await expect(a.getByTestId("peer-avatar")).toHaveAttribute("data-name", "Grace");
  await expect(b.getByTestId("peer-avatar")).toHaveAttribute("data-name", "Ada");

  // Different colors for the two people.
  const color = (page: Page) =>
    page.getByTestId("self-avatar").locator("span").evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await color(a)).not.toBe(await color(b));
});

test("undo in A does not undo B's edits", async ({ accounts, openAs }) => {
  const { a, b } = await pair({ accounts, openAs });
  await a.getByTestId("title").press("Enter");
  await a.keyboard.type("alpha");
  await expectSaved(a);
  await expectText(b, "alpha");

  await caretAtEnd(b);
  await b.keyboard.type(" beta");
  await expectText(a, "alpha beta");

  await caretAtEnd(a);
  await a.keyboard.press(`${mod}+z`);
  await expectText(a, " beta");
  await expectText(b, " beta");
});

test("reloading B mid-session loses nothing", async ({ accounts, openAs }) => {
  const { a, b } = await pair({ accounts, openAs });
  await a.getByTestId("title").press("Enter");
  await a.keyboard.type("Before reload.");
  await caretAtEnd(b);
  await b.keyboard.type(" Grace was here.");
  await expectSaved(b);
  await expectText(a, "Before reload. Grace was here.");
  await caretAtEnd(a);

  // Ada keeps typing while Grace reloads.
  const typing = a.keyboard.type(" Ada kept typing.", { delay: 30 });
  await b.reload();
  await typing;
  await expectSaved(a);
  await expectSaved(b);

  const expected = "Before reload. Grace was here. Ada kept typing.";
  await expectText(a, expected);
  await expectText(b, expected);
});

test.describe("when the sync server goes down", () => {
  test("clients show Reconnecting with edits saved on the device, then recover with no lost edits", async ({ accounts, openAs }) => {
    const { a, b, url } = await pair({ accounts, openAs });
    await a.getByTestId("title").press("Enter");
    await a.keyboard.type("Before the outage.");
    await expectText(b, "Before the outage.");
    await expectSaved(a);
    await expectSaved(b);

    await stopSyncServer();
    // Online but the socket is down, and every edit is written on the device.
    await expect(a.getByTestId("sync-status")).toHaveText("Reconnecting. Saved on this device.", { timeout: 15_000 });
    await expect(b.getByTestId("sync-status")).toHaveText("Reconnecting. Saved on this device.", { timeout: 15_000 });

    // Both keep editing while the server is down.
    await caretAtEnd(a);
    await a.keyboard.type(" Ada offline.");
    await caretAtEnd(b);
    await b.keyboard.type(" Grace offline.");

    await startSyncServer();
    await expectSaved(a);
    await expectSaved(b);
    await expect.poll(async () => (await text(a)) === (await text(b)), { timeout: 10_000 }).toBe(true);
    const merged = await text(a);
    expect(merged).toContain("Before the outage.");
    expect(merged).toContain("Ada offline.");
    expect(merged).toContain("Grace offline.");

    // And it was stored: a fresh device sees the same content.
    const c = await openAs(accounts.ada);
    await c.goto(url);
    await expectSaved(c);
    await expectText(c, merged);
  });

  test("rename fails clearly, while delete still succeeds through the tombstone", async ({ page }) => {
    await createDocument(page);
    const title = uniqueTitle("Keep me");
    await page.getByTestId("title").fill(title);
    await expectSaved(page);
    const url = page.url();
    const row = sidebarRow(page, title);
    await expect(row).toBeVisible();

    await stopSyncServer();

    await row.hover();
    await row.getByRole("button", { name: `Actions for ${title}` }).click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    const input = page.getByRole("textbox", { name: "Document title" });
    await input.fill("Renamed while down");
    await input.press("Enter");
    await expect(row.getByRole("alert")).toHaveText("Couldn't rename. Try again.");
    await expect(row).toContainText(title);

    // The tombstone commits in Postgres; the room cleanup is deferred.
    await row.hover();
    await row.getByRole("button", { name: `Actions for ${title}` }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const dialog = page.getByRole("dialog", { name: `Delete "${title}"?` });
    await dialog.getByRole("button", { name: "Delete" }).click();
    await expect(dialog).toBeHidden();
    await expect(sidebarRow(page, title)).toHaveCount(0);

    // When the sync server returns, the room sees the tombstone and erases itself.
    await startSyncServer();
    await page.goto(url);
    await expect(page.getByTestId("document-gone")).toContainText("This document was deleted.");
    await page.goto("/");
    await expect(sidebarRow(page, title)).toHaveCount(0);
  });
});
