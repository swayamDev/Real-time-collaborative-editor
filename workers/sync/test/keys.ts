import { env } from "cloudflare:test";

/**
 * The signing key for test tokens. vitest.config.ts generates a fresh
 * Ed25519 pair with WebCrypto on every run and passes the private half in
 * as a test-only binding, so no key is ever stored in the repo.
 */
export function testSigningKey(): { kid: string } & Record<string, string> {
  const raw = (env as unknown as { TEST_SIGNING_KEY?: string }).TEST_SIGNING_KEY;
  if (!raw) throw new Error("TEST_SIGNING_KEY binding missing; run the tests through vitest.config.ts");
  return JSON.parse(raw) as { kid: string } & Record<string, string>;
}
