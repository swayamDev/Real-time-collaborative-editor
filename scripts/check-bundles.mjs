// Verifies Yjs is bundled at most once per runtime after `next build`.
//
//   node scripts/check-bundles.mjs [--max-server=N]
//
// Server: Next bundles node_modules into each server entry separately, and
// they all run in one Node process, so any copy beyond one collides. The
// default allows none.
// Client: exactly one chunk may contain Yjs.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// A string that only appears inside the Yjs source.
const MARKER = "Yjs was already imported";

const maxServerArg = process.argv.find((arg) => arg.startsWith("--max-server="));
const maxServer = maxServerArg ? Number(maxServerArg.split("=")[1]) : 0;

function jsFiles(dir) {
  let out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out = out.concat(jsFiles(path));
    else if (name.endsWith(".js")) out.push(path);
  }
  return out;
}

function withYjs(dir) {
  return jsFiles(dir).filter((file) => readFileSync(file, "utf8").includes(MARKER));
}

const server = withYjs(".next/server");
const client = withYjs(".next/static");

console.log(`Yjs in server chunks: ${server.length} (allowed ${maxServer})`);
server.forEach((file) => console.log(`  ${file}`));
console.log(`Yjs in client chunks: ${client.length} (expected 1)`);
client.forEach((file) => console.log(`  ${file}`));

if (server.length > maxServer || client.length !== 1) {
  console.error("Yjs is bundled more than once. See scripts/check-bundles.mjs.");
  process.exit(1);
}
