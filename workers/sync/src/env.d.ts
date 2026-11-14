// Secrets are not in wrangler.jsonc, so `wrangler types` cannot see them.
declare namespace Cloudflare {
  interface Env {
    /** Postgres connection string. "memory:" selects the in-memory store (tests). */
    DATABASE_URL: string;
    /** Shared with the Next app; authorizes rename and delete. */
    SYNC_INTERNAL_SECRET: string;
    /** JWKS of Ed25519 public keys that verify sync tokens. */
    SYNC_TOKEN_PUBLIC_KEYS: string;
    /** Seconds a socket may keep sending after its token expires (default 60). */
    TOKEN_GRACE_SECONDS?: string;
  }
}

interface Env {
  DATABASE_URL: string;
  SYNC_INTERNAL_SECRET: string;
  SYNC_TOKEN_PUBLIC_KEYS: string;
  TOKEN_GRACE_SECONDS?: string;
}
