// Secrets are not in wrangler.jsonc, so `wrangler types` cannot see them.
declare namespace Cloudflare {
  interface Env {
    /** Postgres connection string. "memory:" selects the in-memory store (tests). */
    DATABASE_URL: string;
    /** Shared with the Next app; authorizes rename and delete. */
    SYNC_INTERNAL_SECRET: string;
  }
}

interface Env {
  DATABASE_URL: string;
  SYNC_INTERNAL_SECRET: string;
}
