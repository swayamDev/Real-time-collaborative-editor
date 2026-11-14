import { signIn, uniqueEmail } from "./auth";
import { expect, test } from "./fixtures";
import { bodyText, createDocument, expectReadyOffline, expectSaved, expectStatus } from "./helpers";

test.describe.configure({ timeout: 120_000 });

test("a stale client is refused, updates, reloads, and its offline edits survive", async ({ page, context }) => {
  // The update banner only shows until the reload; record what was shown,
  // in sessionStorage, which survives the reload.
  await page.addInitScript(() => {
    new MutationObserver(() => {
      const banner = document.querySelector('[data-testid="client-outdated"]');
      if (!banner?.textContent) return;
      const seen: string[] = JSON.parse(sessionStorage.getItem("e2e:banners") ?? "[]");
      if (!seen.includes(banner.textContent)) seen.push(banner.textContent);
      sessionStorage.setItem("e2e:banners", JSON.stringify(seen));
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });

  await signIn(page, uniqueEmail("stale"));
  await createDocument(page);
  await page.getByTestId("title").press("Enter");
  await page.keyboard.type("Before the update.");
  await expectSaved(page);
  await expectReadyOffline(page);

  // Offline, an edit is queued on the device.
  await context.setOffline(true);
  await page.getByTestId("editor").click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" Offline edit.");
  await expectStatus(page, "Saved on this device");

  // The tab now runs an older bundle (an e2e build hook, used once), as a
  // cached tab would after a deployment that changed the document schema.
  await page.evaluate(() => localStorage.setItem("brahma:e2e:schema-version", "0"));
  await page.reload();
  await expect(page.getByTestId("editor")).toContainText("Offline edit.");

  // Back online: the room refuses the old schema, the page updates and reloads.
  const reloaded = page.waitForEvent("load", { timeout: 30_000 });
  await context.setOffline(false);
  await reloaded;

  await expectSaved(page);
  expect(await bodyText(page)).toBe("Before the update. Offline edit.");
  const banners: string[] = await page.evaluate(() => JSON.parse(sessionStorage.getItem("e2e:banners") ?? "[]"));
  expect(banners).toContain("Brahma was updated. Reloading.");

  // The edit really reached the server: a fresh load shows it from there.
  await page.reload();
  await expectSaved(page);
  expect(await bodyText(page)).toBe("Before the update. Offline edit.");
});
