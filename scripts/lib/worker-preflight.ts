/**
 * Production preflight for the sync Worker: the production environment in
 * wrangler.jsonc serves only the production origin, its schema bounds are
 * sane, and every secret is set (names only; values are never read).
 */
import { PRODUCTION_ORIGIN } from "../../src/lib/preflight";

export const REQUIRED_WORKER_SECRETS = ["DATABASE_URL", "SYNC_INTERNAL_SECRET", "SYNC_TOKEN_PUBLIC_KEYS", "SENTRY_DSN"];

/** JSON with comments, as wrangler reads it: comments go, strings stay intact. */
export function parseJsonc(text: string): unknown {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      out += char;
      if (char === "\\") out += text[++i] ?? "";
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
      out += char;
    } else if (char === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (char === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else {
      out += char;
    }
  }
  // Trailing commas are allowed in JSONC.
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

interface WranglerConfig {
  env?: { production?: { name?: string; vars?: Record<string, string> } };
}

export function checkWorkerConfig(config: WranglerConfig, secretNames: readonly string[] | null): string[] {
  const problems: string[] = [];
  const production = config.env?.production;
  if (!production) return ["wrangler.jsonc has no env.production."];
  if (production.name !== "brahma-sync") problems.push('env.production.name must be "brahma-sync".');

  const vars = production.vars ?? {};
  const origins = (vars.ALLOWED_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);
  if (origins.length !== 1 || origins[0] !== PRODUCTION_ORIGIN) {
    problems.push(`env.production ALLOWED_ORIGINS must be exactly ${PRODUCTION_ORIGIN} (got ${JSON.stringify(vars.ALLOWED_ORIGINS ?? "")}).`);
  }
  const min = Number(vars.SCHEMA_VERSION_MIN);
  const max = Number(vars.SCHEMA_VERSION_MAX);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || min > max) {
    problems.push("env.production SCHEMA_VERSION_MIN and SCHEMA_VERSION_MAX must be integers with 1 <= MIN <= MAX.");
  }
  if (vars.TOKEN_GRACE_SECONDS !== undefined) problems.push("TOKEN_GRACE_SECONDS is a test setting; leave it unset in production.");

  if (secretNames !== null) {
    for (const name of REQUIRED_WORKER_SECRETS) {
      if (!secretNames.includes(name)) problems.push(`Worker secret ${name} is not set (wrangler secret put ${name} --env production).`);
    }
  }
  return problems;
}
