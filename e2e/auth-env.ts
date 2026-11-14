import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Secrets for end-to-end runs: an auth secret and an Ed25519 key pair for
 * sync tokens. Generated on first use into playwright/.cache (gitignored),
 * so no key is ever stored in the repo, and shared by every Playwright
 * process (config, global setup, workers) through that file.
 */
export interface E2eAuthEnv {
  authSecret: string;
  privateJwk: string;
  publicKeys: string;
}

// Not in test-results: Playwright empties that folder at the start of a run,
// after the config (and with it the web server's env) has been read.
const FILE = join(__dirname, "..", "playwright", ".cache", "e2e-auth.json");
const KID = "e2e";

export function e2eAuthEnv(): E2eAuthEnv {
  if (existsSync(FILE)) return JSON.parse(readFileSync(FILE, "utf8")) as E2eAuthEnv;
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const env: E2eAuthEnv = {
    authSecret: randomBytes(32).toString("base64url"),
    privateJwk: JSON.stringify({ ...privateKey.export({ format: "jwk" }), kid: KID }),
    publicKeys: JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: KID, alg: "EdDSA", use: "sig" }] }),
  };
  mkdirSync(join(FILE, ".."), { recursive: true });
  writeFileSync(FILE, JSON.stringify(env));
  return env;
}
