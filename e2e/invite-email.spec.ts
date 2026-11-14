import { signIn, uniqueEmail } from "./auth";
import { expect, test } from "./fixtures";
import { createDocument } from "./helpers";

test("the owner is told when an invite email could not be sent, and can copy the link", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await signIn(page, uniqueEmail("owner"));
  const documentId = await createDocument(page);

  await page.getByTestId("share-button").click();
  const dialog = page.getByTestId("share-dialog");
  // The test email transport never delivers to undeliverable.test.
  const invitee = `friend-${Date.now()}@undeliverable.test`;
  await dialog.getByPlaceholder("Email address").fill(invitee);
  await dialog.getByRole("button", { name: "Invite", exact: true }).click();

  const notice = dialog.getByTestId("invite-email-failed");
  await expect(notice).toHaveText(
    /Invite saved, but the email couldn't be sent\. Send them the document link directly\./,
  );
  // The invite was still saved.
  await expect(dialog.locator(`[data-testid="share-invite"][data-email="${invitee}"]`)).toBeVisible();

  await notice.getByRole("button", { name: "Copy link" }).click();
  await expect(notice.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`http://localhost:3100/d/${documentId}`);

  // A later invite that is delivered clears the notice.
  await dialog.getByPlaceholder("Email address").fill(uniqueEmail("delivered"));
  await dialog.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(notice).toHaveCount(0);
});
