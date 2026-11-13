import { expect, test } from "@playwright/test";
import { createDocument, expectSaved, mod } from "./helpers";

// Comfortably larger than the 64 KiB keepalive body limit once encoded.
const LARGE_TEXT_LENGTH = 100_000;

test("shows Saving while edits are pending, then Saved", async ({ page }) => {
  await createDocument(page);
  await page.getByTestId("title").press("Enter");
  await page.keyboard.type("Pending");
  await expect(page.getByTestId("save-status")).toHaveText("Saving");
  await expectSaved(page);
});

test("a failed save offers Retry and recovers", async ({ page }) => {
  await createDocument(page);
  await page.route("**/api/documents/*/state", (route) => route.abort("internetdisconnected"));
  await page.getByTestId("title").press("Enter");
  await page.keyboard.type("Offline edit");

  const status = page.getByTestId("save-status");
  await expect(status).toHaveText("Couldn't save. Retry", { timeout: 10_000 });

  await page.unroute("**/api/documents/*/state");
  await status.getByRole("button", { name: "Retry" }).click();
  await expectSaved(page);
  await page.reload();
  await expect(page.getByTestId("editor")).toHaveText("Offline edit");
});

test("warns before leaving with unsaved changes", async ({ page }) => {
  await createDocument(page);
  await page.getByTestId("title").press("Enter");
  await page.keyboard.type("Not saved yet");

  const dialog = page.waitForEvent("dialog");
  await page.close({ runBeforeUnload: true });
  const prompt = await dialog;
  expect(prompt.type()).toBe("beforeunload");
  await prompt.dismiss();
});

test("a document over 64 KiB still warns on leave, saves with a normal fetch, and persists", async ({ page }) => {
  const id = await createDocument(page);
  await page.getByTestId("title").press("Enter");

  const marker = "END-OF-LARGE-DOCUMENT";
  await page.keyboard.insertText("a".repeat(LARGE_TEXT_LENGTH) + marker);

  // Leave before the debounce fires. The warning must appear.
  const saveRequest = page.waitForRequest(
    (request) => request.url().endsWith(`/api/documents/${id}/state`) && request.method() === "POST",
  );
  const dialog = page.waitForEvent("dialog");
  await page.close({ runBeforeUnload: true });
  const prompt = await dialog;
  expect(prompt.type()).toBe("beforeunload");

  // The unload save carries the whole pending update, more than keepalive allows.
  const request = await saveRequest;
  expect(request.postDataBuffer()?.byteLength ?? 0).toBeGreaterThan(64 * 1024);

  // Stay on the page. The normal fetch completes and the status settles.
  await prompt.dismiss();
  await expectSaved(page);

  // Open the document fresh and check the content survived intact.
  const fresh = await page.context().newPage();
  await fresh.goto(`/d/${id}`);
  await expect(fresh.getByTestId("editor")).toContainText(marker);
  const text = await fresh.getByTestId("editor").innerText();
  expect(text.trim()).toHaveLength(LARGE_TEXT_LENGTH + marker.length);
});

test("Mod+S saves immediately", async ({ page }) => {
  await createDocument(page);
  await page.getByTestId("title").press("Enter");
  await page.keyboard.type("Save me now");
  const save = page.waitForResponse((response) => response.url().endsWith("/state") && response.ok());
  await page.keyboard.press(`${mod}+s`);
  await save;
  await expectSaved(page);
});
