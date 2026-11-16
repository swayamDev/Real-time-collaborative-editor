import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND } from "./brand";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

/** The value of a token in the first block that starts with `selector`. */
function token(selector: string, name: string): string {
  const start = css.indexOf(selector);
  const block = css.slice(start, css.indexOf("}", start));
  const match = block.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`--${name} not found in ${selector}`);
  return match[1].trim().toLowerCase();
}

describe("brand colors", () => {
  it("match the design tokens, light and dark", () => {
    expect(BRAND.light.paper).toBe(token(':root[data-theme="light"]', "paper"));
    expect(BRAND.light.indigo).toBe(token(':root[data-theme="light"]', "indigo"));
    expect(BRAND.light.ink).toBe(token(':root[data-theme="light"]', "ink"));
    expect(BRAND.light.inkMuted).toBe(token(':root[data-theme="light"]', "ink-muted"));
    expect(BRAND.dark.paper).toBe(token(':root[data-theme="dark"]', "paper"));
    expect(BRAND.dark.indigo).toBe(token(':root[data-theme="dark"]', "indigo"));
  });

  it("uses no em dashes in public copy", () => {
    for (const text of [BRAND.pitch, BRAND.description]) expect(text).not.toContain(String.fromCharCode(0x2014));
  });
});
