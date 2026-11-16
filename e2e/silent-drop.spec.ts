import type { Page, WebSocketRoute } from "@playwright/test";
import { signIn, uniqueEmail } from "./auth";
import { expect, test } from "./fixtures";
import { bodyText, caretAtEnd, createDocument, expectSaved } from "./helpers";

test.describe.configure({ timeout: 90_000 });

/**
 * Route the page's sync sockets through Playwright, forwarding both ways.
 * For the first socket only, close handlers on both sides stop Playwright
 * forwarding a close from one side to the other: closing the page's side
 * then leaves the server's socket open with no close frame, as a phone in
 * airplane mode does. Later sockets forward closes as usual, so the page
 * sees whatever the room decides about the reconnect.
 */
async function routeSync(page: Page): Promise<WebSocketRoute[]> {
  const routes: WebSocketRoute[] = [];
  await page.routeWebSocket(/\/documents\//, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => server.send(message));
    server.onMessage((message) => ws.send(message));
    if (routes.length === 0) {
      ws.onClose(() => {});
      server.onClose(() => {});
    }
    routes.push(ws);
  });
  return routes;
}

test("a connection that drops without a close frame reconnects and keeps syncing (airplane mode)", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, uniqueEmail("phone"));
  const routes = await routeSync(page);
  await createDocument(page);
  await page.getByTestId("title").press("Enter");
  await page.keyboard.type("Before the drop.");
  await expectSaved(page);
  expect(routes.length).toBeGreaterThan(0);

  // The page's socket closes; the room's socket for it stays open.
  expect(routes).toHaveLength(1);
  await routes[0].close({ code: 1001, reason: "Network lost" });
  await caretAtEnd(page);
  await page.keyboard.type(" After the drop.");

  // The reconnect reuses the tab's presence id, which the room still
  // assigns to the vanished socket. It must not halt.
  await expectSaved(page);
  await expect(page.getByTestId("sync-halted")).toHaveCount(0);
  await page.reload();
  await expectSaved(page);
  expect(await bodyText(page)).toBe("Before the drop. After the drop.");
  await context.close();
});

test("halted with an unsynced edit: Try again syncs it, and sign-out warns before deleting it", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, uniqueEmail("halted"));
  let refuse = false;
  await page.routeWebSocket(/\/documents\//, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      // While refusing: hold the page's messages back, then close as the room
      // does for a policy violation (1008), which halts the document.
      if (refuse) {
        void ws.close({ code: 1008, reason: "Refused" });
        return;
      }
      server.send(message);
    });
    server.onMessage((message) => ws.send(message));
  });
  await createDocument(page);
  await page.getByTestId("title").press("Enter");
  await page.keyboard.type("Synced.");
  await expectSaved(page);

  refuse = true;
  await caretAtEnd(page);
  await page.keyboard.type(" Unsynced.");
  const halted = page.getByTestId("sync-halted");
  await expect(halted).toBeVisible({ timeout: 15_000 });

  // Still halted after a reload: the edit stays on the device.
  await page.reload();
  await expect(halted).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("editor")).toContainText("Synced. Unsynced.");

  // Sign-out warns before deleting the unsynced edit; cancelling keeps it.
  await page.getByTestId("account-menu").click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  const dialog = page.getByRole("dialog", { name: "Sign out?" });
  await expect(dialog).toContainText("Some edits on this device haven't synced yet.");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();

  // Try again: the edit reaches the server and the halt is gone, for good.
  refuse = false;
  await halted.getByRole("button", { name: "Try again" }).click();
  await expectSaved(page);
  await expect(halted).toHaveCount(0);
  await page.reload();
  await expectSaved(page);
  await expect(halted).toHaveCount(0);
  expect(await bodyText(page)).toBe("Synced. Unsynced.");
  await context.close();
});
