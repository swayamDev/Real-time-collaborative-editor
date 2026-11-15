import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REQUIRED_WORKER_SECRETS, checkWorkerConfig, parseJsonc } from "./worker-preflight";

const repoConfig = () => parseJsonc(readFileSync(join(__dirname, "..", "..", "workers", "sync", "wrangler.jsonc"), "utf8"));

describe("parseJsonc", () => {
  it("drops comments but keeps // inside strings", () => {
    expect(parseJsonc('{ // note\n "url": "https://a.example//x", /* block */ "n": 1, }')).toEqual({
      url: "https://a.example//x",
      n: 1,
    });
  });
});

describe("worker preflight", () => {
  it("accepts the repository's production environment when every secret is set", () => {
    expect(checkWorkerConfig(repoConfig() as never, REQUIRED_WORKER_SECRETS)).toEqual([]);
  });

  it("names each missing secret", () => {
    const problems = checkWorkerConfig(repoConfig() as never, ["DATABASE_URL"]);
    expect(problems).toHaveLength(REQUIRED_WORKER_SECRETS.length - 1);
    expect(problems.join("\n")).toMatch(/SYNC_TOKEN_PUBLIC_KEYS/);
  });

  it.each([
    ["no production environment", {}, /env.production/],
    ["localhost origins", { env: { production: { name: "brahma-sync", vars: { ALLOWED_ORIGINS: "https://editor.swayam.space,http://localhost:3000", SCHEMA_VERSION_MIN: "1", SCHEMA_VERSION_MAX: "1" } } } }, /ALLOWED_ORIGINS/],
    ["another origin", { env: { production: { name: "brahma-sync", vars: { ALLOWED_ORIGINS: "https://brahma.swayam.space", SCHEMA_VERSION_MIN: "1", SCHEMA_VERSION_MAX: "1" } } } }, /ALLOWED_ORIGINS/],
    ["MIN above MAX", { env: { production: { name: "brahma-sync", vars: { ALLOWED_ORIGINS: "https://editor.swayam.space", SCHEMA_VERSION_MIN: "2", SCHEMA_VERSION_MAX: "1" } } } }, /SCHEMA_VERSION/],
    ["a test grace setting", { env: { production: { name: "brahma-sync", vars: { ALLOWED_ORIGINS: "https://editor.swayam.space", SCHEMA_VERSION_MIN: "1", SCHEMA_VERSION_MAX: "1", TOKEN_GRACE_SECONDS: "0" } } } }, /TOKEN_GRACE_SECONDS/],
    ["the wrong Worker name", { env: { production: { name: "brahma-sync-dev", vars: { ALLOWED_ORIGINS: "https://editor.swayam.space", SCHEMA_VERSION_MIN: "1", SCHEMA_VERSION_MAX: "1" } } } }, /name/],
  ])("refuses %s", (_label, config, message) => {
    expect(checkWorkerConfig(config as never, REQUIRED_WORKER_SECRETS).join("\n")).toMatch(message);
  });
});
