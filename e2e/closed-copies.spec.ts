import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import {
  bodyText,
  caretAtEnd,
  createDocument,
  expectReadyOffline,
  expectSaved,
  expectStatus,
  setAccess,
  share,
  sidebarRow,
  uniqueTitle,
} from "./helpers";

// Two people, several tabs: more setup than a single page.
test.describe.configure({ timeout: 90_000 });

async function adasDocument(ada: Page, text: string): Promise<{ url: string; title: string }> {
  await createDocument(ada);
  const title = uniqueTitle("Ada's");
  await ada.getByTestId("title").fill(title);
  await ada.getByTestId("title").press("Enter");
  await ada.keyboard.type(text);
  await expectSaved(ada);
  return { url: ada.url(), title };
}

/**
 * A tab whose sync socket never reaches the server (Playwright answers it
 * and stays silent), so the only way it can learn about a revoke or a
 * deletion is from the user's other tabs.
 */
async function tabCutOffFromServer(page: Page, url: string): Promise<void> {
  await page.routeWebSocket(/\/documents\//, () => {});
  await page.goto(url);
  await expect(page.getByTestId("editor")).toBeVisible();
}

/** Nothing on the page accepts typing: no editable body or title. */
async function expectNoInput(page: Page): Promise<void> {
  await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);
  await expect(page.locator("[data-testid=title]:not([readonly])")).toHaveCount(0);
}

test("access removed: every tab of that person shows the download screen and takes no input", async ({
  page: ada,
  accounts,
  contextAs,
}) => {
  const { url } = await adasDocument(ada, "Shared.");
  await share(ada, accounts.grace.email, "editor");
  const grace = await contextAs(accounts.grace);
  const live = await grace.newPage();
  await live.goto(url);
  await expectSaved(live);
  const cutOff = await grace.newPage();
  await tabCutOffFromServer(cutOff, url);

  await setAccess(ada, accounts.grace.email, null);

  for (const tab of [live, cutOff]) {
    const revoked = tab.getByTestId("access-revoked");
    await expect(revoked).toContainText("You no longer have access to this document.", { timeout: 20_000 });
    await expect(revoked.getByRole("button", { name: "Download a copy" })).toBeVisible();
    await expectNoInput(tab);
  }
});

test("deleted: every tab of that person closes the document and takes no input", async ({
  page: ada,
  accounts,
  contextAs,
}) => {
  const { url, title } = await adasDocument(ada, "Soon gone.");
  await share(ada, accounts.grace.email, "editor");
  const grace = await contextAs(accounts.grace);
  const live = await grace.newPage();
  await live.goto(url);
  await expectSaved(live);
  const cutOff = await grace.newPage();
  await tabCutOffFromServer(cutOff, url);

  const row = sidebarRow(ada, title);
  await row.hover();
  await row.getByRole("button", { name: `Actions for ${title}` }).click();
  await ada.getByRole("menuitem", { name: "Delete" }).click();
  await ada.getByRole("dialog", { name: `Delete "${title}"?` }).getByRole("button", { name: "Delete" }).click();

  // Nothing unsynced was on the device, so both tabs show the same plain screen.
  for (const tab of [live, cutOff]) {
    await expect(tab.getByTestId("document-gone")).toBeVisible({ timeout: 20_000 });
    await expectNoInput(tab);
  }
});

test("made a viewer with unsent edits: the old editor is gone, the edits are in the download, and nothing more can be typed", async ({
  page: ada,
  accounts,
  contextAs,
}) => {
  const { url } = await adasDocument(ada, "Shared.");
  await share(ada, accounts.grace.email, "editor");
  const graceContext = await contextAs(accounts.grace);
  const grace = await graceContext.newPage();
  await grace.goto(url);
  await expectSaved(grace);
  await expectReadyOffline(grace);

  await graceContext.setOffline(true);
  await caretAtEnd(grace);
  await grace.keyboard.type(" Grace offline.");
  await expectStatus(grace, "Saved on this device");

  await setAccess(ada, accounts.grace.email, "viewer");
  await graceContext.setOffline(false);

  // The refused edits are offered as a download, and the page rebuilt as a viewer.
  const banner = grace.getByTestId("access-downgraded");
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await expect(grace.getByTestId("editor")).toBeVisible();
  await expectNoInput(grace);
  await expectSaved(grace);
  expect(await bodyText(grace)).toBe("Shared.");

  // Typing goes nowhere: no editor accepts it.
  await grace.getByTestId("editor").click();
  await grace.keyboard.type("ignored");
  expect(await bodyText(grace)).toBe("Shared.");

  const download = grace.waitForEvent("download");
  await banner.getByRole("button", { name: "Download a copy" }).click();
  expect(readFileSync(await (await download).path(), "utf8")).toContain("Grace offline.");
});
