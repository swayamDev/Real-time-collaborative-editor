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

/** Saved, and every local edit acknowledged by the sync server. */
export async function expectSaved(page: Page): Promise<void> {
  const status = page.getByTestId("sync-status");
  await expect(status).toHaveText("Saved", { timeout: 15_000 });
  await expect(status).toHaveAttribute("data-pending", "false", { timeout: 15_000 });
}

export async function setTitle(page: Page, title: string): Promise<void> {
  await page.getByTestId("title").fill(title);
  await expectSaved(page);
}

export function sidebarRow(page: Page, title: string) {
  return page.getByTestId("document-list-docked").getByRole("listitem").filter({ hasText: title });
}

export const mod = process.platform === "darwin" ? "Meta" : "Control";

/**
 * Wait until the editor's own selection covers `text`. ProseMirror learns
 * about keyboard selection changes from the asynchronous selectionchange
 * event, a few milliseconds after the keys are pressed.
 */
export async function waitForEditorSelection(page: Page, text: string): Promise<void> {
  await page.waitForFunction((expected) => {
    const root = document.querySelector(".ProseMirror") as (Element & { editor?: { state: { selection: { from: number; to: number }; doc: { textBetween: (from: number, to: number) => string } } } }) | null;
    const state = root?.editor?.state;
    return state ? state.doc.textBetween(state.selection.from, state.selection.to) === expected : false;
  }, text);
}

/**
 * Wait until the service worker controls the page and holds a copy of the
 * current document page, so an offline reload is really served offline.
 */
export async function expectReadyOffline(page: Page): Promise<void> {
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  // A navigation that started while the worker was still activating (for
  // example the sign-in redirect) stays uncontrolled for that page's life.
  // The next load is controlled; tests that go offline need this one to be.
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) await page.reload();
  await page.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), undefined, { timeout: 15_000 });
  const path = new URL(page.url()).pathname;
  await page.waitForFunction(async (url) => Boolean(await caches.match(url)), path, { timeout: 15_000 });
}

/** Document text without collaborator caret flags. */
export function bodyText(page: Page): Promise<string> {
  return page.getByTestId("editor").evaluate((element) => {
    const copy = element.cloneNode(true) as HTMLElement;
    copy.querySelectorAll(".collab-caret").forEach((caret) => caret.remove());
    return copy.textContent ?? "";
  });
}

export async function expectBody(page: Page, expected: string, timeout = 15_000): Promise<void> {
  await expect.poll(() => bodyText(page), { timeout }).toBe(expected);
}

export async function expectStatus(page: Page, label: string, timeout = 15_000): Promise<void> {
  await expect(page.getByTestId("sync-status")).toHaveText(label, { timeout });
}
