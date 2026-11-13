import { expect, test } from "@playwright/test";
import { createDocument, expectSaved, mod, setTitle, uniqueTitle } from "./helpers";

test("formatted content typed with markdown shortcuts persists after reload", async ({ page }) => {
  await createDocument(page);
  const title = uniqueTitle("Formatting");
  await setTitle(page, title);

  await page.getByTestId("title").press("Enter");
  const k = page.keyboard;
  await k.type("# Heading one");
  await k.press("Enter");
  await k.type("## Heading two");
  await k.press("Enter");
  await k.type("### Heading three");
  await k.press("Enter");
  await k.type("Some **bold** and *italic* and ~~gone~~ and `inline` text.");
  await k.press("Enter");
  await k.type("- First bullet");
  await k.press("Enter");
  await k.press("Enter");
  await k.type("1. First number");
  await k.press("Enter");
  await k.press("Enter");
  await k.type("[ ] A task");
  await k.press("Enter");
  await k.press("Enter");
  await k.type("> A quote");
  await k.press("Enter");
  await k.press("Enter");
  await k.type("---");
  await k.type("```");
  await k.press("Enter");
  await k.type("const answer = 42;");

  await expectSaved(page);
  await page.reload();

  const editor = page.getByTestId("editor");
  await expect(page.getByTestId("title")).toHaveValue(title);
  await expect(editor.locator("h1")).toHaveText("Heading one");
  await expect(editor.locator("h2")).toHaveText("Heading two");
  await expect(editor.locator("h3")).toHaveText("Heading three");
  await expect(editor.locator("strong")).toHaveText("bold");
  await expect(editor.locator("em")).toHaveText("italic");
  await expect(editor.locator("s")).toHaveText("gone");
  await expect(editor.locator("p code")).toHaveText("inline");
  await expect(editor.locator("ul:not([data-type]) > li")).toHaveText("First bullet");
  await expect(editor.locator("ol > li")).toHaveText("First number");
  await expect(editor.locator('ul[data-type="taskList"] > li > div')).toHaveText("A task");
  await expect(editor.locator("blockquote")).toHaveText("A quote");
  await expect(editor.locator("hr")).toHaveCount(1);
  await expect(editor.locator("pre code")).toHaveText("const answer = 42;");
});

test("floating toolbar formats a selection and adds a link", async ({ page }) => {
  await createDocument(page);
  await page.getByTestId("title").press("Enter");
  await page.keyboard.type("Make this bold and link here");

  const toolbar = page.getByTestId("bubble-toolbar");
  await expect(toolbar).toBeHidden();

  // Select the first word.
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  for (let i = 0; i < "this bold and link here".length + 1; i++) {
    await page.keyboard.press("Shift+ArrowLeft");
  }
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole("button", { name: "Bold" }).click();
  await expect(page.getByTestId("editor").locator("strong")).toHaveText("Make");
  await expect(toolbar.getByRole("button", { name: "Bold" })).toHaveAttribute("aria-pressed", "true");

  // Select the last word with the keyboard and link it with Mod+K.
  await page.keyboard.press("End");
  for (let i = 0; i < "here".length; i++) {
    await page.keyboard.press("Shift+ArrowLeft");
  }
  await page.keyboard.press(`${mod}+k`);
  const field = toolbar.getByRole("textbox", { name: "Link address" });
  await expect(field).toBeFocused();
  await field.fill("example.com");
  await field.press("Enter");

  const link = page.getByTestId("editor").locator("a");
  await expect(link).toHaveText("here");
  await expect(link).toHaveAttribute("href", "https://example.com");

  await expectSaved(page);
  await page.reload();
  await expect(page.getByTestId("editor").locator("a")).toHaveAttribute("href", "https://example.com");
});

test("block type menu turns a paragraph into a heading", async ({ page }) => {
  await createDocument(page);
  await page.getByTestId("title").press("Enter");
  await page.keyboard.type("Promote me");
  await page.keyboard.press("Shift+Home");

  const toolbar = page.getByTestId("bubble-toolbar");
  await toolbar.getByRole("button", { name: "Block type: Text" }).click();
  await page.getByRole("menuitemradio", { name: "Heading 2" }).click();
  await expect(page.getByTestId("editor").locator("h2")).toHaveText("Promote me");
  await expectSaved(page);
});
