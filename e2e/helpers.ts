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
  // Focus waits for the first sync (token, socket, handshake).
  await expect(page.getByTestId("title")).toBeFocused({ timeout: 15_000 });
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
  if (!(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)))) {
    await page.reload();
    // Hydrated and synced again before the test goes on to click anything.
    await expect(page.getByTestId("sync-status")).toHaveAttribute("data-status", "saved", { timeout: 15_000 });
  }
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
  const status = page.getByTestId("sync-status");
  await expect(status).toHaveText(label, { timeout });
  // "Saved on this device" shows while the newest keystrokes are still being
  // written (the label waits a second before saying "Saving"); wait for them.
  if (label === "Saved on this device") await expect(status).toHaveAttribute("data-unwritten", "false", { timeout });
}

/** Put the caret at the end of the body. */
export async function caretAtEnd(page: Page): Promise<void> {
  await page.getByTestId("editor").click();
  await page.keyboard.press(`${mod}+End`);
}

/** The owner shares the open document with `email` through the share dialog. */
export async function share(owner: Page, email: string, role: "editor" | "viewer"): Promise<void> {
  await owner.getByTestId("share-button").click();
  const dialog = owner.getByTestId("share-dialog");
  await dialog.getByPlaceholder("Email address").fill(email);
  await dialog.getByRole("combobox", { name: "Role for the invite" }).selectOption(role);
  await dialog.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(dialog.locator(`[data-testid="share-member"][data-email="${email}"]`)).toBeVisible();
  await owner.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}

/** The owner changes, or with null removes, someone's access to the open document. */
export async function setAccess(owner: Page, email: string, role: "editor" | "viewer" | null): Promise<void> {
  await owner.getByTestId("share-button").click();
  const dialog = owner.getByTestId("share-dialog");
  const row = dialog.locator(`[data-testid="share-member"][data-email="${email}"]`);
  await expect(row).toBeVisible();
  if (role === null) {
    await row.getByRole("button", { name: "Remove" }).click();
    await expect(row).toHaveCount(0);
  } else {
    await row.getByRole("combobox").selectOption(role);
    await expect(row.getByRole("combobox")).toHaveValue(role);
  }
  // The server action has finished (it holds no socket open).
  await owner.waitForLoadState("networkidle");
  await owner.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
}
