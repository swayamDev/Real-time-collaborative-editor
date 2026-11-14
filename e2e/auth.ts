import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type Page, expect } from "@playwright/test";

/** The file email transport writes each message here (see src/server/email.ts). */
const OUTBOX = join(__dirname, "..", "test-results", "outbox");

/** A fresh address, so every test starts with a new account. */
export function uniqueEmail(name: string): string {
  return `${name}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.test`;
}

async function magicLink(email: string): Promise<string> {
  const file = join(OUTBOX, `${email.toLowerCase()}.txt`);
  let link: string | undefined;
  await expect
    .poll(
      () => {
        if (!existsSync(file)) return false;
        link = readFileSync(file, "utf8").match(/https?:\/\/\S+\/api\/auth\/magic-link\/verify\S+/g)?.at(-1);
        return Boolean(link);
      },
      { timeout: 15_000, message: `magic link for ${email}` },
    )
    .toBe(true);
  return link!;
}

/** A random private address, so no two sign-ins (even across runs) share one. */
function clientAddress(): string {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  return `10.${octet()}.${octet()}.${octet()}`;
}

/**
 * Sign in through the real magic-link flow, reading the email from the
 * outbox. Each sign-in comes from its own client address, as different
 * people would, so the sign-in rate limit (per address) applies per test
 * rather than to the whole suite.
 */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.context().setExtraHTTPHeaders({ "x-forwarded-for": clientAddress() });
  rmSync(join(OUTBOX, `${email.toLowerCase()}.txt`), { force: true });
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByTestId("magic-link-sent")).toBeVisible();
  await page.goto(await magicLink(email));
  await expect(page.getByTestId("account-menu")).toBeVisible({ timeout: 30_000 });
}
