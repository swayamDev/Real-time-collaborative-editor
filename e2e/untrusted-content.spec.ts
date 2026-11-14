import { CONTENT_FIELD, TITLE_FIELD, encodeUpdate, schemaSubprotocol } from "@brahma/protocol";
import type { Browser, Page } from "@playwright/test";
import * as Y from "yjs";
import { DOCUMENT_SCHEMA_VERSION } from "../src/components/editor/schema-version";
import { signIn, uniqueEmail } from "./auth";
import { expect, test } from "./fixtures";
import { createDocument, expectSaved } from "./helpers";
import { SYNC_PORT } from "./sync-server";

test.describe.configure({ timeout: 120_000 });

/** Raw Yjs content a malicious editor can send without going through the editor. */
function hostileUpdate(): Uint8Array {
  const doc = new Y.Doc();
  doc.getText(TITLE_FIELD).insert(0, "<img src=x onerror=alert('title')>");
  const paragraph = (text: Y.XmlText) => {
    const element = new Y.XmlElement("paragraph");
    element.insert(0, [text]);
    return element;
  };
  const link = new Y.XmlText();
  link.insert(0, "click me", { link: { href: "javascript:alert('link')", onclick: "alert('attr')" } });
  const handler = paragraph(new Y.XmlText("plain text"));
  handler.setAttribute("onmouseover", "alert('paragraph')");
  const image = new Y.XmlElement("img");
  image.setAttribute("src", "x");
  image.setAttribute("onerror", "alert('img')");
  const unknownMark = new Y.XmlText();
  unknownMark.insert(0, "odd mark", { evil: { onclick: "alert('mark')" } });
  doc.getXmlFragment(CONTENT_FIELD).insert(0, [paragraph(link), handler, image, paragraph(unknownMark)]);
  return Y.encodeStateAsUpdate(doc);
}

async function account(browser: Browser, name: string): Promise<{ page: Page; email: string }> {
  const page = await (await browser.newContext()).newPage();
  const email = uniqueEmail(name);
  await signIn(page, email);
  return { page, email };
}

async function share(owner: Page, email: string, role: "editor" | "viewer"): Promise<void> {
  await owner.getByTestId("share-button").click();
  const dialog = owner.getByTestId("share-dialog");
  await dialog.getByPlaceholder("Email address").fill(email);
  await dialog.getByRole("combobox", { name: "Role for the invite" }).selectOption(role);
  await dialog.getByRole("button", { name: "Invite" }).click();
  await expect(dialog.locator(`[data-testid="share-member"][data-email="${email}"]`)).toBeVisible();
  await owner.keyboard.press("Escape");
}

/** Send a raw update over the sync protocol as `page`'s user, bypassing the editor. */
async function sendRaw(page: Page, documentId: string, update: Uint8Array): Promise<void> {
  const { token } = await page.evaluate(
    (id) => fetch(`/api/documents/${id}/sync-token`, { method: "POST" }).then((response) => response.json()),
    documentId,
  );
  // A malicious client can claim the current schema version; the version
  // check protects honest stale clients, not against attackers.
  const socket = new WebSocket(`ws://localhost:${SYNC_PORT}/documents/${documentId}`, [
    "brahma.v1",
    schemaSubprotocol(DOCUMENT_SCHEMA_VERSION),
    `auth.${token}`,
  ]);
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => resolve();
    socket.onerror = () => reject(new Error("socket failed"));
  });
  socket.send(encodeUpdate(update));
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  socket.close();
}

async function expectNothingUnsafe(page: Page): Promise<void> {
  const editor = page.getByTestId("editor");
  await expect(editor).toContainText("click me");
  const report = await editor.evaluate((element) => ({
    handlers: [...element.querySelectorAll("*")].flatMap((node) =>
      node.getAttributeNames().filter((name) => name.toLowerCase().startsWith("on")),
    ),
    images: element.querySelectorAll("img").length,
    hrefs: [...element.querySelectorAll("a")].map((link) => link.getAttribute("href") ?? ""),
  }));
  expect(report.handlers).toEqual([]);
  expect(report.images).toBe(0);
  for (const href of report.hrefs) expect(href === "" || /^(https?|mailto):/.test(href)).toBe(true);
  // The title is plain text in a textarea, never markup.
  await expect(page.getByTestId("title")).toHaveValue("<img src=x onerror=alert('title')>");
}

test("raw Yjs content from a collaborator never runs, and nobody's editor breaks", async ({ browser }) => {
  const mallory = await account(browser, "mallory");
  const vera = await account(browser, "vera");
  const ada = await account(browser, "ada");
  const documentId = await createDocument(ada.page);
  await ada.page.getByTestId("title").press("Enter");
  await ada.page.keyboard.type("Ada wrote this.");
  await expectSaved(ada.page);
  await share(ada.page, mallory.email, "editor");
  await share(ada.page, vera.email, "viewer");
  await vera.page.goto(`/d/${documentId}`);
  await expect(vera.page.getByTestId("sync-status")).toHaveAttribute("data-status", "saved", { timeout: 15_000 });

  const dialogs: string[] = [];
  for (const page of [ada.page, vera.page]) {
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });
  }

  await mallory.page.goto(`/d/${documentId}`);
  await sendRaw(mallory.page, documentId, hostileUpdate());

  for (const page of [ada.page, vera.page]) {
    await expectNothingUnsafe(page);
    // Hover and click everything that could carry a handler or a link.
    await page.getByTestId("editor").getByText("click me").click({ modifiers: ["ControlOrMeta"] });
    await page.getByTestId("editor").getByText("plain text").hover();
    await expect(page.getByTestId("sync-status")).toHaveAttribute("data-status", "saved");
  }
  expect(dialogs).toEqual([]);

  // The viewer was not sent through downgrade handling by anything the editor binding did.
  await expect(vera.page.getByTestId("access-downgraded")).toHaveCount(0);
  await expect(vera.page.getByTestId("view-only")).toBeVisible();

  // The owner keeps editing, and the viewer sees it.
  await ada.page.getByTestId("editor").getByText("Ada wrote this.").click();
  await ada.page.keyboard.press("End");
  await ada.page.keyboard.type(" Still editing.");
  await expectSaved(ada.page);
  await expect(vera.page.getByTestId("editor")).toContainText("Still editing.");
  expect(dialogs).toEqual([]);
});
