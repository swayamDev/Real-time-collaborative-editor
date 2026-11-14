import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";

export interface Limit {
  max: number;
  windowSeconds: number;
}

/** Limits Better Auth does not cover. Keys are prefixed with the limit's name. */
export const LIMITS = {
  /** Per inviting user. */
  invite: { max: 30, windowSeconds: 60 * 60 },
  /** Per email address, on top of Better Auth's per-IP limit, so one inbox cannot be flooded. */
  magicLinkPerEmail: { max: 5, windowSeconds: 60 * 60 },
  /**
   * Every sign-in link sent, site wide: a ceiling on email sending that no
   * header can dodge. Raise it with traffic; the per-address limit behind a
   * trusted proxy (client-ip.ts) is the finer control. MAGIC_LINK_HOURLY_LIMIT
   * overrides it.
   */
  magicLinkSiteWide: { max: Number(process.env.MAGIC_LINK_HOURLY_LIMIT) || 300, windowSeconds: 60 * 60 },
  /** Per user and document: several tabs with reconnects stay well under it. */
  syncToken: { max: 600, windowSeconds: 60 * 60 },
} satisfies Record<string, Limit>;

/**
 * Count one attempt and say whether it is allowed. One atomic upsert:
 * a new window starts when the old one has passed. Fixed windows allow a
 * burst of up to 2x at a boundary, which is fine for these limits.
 */
export async function allow(name: keyof typeof LIMITS, subject: string): Promise<boolean> {
  const { max, windowSeconds } = LIMITS[name];
  const key = `${name}:${subject}`;
  const result = await db().execute<{ count: number }>(sql`
    INSERT INTO app_rate_limits (key, window_start, count)
    VALUES (${key}, now(), 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN app_rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
                   THEN 1 ELSE app_rate_limits.count + 1 END,
      window_start = CASE WHEN app_rate_limits.window_start < now() - make_interval(secs => ${windowSeconds})
                          THEN now() ELSE app_rate_limits.window_start END
    RETURNING count
  `);
  return Number(result.rows[0]?.count ?? 0) <= max;
}
