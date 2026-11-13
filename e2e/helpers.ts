import { type Page, expect } from "@playwright/test";

/** A title that no other test (or earlier run) will collide with. */
export function uniqueTitle(prefix: string): string {
  return `${prefix} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Create a document from the sidebar and return its id. */
export async function createDocument(page: Page): Promise<string> {
  // "/" redirects to the most recent document when one exists, so wait for
  // the URL to change rather than for any document URL.
  await page.goto("/");
  const before = page.url();
  await page.getByRole("button", { name: "New document" }).first().click();
  await page.waitForURL((url) => url.href !== before && /\/d\/[0-9a-f-]{36}$/.test(url.pathname));
  await expect(page.getByTestId("title")).toBeFocused();
  await expect(page.getByTestId("editor")).toBeVisible();
  return page.url().split("/d/")[1];
}

export async function expectSaved(page: Page): Promise<void> {
  await expect(page.getByTestId("save-status")).toHaveText("Saved", { timeout: 15_000 });
}

export async function setTitle(page: Page, title: string): Promise<void> {
  await page.getByTestId("title").fill(title);
  await expectSaved(page);
}

export function sidebarRow(page: Page, title: string) {
  return page.getByTestId("document-list-docked").getByRole("listitem").filter({ hasText: title });
}

export const mod = process.platform === "darwin" ? "Meta" : "Control";
