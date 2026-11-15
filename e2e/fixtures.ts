import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { type BrowserContext, type Page, test as base } from "@playwright/test";
import pg from "pg";
import { clientAddress, signIn, uniqueEmail } from "./auth";
import { databaseUrl, ensureSyncServer } from "./sync-server";

export { expect } from "@playwright/test";

/** A signed-in person for the tests: their session is saved and reused. */
export interface Account {
  name: string;
  email: string;
  storageState: string;
}

export interface Accounts {
  ada: Account;
  grace: Account;
}

const VIEWPORT = { width: 1280, height: 800 };

/** Sign a new account in through the real magic-link flow and save its session. */
async function createAccount(
  browser: import("@playwright/test").Browser,
  baseURL: string | undefined,
  name: string,
  dir: string,
): Promise<Account> {
  const email = uniqueEmail(name.toLowerCase());
  const context = await browser.newContext({ viewport: VIEWPORT, baseURL });
  const page = await context.newPage();
  await signIn(page, email);
  // A readable display name for presence assertions (a magic-link sign-up has none).
  const client = new pg.Client({ connectionString: databaseUrl() });
  await client.connect();
  await client.query('UPDATE "user" SET name = $1 WHERE email = $2', [name, email]);
  await client.end();
  const storageState = join(dir, `${name.toLowerCase()}.json`);
  await context.storageState({ path: storageState });
  await context.close();
  return { name, email, storageState };
}

export const test = base.extend<
  {
    syncServer: void;
    /** A new browser context (another device) signed in as `account`. */
    contextAs: (account: Account) => Promise<BrowserContext>;
    /** A page in a new context signed in as `account`. */
    openAs: (account: Account) => Promise<Page>;
  },
  { accounts: Accounts }
>({
  // Two people per Playwright worker, signed in once through real email links.
  accounts: [
    async ({ browser }, provide, workerInfo) => {
      const dir = join(__dirname, "..", "playwright", ".cache", `accounts-${workerInfo.workerIndex}-${Date.now()}`);
      mkdirSync(dir, { recursive: true });
      // Worker fixtures do not get the test's baseURL option; read it from the project.
      const baseURL = workerInfo.project.use.baseURL;
      await provide({
        ada: await createAccount(browser, baseURL, "Ada", dir),
        grace: await createAccount(browser, baseURL, "Grace", dir),
      });
    },
    { scope: "worker", timeout: 120_000 },
  ],

  // The default page is Ada's.
  storageState: async ({ accounts }, provide) => {
    await provide(accounts.ada.storageState);
  },

  // Each context is its own client address (trusted in end-to-end runs, see
  // playwright.config.ts), so per-address auth limits such as get-session's
  // 100 a minute apply per test, as they would per person, not to the suite.
  extraHTTPHeaders: async ({}, provide) => {
    await provide({ "x-forwarded-for": clientAddress() });
  },

  contextAs: async ({ browser, baseURL }, provide) => {
    const opened: BrowserContext[] = [];
    await provide(async (account) => {
      const context = await browser.newContext({
        viewport: VIEWPORT,
        baseURL,
        storageState: account.storageState,
        extraHTTPHeaders: { "x-forwarded-for": clientAddress() },
      });
      opened.push(context);
      return context;
    });
    for (const context of opened) await context.close();
  },

  openAs: async ({ contextAs }, provide) => {
    await provide(async (account) => (await contextAs(account)).newPage());
  },

  /**
   * Every test starts with a healthy sync server. Global setup starts one,
   * but a test may stop it, and Playwright restarts its worker process (and
   * with it any server that worker spawned) after a failure.
   */
  syncServer: [
    async ({}, provide) => {
      await ensureSyncServer();
      await provide();
    },
    { auto: true, timeout: 90_000 },
  ],
});
