import type { APIRequestContext, Browser, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { createDocument, setTitle } from "./helpers";

/** A browser with no session: what a crawler or a first-time visitor gets. */
async function signedOut(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  return context.newPage();
}

/** Width and height from a PNG's IHDR chunk. */
function pngSize(bytes: Buffer): { width: number; height: number } {
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function fetchOk(request: APIRequestContext, path: string, type: RegExp) {
  const response = await request.get(path, { maxRedirects: 0 });
  expect(response.status(), path).toBe(200);
  expect(response.headers()["content-type"], path).toMatch(type);
  return response;
}

const meta = (page: Page, key: string) =>
  page.locator(`meta[property="${key}"], meta[name="${key}"]`).first().getAttribute("content");

test("icons, the manifest and the preview image are served to anyone, at their sizes", async ({ browser }) => {
  const page = await signedOut(browser);
  const { request } = page.context();

  const ico = await (await fetchOk(request, "/favicon.ico", /icon/)).body();
  expect(ico.readUInt16LE(2)).toBe(1); // an icon file
  expect(ico.readUInt16LE(4)).toBe(3); // 16, 32 and 48 px
  const svg = await (await fetchOk(request, "/icon.svg", /svg/)).text();
  expect(svg).toContain("prefers-color-scheme: dark");

  for (const [path, size] of [
    ["/apple-touch-icon.png", 180],
    ["/icons/icon-192.png", 192],
    ["/icons/icon-512.png", 512],
    ["/icons/maskable-512.png", 512],
  ] as const) {
    expect(pngSize(await (await fetchOk(request, path, /png/)).body())).toEqual({ width: size, height: size });
  }
  expect(pngSize(await (await fetchOk(request, "/og.png", /png/)).body())).toEqual({ width: 1200, height: 630 });

  const manifest = await (await fetchOk(request, "/manifest.webmanifest", /json/)).json();
  expect(manifest).toMatchObject({ name: "Brahma", short_name: "Brahma", start_url: "/", scope: "/", display: "standalone" });
  expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/);
  expect(manifest.icons.map((icon: { purpose: string; sizes: string }) => `${icon.purpose} ${icon.sizes}`)).toEqual([
    "any 192x192",
    "any 512x512",
    "maskable 512x512",
  ]);
  for (const icon of manifest.icons as Array<{ src: string }>) await fetchOk(request, icon.src, /png/);
  await page.context().close();
});

test("pages link the icons and manifest, and carry link preview metadata", async ({ browser }) => {
  const page = await signedOut(browser);
  await page.goto("/sign-in");
  await expect(page).toHaveTitle("Sign in · Brahma");
  await expect(page.locator('link[rel="icon"][href^="/favicon.ico"]')).toHaveCount(1);
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveCount(1);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
  expect(await meta(page, "og:image")).toMatch(/\/og\.png$/);
  expect(await meta(page, "og:image:width")).toBe("1200");
  expect(await meta(page, "twitter:card")).toBe("summary_large_image");
  expect(await meta(page, "og:title")).toBe("Brahma");

  await page.goto("/demo");
  await expect(page).toHaveTitle("Try the demo · Brahma");
  expect(await meta(page, "og:title")).toBe("Try the Brahma demo");
  expect(await meta(page, "og:description")).toContain("No account needed");
  expect(await meta(page, "robots")).toContain("noindex");

  await page.goto("/privacy");
  await expect(page).toHaveTitle("Privacy policy · Brahma");
  expect(await meta(page, "og:description")).toContain("how to have it deleted");
  await page.context().close();
});

test("a document's title names its tab but never reaches the link preview", async ({ page }) => {
  await createDocument(page);
  await setTitle(page, "Q3 planning notes");
  // The server's copy of the title follows the sync server's next snapshot.
  await expect
    .poll(
      async () => {
        await page.reload();
        return page.title();
      },
      { timeout: 20_000, intervals: [1_000] },
    )
    .toBe("Q3 planning notes · Brahma");
  for (const key of ["og:title", "og:description", "twitter:title", "twitter:description", "description"]) {
    expect(await meta(page, key), key).not.toContain("Q3 planning notes");
  }
});

test("robots.txt allows the public pages and nothing that needs an account", async ({ browser }) => {
  const page = await signedOut(browser);
  const robots = await (await fetchOk(page.context().request, "/robots.txt", /text\/plain/)).text();
  for (const line of ["User-Agent: *", "Allow: /sign-in", "Allow: /demo$", "Allow: /privacy", "Allow: /og.png", "Disallow: /", "Disallow: /api/"]) {
    expect(robots).toContain(line);
  }
  expect(robots).not.toMatch(/Allow: \/d\//);
  await page.context().close();
});

test("an unknown address shows the 404 page with a way back", async ({ page }) => {
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(page).toHaveTitle("Page not found · Brahma");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("This page doesn't exist.");
  await page.getByTestId("way-back").click();
  // The first visit to the app after a fresh start can take a few seconds.
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
});
