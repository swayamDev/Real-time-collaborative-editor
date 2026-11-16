import "server-only";
import { TOKEN_TTL_SECONDS } from "@brahma/protocol";
import { and, eq, gt, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { user } from "@/db/auth-schema";
import { documents } from "@/db/schema";
import { emptyYjsState } from "@/lib/empty-yjs-state";
import { type DemoPass, type DemoSeat, decodeDemoPass, demoSeatName, demoSeatUserId, encodeDemoPass } from "./demo-pass";
import { allow } from "./rate-limit";
import { deleteInSync } from "./sync";
import { issueDemoSyncToken } from "./sync-token";

/**
 * "Try the demo": a temporary document, two seats (Visitor A and B), no
 * accounts.
 *
 * Every demo document is owned by one system user that nobody can sign in
 * as: it has no account or session, its address is in the reserved
 * .invalid domain, and sign-in links to such addresses are refused
 * (auth.ts). Demo documents have no members, so they are in nobody's lists
 * and no real user can open one. Demo seats hold sync tokens for their own
 * demo document only; the sync server refuses them anywhere else, keeps a
 * demo out of Postgres snapshots, and erases it when it ends.
 */
export const DEMO_USER_ID = "brahma-demo";
export const DEMO_USER_EMAIL = "demo@brahma.invalid";
export const DEMO_TTL_MS = 30 * 60 * 1000;
export const DEMO_COOKIE = "brahma-demo";
/** Expired demos removed per start, so cleanup stays quick. */
const CLEANUP_BATCH = 20;

function secret(): string {
  const value = process.env.BETTER_AUTH_SECRET;
  if (!value) throw new Error("BETTER_AUTH_SECRET must be set.");
  return value;
}

export function readDemoPass(value: string | undefined): DemoPass | null {
  return decodeDemoPass(value, secret());
}

export function writeDemoPass(pass: DemoPass): string {
  return encodeDemoPass(pass, secret());
}

async function ensureDemoUser(): Promise<void> {
  await db()
    .insert(user)
    .values({ id: DEMO_USER_ID, name: "Brahma demo", email: DEMO_USER_EMAIL, emailVerified: false })
    .onConflictDoNothing();
}

export type StartDemoResult = { ok: true; pass: DemoPass } | { ok: false; reason: "busy" };

/**
 * Start a demo for a visitor at `address` (null when no client address is
 * trusted: then only the daily cap applies). Removes expired demos first.
 */
export async function startDemo(address: string | null): Promise<StartDemoResult> {
  if (address !== null && !(await allow("demoPerAddress", address))) return { ok: false, reason: "busy" };
  if (!(await allow("demoDaily", "all"))) return { ok: false, reason: "busy" };
  await cleanupExpiredDemos();
  await ensureDemoUser();
  const expiresAt = Date.now() + DEMO_TTL_MS;
  const [row] = await db()
    .insert(documents)
    .values({ ownerId: DEMO_USER_ID, title: "", yjsState: emptyYjsState(), demoExpiresAt: new Date(expiresAt) })
    .returning({ id: documents.id });
  return { ok: true, pass: { documentId: row.id, expiresAt, seats: "ab" } };
}

/** The demo document behind a pass, if it still exists and has not ended. */
async function liveDemo(pass: DemoPass): Promise<boolean> {
  const [row] = await db()
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.id, pass.documentId),
        eq(documents.ownerId, DEMO_USER_ID),
        isNotNull(documents.demoExpiresAt),
        gt(documents.demoExpiresAt, sql`now()`),
        isNull(documents.deletedAt),
      ),
    );
  return Boolean(row);
}

export type DemoTokenResult =
  | { ok: true; token: string; expiresIn: number }
  | { ok: false; status: 404 | 410 | 429 };

/** A sync token for one seat of the pass's demo, never longer than the demo. */
export async function demoTokenFor(pass: DemoPass, seat: DemoSeat): Promise<DemoTokenResult> {
  if (!(await liveDemo(pass))) return { ok: false, status: 410 };
  const userId = demoSeatUserId(pass.documentId, seat);
  if (!(await allow("syncToken", userId))) return { ok: false, status: 429 };
  const token = await issueDemoSyncToken(pass.documentId, userId, demoSeatName(seat));
  const remaining = Math.max(1, Math.floor((pass.expiresAt - Date.now()) / 1000));
  return { ok: true, token, expiresIn: Math.min(TOKEN_TTL_SECONDS, remaining) };
}

/**
 * Hard delete demos that have ended: the sync server room first (best
 * effort; the room also erases itself at expiry), then the row. Every
 * statement requires the demo owner AND a demo expiry in the past, so a
 * real document can never be touched, whatever ids are passed around.
 */
export async function cleanupExpiredDemos(limit = CLEANUP_BATCH): Promise<number> {
  const ended = and(
    eq(documents.ownerId, DEMO_USER_ID),
    isNotNull(documents.demoExpiresAt),
    lt(documents.demoExpiresAt, sql`now()`),
  );
  const rows = await db().select({ id: documents.id }).from(documents).where(ended).limit(limit);
  let removed = 0;
  for (const { id } of rows) {
    await deleteInSync(id).catch(() => {});
    const deleted = await db()
      .delete(documents)
      .where(and(eq(documents.id, id), ended))
      .returning({ id: documents.id });
    removed += deleted.length;
  }
  return removed;
}
