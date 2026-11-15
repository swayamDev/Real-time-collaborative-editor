// Runs before `wrangler deploy --env production`. Refuses to deploy unless
// the production environment in wrangler.jsonc is correct and every secret
// is set. Listing secrets needs Cloudflare credentials (CLOUDFLARE_API_TOKEN
// in CI, or `wrangler login` by hand); --skip-secrets checks the config only.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkWorkerConfig, parseJsonc } from "./lib/worker-preflight";

const workerDir = join(__dirname, "..", "workers", "sync");
const config = parseJsonc(readFileSync(join(workerDir, "wrangler.jsonc"), "utf8"));

let secretNames: string[] | null = null;
if (!process.argv.includes("--skip-secrets")) {
  const output = execFileSync(
    process.execPath,
    [join(workerDir, "node_modules", "wrangler", "bin", "wrangler.js"), "secret", "list", "--env", "production", "--format", "json"],
    { cwd: workerDir, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  secretNames = (JSON.parse(output) as Array<{ name: string }>).map((secret) => secret.name);
}

const problems = checkWorkerConfig(config as never, secretNames);
if (problems.length > 0) {
  console.error(`Worker preflight refused this deploy:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
  process.exit(1);
}
console.log(`Worker preflight: ready${secretNames === null ? " (secrets not checked)" : ""}.`);
