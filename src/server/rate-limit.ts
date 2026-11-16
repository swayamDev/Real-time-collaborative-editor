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
   * Every sign-in link sent, site wide, per day: a ceiling on email sending
   * that no header can dodge, set below the email provider's quota so the
   * app's own limit is reached first. Resend's free plan allows 100 emails a
   * day (about 3,000 a month); 80 leaves room for invite emails, which share
   * that quota. MAGIC_LINK_DAILY_LIMIT overrides it on a larger plan. Only
   * email sign-in counts; Google sign-in sends no email.
   */
  magicLinkSiteWide: { max: Number(process.env.MAGIC_LINK_DAILY_LIMIT) || 80, windowSeconds: 24 * 60 * 60 },
  /** Per user and document: several tabs with reconnects stay well under it. */
  syncToken: { max: 600, windowSeconds: 60 * 60 },
  /** Demos started per client address (when one is trusted). */
  demoPerAddress: { max: 5, windowSeconds: 60 * 60 },
  /**
   * Demos started site wide per day, sized to the Workers free plan: a full
   * demo writes at most about 700 Durable Object rows of the plan's 100,000
   * a day, so 30 demos stay under a quarter of it (see README, Demo).
   */
  demoDaily: { max: Number(process.env.DEMO_DAILY_LIMIT) || 30, windowSeconds: 24 * 60 * 60 },
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
