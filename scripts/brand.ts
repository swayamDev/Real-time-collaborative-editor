/**
 * Icons and the link preview image, all from one source: brand/logo.svg.
 *
 *   pnpm brand              rebuild everything in public/ from brand/logo.svg
 *   pnpm brand --monogram   first redraw brand/logo.svg as the temporary
 *                           "B" monogram in Literata (only for the placeholder)
 *
 * The source is a square SVG. Colors come from two classes, so one file
 * serves light and dark: `bg` (the background, paper) and `fg` (the mark,
 * indigo). A real logo can use those classes, or carry its own colors, in
 * which case the dark variant of icon.svg is the same as the light one.
 * Text is drawn as outlines (opentype.js), so no output needs a font.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import opentype from "opentype.js";
import sharp from "sharp";
import { BRAND } from "../src/lib/brand";

const ROOT = join(__dirname, "..");
const SOURCE = join(ROOT, "brand", "logo.svg");
const PUBLIC = join(ROOT, "public");
const FONTS = join(ROOT, "brand", "fonts");

const font = (file: string) => opentype.parse(readFileSync(join(FONTS, file)).buffer as ArrayBuffer);

/** The temporary monogram: a Literata "B", centered, indigo on paper. */
function drawMonogram(): string {
  const literata = font("Literata-Display-SemiBold.ttf");
  const size = 400;
  const path = literata.getPath("B", 0, 0, size);
  const box = path.getBoundingBox();
  const x = (512 - (box.x2 - box.x1)) / 2 - box.x1;
  const y = (512 - (box.y2 - box.y1)) / 2 - box.y1;
  const d = literata.getPath("B", x, y, size).toPathData(2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <!-- Temporary monogram until the real logo. Replace this file and run pnpm brand. -->
  <rect class="bg" width="512" height="512" rx="96"/>
  <path class="fg" d="${d}"/>
</svg>
`;
}

/** The source's viewBox and inner markup. */
function parseSource(svg: string): { viewBox: string; inner: string } {
  const open = svg.match(/<svg\b[^>]*>/);
  if (!open) throw new Error("brand/logo.svg has no <svg> element");
  const viewBox = open[0].match(/viewBox="([^"]+)"/)?.[1] ?? "0 0 512 512";
  const inner = svg.slice(open.index! + open[0].length, svg.lastIndexOf("</svg>"));
  return { viewBox, inner };
}

const colors = (paper: string, indigo: string) => `.bg{fill:${paper}}.fg{fill:${indigo}}`;

/** The source, colored; with `dark`, the dark colors follow the system setting (SVG favicons only). */
function colored(source: { viewBox: string; inner: string }, dark = false): string {
  const style = colors(BRAND.light.paper, BRAND.light.indigo) +
    (dark ? `@media (prefers-color-scheme: dark){${colors(BRAND.dark.paper, BRAND.dark.indigo)}}` : "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${source.viewBox}"><style>${style}</style>${source.inner}</svg>`;
}

/** Full bleed, the mark inside the maskable safe zone (the middle 80 percent). */
function maskable(source: { viewBox: string; inner: string }): string {
  const [, , width] = source.viewBox.split(/\s+/).map(Number);
  const scale = 0.62;
  const offset = (width * (1 - scale)) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${source.viewBox}"><style>${colors(BRAND.light.paper, BRAND.light.indigo)}</style>
<rect width="100%" height="100%" fill="${BRAND.light.paper}"/>
<g transform="translate(${offset} ${offset}) scale(${scale})">${source.inner}</g></svg>`;
}

const png = (svg: string, size: number) =>
  sharp(Buffer.from(svg), { density: 384 }).resize(size, size).flatten({ background: BRAND.light.paper }).png().toBuffer();

/** An .ico holding PNG images (supported by every current browser). */
function ico(images: Array<{ size: number; data: Buffer }>): Buffer {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const entry = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.data)]);
}

/** 1200 x 630: the mark (inverted, as a tile), the name and the pitch. No UI. */
function previewSvg(source: { viewBox: string; inner: string }): string {
  const literata = font("Literata-Display-SemiBold.ttf");
  const grotesk = font("SchibstedGrotesk-Regular.ttf");
  const groteskBold = font("SchibstedGrotesk-SemiBold.ttf");
  const name = literata.getPath(BRAND.name, 96, 388, 120).toPathData(2);
  // Fit the pitch on one line, at most 40 px, within 1000 px.
  const pitchSize = Math.min(40, (1000 / grotesk.getAdvanceWidth(BRAND.pitch, 40)) * 40);
  const pitch = grotesk.getPath(BRAND.pitch, 100, 470, pitchSize).toPathData(2);
  const site = groteskBold.getPath("editor.swayam.space", 100, 552, 30).toPathData(2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<style>${colors(BRAND.light.indigo, BRAND.light.paper)}</style>
<rect width="1200" height="630" fill="${BRAND.light.paper}"/>
<rect x="0" y="0" width="1200" height="12" fill="${BRAND.light.indigo}"/>
<svg x="100" y="96" width="150" height="150" viewBox="${source.viewBox}">${source.inner}</svg>
<path d="${name}" fill="${BRAND.light.ink}"/>
<path d="${pitch}" fill="${BRAND.light.inkMuted}"/>
<path d="${site}" fill="${BRAND.light.indigo}"/>
</svg>`;
}

async function main() {
  if (process.argv.includes("--monogram")) {
    writeFileSync(SOURCE, drawMonogram());
    console.log("Drew brand/logo.svg (temporary monogram)");
  }
  const source = parseSource(readFileSync(SOURCE, "utf8"));
  mkdirSync(join(PUBLIC, "icons"), { recursive: true });

  const light = colored(source);
  writeFileSync(join(PUBLIC, "icon.svg"), colored(source, true));
  const icoImages = await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(light, size) })));
  writeFileSync(join(PUBLIC, "favicon.ico"), ico(icoImages));
  writeFileSync(join(PUBLIC, "apple-touch-icon.png"), await png(light, 180));
  writeFileSync(join(PUBLIC, "icons", "icon-192.png"), await png(light, 192));
  writeFileSync(join(PUBLIC, "icons", "icon-512.png"), await png(light, 512));
  writeFileSync(join(PUBLIC, "icons", "maskable-512.png"), await png(maskable(source), 512));
  writeFileSync(join(PUBLIC, "og.png"), await sharp(Buffer.from(previewSvg(source))).png().toBuffer());
  console.log("Wrote public/favicon.ico, icon.svg, apple-touch-icon.png, icons/*.png and og.png");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
