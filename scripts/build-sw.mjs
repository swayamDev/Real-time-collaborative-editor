// Writes public/sw.js after `next build`: the service worker template with
// the build id (cache version) and every hashed static file to precache.
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

const buildId = readFileSync(".next/BUILD_ID", "utf8").trim();

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const precache = files(".next/static")
  .filter((path) => !path.endsWith(".map"))
  .map((path) => `/_next/static/${relative(".next/static", path).split(sep).join("/")}`);

const source = readFileSync("sw/sw.template.js", "utf8")
  .replace("__BUILD_ID__", buildId)
  .replace("__PRECACHE__", JSON.stringify(precache));

mkdirSync("public", { recursive: true });
writeFileSync("public/sw.js", source);
console.log(`Service worker: version ${buildId}, ${precache.length} static files.`);
