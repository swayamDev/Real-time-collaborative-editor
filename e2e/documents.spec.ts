import { expect, test } from "@playwright/test";
import { createDocument, expectSaved, setTitle, sidebarRow, uniqueTitle } from "./helpers";

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

  await page.reload();
  await expect(rows.first()).toContainText(older);
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
