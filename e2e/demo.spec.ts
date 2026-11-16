import type { Browser, Page } from "@playwright/test";
import { clientAddress } from "./auth";
import { expect, test } from "./fixtures";
import { startSyncServer, stopSyncServer } from "./sync-server";

// Two panes, sometimes two devices and a sync server restart.
test.describe.configure({ timeout: 90_000 });

/** A visitor with no account: no cookies, their own client address. */
async function visitor(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { "x-forwarded-for": clientAddress() },
  });
  return context.newPage();
}

const pane = (page: Page, seat: "a" | "b") => page.getByTestId(`demo-pane-${seat}`);
const body = (page: Page, seat: "a" | "b") => pane(page, seat).locator(".ProseMirror");

/** A pane's text without collaborator caret flags. */
function text(page: Page, seat: "a" | "b"): Promise<string> {
  return body(page, seat).evaluate((element) => {
    const copy = element.cloneNode(true) as HTMLElement;
    copy.querySelectorAll(".collab-caret").forEach((caret) => caret.remove());
    return copy.textContent ?? "";
  });
}

async function expectText(page: Page, seat: "a" | "b", expected: string, timeout = 10_000) {
  await expect.poll(() => text(page, seat), { timeout }).toBe(expected);
}

async function expectSeatSaved(page: Page, seat: "a" | "b") {
  await expect(page.getByTestId(`demo-status-${seat}`)).toHaveAttribute("data-status", "saved", { timeout: 15_000 });
}

async function startDemo(page: Page) {
  await page.goto("/sign-in");
  await page.getByTestId("try-demo").click();
  await expect(page).toHaveURL(/\/demo$/);
  await page.getByRole("button", { name: "Start the demo" }).click();
  await expectSeatSaved(page, "a");
  await expectSeatSaved(page, "b");
}

async function typeIn(page: Page, seat: "a" | "b", text: string) {
  await body(page, seat).click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(text);
}

test("a visitor with no account sees two panes edit live, through the sync server", async ({ browser }) => {
  const page = await visitor(browser);
  await startDemo(page);

  await typeIn(page, "a", "Hello from A.");
  await expectText(page, "b", "Hello from A.");
  await expect(pane(page, "b").locator(".collab-caret-label", { hasText: "Visitor A" })).toBeVisible();

  // The panes share nothing on the page: with the server down, nothing passes.
  await stopSyncServer();
  try {
    await typeIn(page, "a", " Only A.");
    await page.waitForTimeout(1_500);
    expect(await text(page, "b")).toBe("Hello from A.");
  } finally {
    await startSyncServer();
  }
  await expectText(page, "b", "Hello from A. Only A.", 30_000);
  await page.context().close();
});

test("Visitor B goes offline, both type, and the edits merge when B is back", async ({ browser }) => {
  const page = await visitor(browser);
  await startDemo(page);
  await typeIn(page, "a", "Start.");
  await expectText(page, "b", "Start.");

  await pane(page, "b").getByTestId("demo-offline-toggle").click();
  await expect(page.getByTestId("demo-status-b")).toHaveText("Offline");
  await typeIn(page, "a", " From A.");
  await typeIn(page, "b", " From B.");
  await page.waitForTimeout(1_000);
  expect(await text(page, "a")).not.toContain("From B.");

  await pane(page, "b").getByTestId("demo-offline-toggle").click();
  await expectSeatSaved(page, "b");
  for (const seat of ["a", "b"] as const) {
    await expect.poll(() => text(page, seat), { timeout: 15_000 }).toContain("From A.");
    await expect.poll(() => text(page, seat), { timeout: 15_000 }).toContain("From B.");
  }
  expect(await text(page, "a")).toBe(await text(page, "b"));
  await page.context().close();
});

test("the join link makes another device Visitor B, and the seat can come back", async ({ browser }) => {
  const laptop = await visitor(browser);
  await startDemo(laptop);
  await laptop.getByText("Open Visitor B on another device").click();
  const joinUrl = await laptop.getByTestId("demo-join-link").getAttribute("href");
  expect(joinUrl).toContain("/demo/join?pass=");

  const phone = await visitor(browser);
  await phone.goto(new URL(joinUrl!).pathname + new URL(joinUrl!).search);
  await expect(phone).toHaveURL(/\/demo$/);
  await expect(pane(phone, "a")).toHaveCount(0);
  await expectSeatSaved(phone, "b");

  // The laptop's Visitor B steps aside; A and the phone edit together.
  await expect(pane(laptop, "b")).toContainText("Visitor B is open on another device.", { timeout: 15_000 });
  await typeIn(phone, "b", "From the phone.");
  await expectText(laptop, "a", "From the phone.");

  await pane(laptop, "b").getByRole("button", { name: "Use Visitor B here" }).click();
  await expectSeatSaved(laptop, "b");
  await expect(pane(phone, "b")).toContainText("Visitor B is open on another device.", { timeout: 15_000 });
  await laptop.context().close();
  await phone.context().close();
});

test("a join link only ever opens Visitor B, and an altered one opens nothing", async ({ browser }) => {
  const laptop = await visitor(browser);
  await startDemo(laptop);
  await laptop.getByText("Open Visitor B on another device").click();
  const joinUrl = new URL((await laptop.getByTestId("demo-join-link").getAttribute("href"))!);

  // Asking for seat A with the phone's pass is refused by the token route.
  const phone = await visitor(browser);
  await phone.goto(joinUrl.pathname + joinUrl.search);
  const seatA = await phone.request.post("/api/demo/token?seat=a", { headers: { origin: new URL(phone.url()).origin } });
  expect(seatA.status()).toBe(404);

  // A pass edited to claim both seats fails its signature.
  const forged = joinUrl.searchParams.get("pass")!.replace(/\.b\./, ".ab.");
  const other = await visitor(browser);
  await other.goto(`/demo/join?pass=${encodeURIComponent(forged)}`);
  await expect(other.getByTestId("demo-ended")).toBeVisible();
  await laptop.context().close();
  await phone.context().close();
  await other.context().close();
});
