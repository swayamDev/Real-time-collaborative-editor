import { Client } from "pg";
import { expect, test } from "./fixtures";
import { databaseUrl } from "./sync-server";
import { createDocument, expectSaved, setAccess, setTitle, share, sidebarRow, uniqueTitle } from "./helpers";

test("renames a document from the sidebar", async ({ page }) => {
  await createDocument(page);
  const original = uniqueTitle("Before rename");
  await setTitle(page, original);

  const row = sidebarRow(page, original);
  await row.hover();
  await row.getByRole("button", { name: `Actions for ${original}` }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();

  const renamed = uniqueTitle("After rename");
  const input = page.getByRole("textbox", { name: "Document title" });
  await expect(input).toBeFocused();
  await input.fill(renamed);
  await input.press("Enter");

  await expect(sidebarRow(page, renamed)).toBeVisible();
  await expect(page.getByTestId("breadcrumb-title")).toHaveText(renamed);
  await expect(page.getByTestId("title")).toHaveValue(renamed);

  await page.reload();
  await expect(sidebarRow(page, renamed)).toBeVisible();
  await expect(page.getByTestId("title")).toHaveValue(renamed);
});

test("deletes a document after confirming, and cancel keeps it", async ({ page }) => {
  await createDocument(page);
  const title = uniqueTitle("Delete me");
  await setTitle(page, title);
  const row = sidebarRow(page, title);
  const dialog = page.getByRole("dialog", { name: `Delete "${title}"?` });

  // Cancel first.
  await row.hover();
  await row.getByRole("button", { name: `Actions for ${title}` }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("This can't be undone.");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(row).toBeVisible();

  // Then delete.
  await row.hover();
  await row.getByRole("button", { name: `Actions for ${title}` }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await dialog.getByRole("button", { name: "Delete" }).click();

  await expect(dialog).toBeHidden();
  await expect(sidebarRow(page, title)).toHaveCount(0);

  await page.reload();
  await expect(sidebarRow(page, title)).toHaveCount(0);
});

test("a renamed document keeps its title in the list while the server lags (issue #2)", async ({ page }) => {
  await createDocument(page);
  const id = page.url().split("/d/")[1];
  const renamed = uniqueTitle("Renamed");

  // Hold the document's row: the sync server's snapshot (which copies the
  // title into the list) waits behind the lock, as it does when the server
  // lags. Reading the list is not blocked.
  const db = new Client({ connectionString: databaseUrl() });
  await db.connect();
  try {
    await db.query("BEGIN");
    await db.query("SELECT 1 FROM documents WHERE id = $1 FOR UPDATE", [id]);
    await setTitle(page, renamed);

    // Creating another document refreshes the list from the server, which
    // still has the old title. The sidebar keeps the one this tab knows.
    await createDocument(page);
    await expect(sidebarRow(page, renamed)).toBeVisible({ timeout: 5_000 });
  } finally {
    await db.query("ROLLBACK").catch(() => {});
    await db.end();
  }
});

test("a newer rename from another browser wins over an older title on this device (issue #2)", async ({ page: laptop, accounts, openAs }) => {
  await createDocument(laptop);
  const id = laptop.url().split("/d/")[1];
  const older = uniqueTitle("Named on the laptop");
  await setTitle(laptop, older);
  // Leave the document, so the laptop does not see the next rename live.
  await createDocument(laptop);

  const phone = await openAs(accounts.ada);
  await phone.goto(`/d/${id}`);
  const newer = uniqueTitle("Renamed on the phone");
  await setTitle(phone, newer);

  // Once the server has the newer rename, it beats the laptop's own title.
  // Each check waits for the device's titles to load after the reload.
  await expect
    .poll(
      async () => {
        await laptop.reload();
        await expect(laptop.getByTestId("document-list-docked")).toBeVisible();
        await laptop.waitForTimeout(1_000);
        return { newer: await sidebarRow(laptop, newer).count(), older: await sidebarRow(laptop, older).count() };
      },
      { timeout: 30_000, intervals: [1_000] },
    )
    .toEqual({ newer: 1, older: 0 });
});

test("a title known on this device never brings back a document the server no longer lists (issue #2)", async ({ page: ada, accounts, openAs }) => {
  await createDocument(ada);
  await share(ada, accounts.grace.email, "editor");
  const url = ada.url();

  const grace = await openAs(accounts.grace);
  await grace.goto(url);
  const titleOnGrace = uniqueTitle("Grace named it");
  await setTitle(grace, titleOnGrace);
  await expect(sidebarRow(grace, titleOnGrace)).toHaveCount(1);
  // Grace moves on; this device keeps its copy, with that title.
  await createDocument(grace);

  await ada.goto(url);
  await setAccess(ada, accounts.grace.email, null);
  await grace.reload();
  await expect(grace.getByTestId("document-list-docked")).toBeVisible();
  await grace.waitForTimeout(1_500);
  await expect(sidebarRow(grace, titleOnGrace)).toHaveCount(0);
});

test("the list is sorted by last edit", async ({ page }) => {
  await createDocument(page);
  const older = uniqueTitle("Older");
  await setTitle(page, older);

  await createDocument(page);
  const newer = uniqueTitle("Newer");
  await setTitle(page, newer);

  const rows = page.getByTestId("document-list-docked").getByRole("listitem");
  await expect(rows.first()).toContainText(newer);

  // Editing the older document moves it to the top.
  await sidebarRow(page, older).getByRole("link").click();
  await expect(page.getByTestId("title")).toHaveValue(older);
  await page.getByTestId("editor").click();
  await page.keyboard.type("A fresh edit");
  await expectSaved(page);
  await expect(rows.first()).toContainText(older);

  // A fresh page reads the order from Postgres, which the sync server
  // updates with each snapshot, a few seconds after the last edit at most.
  await expect
    .poll(
      async () => {
        await page.reload();
        return rows.first().innerText();
      },
      { timeout: 20_000, intervals: [1_000] },
    )
    .toContain(older);
});

test("a missing document shows a plain not found page", async ({ page }) => {
  await page.goto("/d/00000000-0000-4000-8000-000000000000");
  await expect(page.getByRole("heading", { name: "This document doesn't exist." })).toBeVisible();
  await page.getByRole("link", { name: "Go to your documents" }).click();
  await expect(page).not.toHaveURL(/00000000/);
});

test("on small screens the sidebar is a drawer", async ({ page }) => {
  await createDocument(page);
  const title = uniqueTitle("Drawer");
  await setTitle(page, title);
  await page.setViewportSize({ width: 390, height: 800 });

  const drawer = page.getByRole("dialog", { name: "Sidebar" });
  await expect(drawer).toBeHidden();
  await page.getByRole("button", { name: "Open sidebar" }).click();
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole("link", { name: new RegExp(title) })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
});
