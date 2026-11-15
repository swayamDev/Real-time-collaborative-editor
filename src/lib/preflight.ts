/**
 * Production preflight for the app: every required variable, and no
 * development-only setting. Used by scripts/preflight-app.ts before
 * `next build` on Vercel, and by src/instrumentation.ts when the server
 * starts, so a misconfigured deployment refuses to run instead of running
 * insecurely. No imports, so both can load it.
 */

/** The one origin production serves. */
export const PRODUCTION_ORIGIN = "https://editor.swayam.space";

type Env = Record<string, string | undefined>;

const REQUIRED = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "EMAIL_TRANSPORT",
  "RESEND_API_KEY",
  "EMAIL_FROM",
  "SYNC_TOKEN_PRIVATE_KEY",
  "SYNC_INTERNAL_URL",
  "SYNC_INTERNAL_SECRET",
  "NEXT_PUBLIC_SYNC_URL",
  "NEXT_PUBLIC_SENTRY_DSN",
] as const;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

function url(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isLocal(value: URL): boolean {
  return LOCAL_HOSTS.has(value.hostname) || value.hostname.endsWith(".local");
}

/** A secret long enough, and not one of the example placeholders. */
function checkSecret(env: Env, name: string, problems: string[]): void {
  const value = env[name];
  if (!value) return;
  if (value.length < 32) problems.push(`${name} must be at least 32 characters (openssl rand -base64 32).`);
  if (/change-me|example|placeholder/i.test(value)) problems.push(`${name} is the example placeholder.`);
}

/** Every problem with this environment for production; empty when it is ready. */
export function checkProductionEnvironment(env: Env): string[] {
  const problems: string[] = [];
  for (const name of REQUIRED) {
    if (!env[name]?.trim()) problems.push(`${name} is not set.`);
  }

  if (env.BETTER_AUTH_URL && env.BETTER_AUTH_URL.replace(/\/$/, "") !== PRODUCTION_ORIGIN) {
    problems.push(`BETTER_AUTH_URL must be ${PRODUCTION_ORIGIN}.`);
  }
  checkSecret(env, "BETTER_AUTH_SECRET", problems);
  checkSecret(env, "SYNC_INTERNAL_SECRET", problems);

  if (env.EMAIL_TRANSPORT && env.EMAIL_TRANSPORT !== "resend") {
    problems.push(`EMAIL_TRANSPORT must be resend (${env.EMAIL_TRANSPORT} is for development and tests).`);
  }
  if (env.EMAIL_FROM && !/@editor\.swayam\.space>?\s*$/.test(env.EMAIL_FROM)) {
    problems.push("EMAIL_FROM must send from the verified domain editor.swayam.space.");
  }

  if (env.SYNC_TOKEN_PRIVATE_KEY) {
    try {
      const jwk = JSON.parse(env.SYNC_TOKEN_PRIVATE_KEY) as Record<string, unknown>;
      if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.d !== "string") {
        problems.push("SYNC_TOKEN_PRIVATE_KEY must be an Ed25519 private JWK.");
      }
      if (typeof jwk.kid !== "string" || !jwk.kid.startsWith("prod-")) {
        problems.push("SYNC_TOKEN_PRIVATE_KEY must be a production key (kid prod-...; pnpm keys:sync --production).");
      }
    } catch {
      problems.push("SYNC_TOKEN_PRIVATE_KEY is not JSON.");
    }
  }

  const database = url(env.DATABASE_URL);
  if (env.DATABASE_URL && !database) problems.push("DATABASE_URL is not a URL.");
  if (database) {
    if (isLocal(database)) problems.push("DATABASE_URL points at a local database.");
    if (!database.hostname.includes("-pooler")) problems.push("DATABASE_URL must be Neon's pooled connection string.");
    if (database.searchParams.get("sslmode") !== "require") problems.push("DATABASE_URL must include sslmode=require.");
  }

  const syncSocket = url(env.NEXT_PUBLIC_SYNC_URL);
  const syncInternal = url(env.SYNC_INTERNAL_URL);
  if (env.NEXT_PUBLIC_SYNC_URL && (!syncSocket || syncSocket.protocol !== "wss:" || isLocal(syncSocket))) {
    problems.push("NEXT_PUBLIC_SYNC_URL must be a wss:// address of the production sync server.");
  }
  if (env.SYNC_INTERNAL_URL && (!syncInternal || syncInternal.protocol !== "https:" || isLocal(syncInternal))) {
    problems.push("SYNC_INTERNAL_URL must be an https:// address of the production sync server.");
  }
  if (syncSocket && syncInternal && syncSocket.host !== syncInternal.host) {
    problems.push("NEXT_PUBLIC_SYNC_URL and SYNC_INTERNAL_URL must point at the same sync server.");
  }

  if (env.NEXT_PUBLIC_E2E_HOOKS === "1") problems.push("NEXT_PUBLIC_E2E_HOOKS is a test-only setting.");
  // Vercel overwrites X-Forwarded-For with the client's address, so trusting
  // it there gives per-address sign-in limits; leaving it unset turns them off.
  if (env.VERCEL === "1" && !env.AUTH_CLIENT_IP_HEADER) {
    problems.push("AUTH_CLIENT_IP_HEADER must be set on Vercel (x-forwarded-for).");
  }
  if (env.MAGIC_LINK_DAILY_LIMIT && Number(env.MAGIC_LINK_DAILY_LIMIT) > 100 && env.ALLOW_MAGIC_LINK_LIMIT_ABOVE_QUOTA !== "1") {
    problems.push("MAGIC_LINK_DAILY_LIMIT is above Resend's free quota (100 a day).");
  }
  return problems;
}

/**
 * Every build and server on Vercel must pass, previews included: previews
 * have no variables, so a preview that is ever created fails instead of
 * running against anything. BRAHMA_PREFLIGHT=1 runs it anywhere else.
 */
export function mustPassPreflight(env: Env): boolean {
  return env.VERCEL === "1" || env.BRAHMA_PREFLIGHT === "1";
}
