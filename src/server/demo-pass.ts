import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";

/**
 * A demo pass: what a visitor holds for one demo document, in the
 * brahma-demo cookie or in a join link for another device.
 *
 *   <document id>.<expires at, ms>.<seats>.<signature>
 *
 * `seats` is "ab" for the visitor who started the demo and "b" for a join
 * link, so a second device can only ever be Visitor B. The signature is an
 * HMAC under a key derived from BETTER_AUTH_SECRET; nothing is stored.
 * Pure, so it can be unit tested; used with the database in demo.ts.
 */
export type DemoSeat = "a" | "b";
export type DemoSeats = "ab" | "b";

export interface DemoPass {
  documentId: string;
  expiresAt: number;
  seats: DemoSeats;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function key(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "brahma", "demo-pass", 32));
}

function sign(body: string, secret: string): string {
  return createHmac("sha256", key(secret)).update(body).digest("base64url");
}

export function encodeDemoPass(pass: DemoPass, secret: string): string {
  const body = `${pass.documentId}.${pass.expiresAt}.${pass.seats}`;
  return `${body}.${sign(body, secret)}`;
}

/** The pass, if it is well formed, signed with `secret`, and not expired at `now`. */
export function decodeDemoPass(value: string | undefined, secret: string, now = Date.now()): DemoPass | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const [documentId, expires, seats, signature] = parts;
  if (!UUID.test(documentId) || !/^\d{1,15}$/.test(expires) || (seats !== "ab" && seats !== "b")) return null;
  const expected = Buffer.from(sign(`${documentId}.${expires}.${seats}`, secret));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const expiresAt = Number(expires);
  if (expiresAt <= now) return null;
  return { documentId, expiresAt, seats };
}

export function passAllowsSeat(pass: DemoPass, seat: string): seat is DemoSeat {
  return (seat === "a" || seat === "b") && pass.seats.includes(seat);
}

/** The sync server user id for a seat: unique per demo, never a real account. */
export function demoSeatUserId(documentId: string, seat: DemoSeat): string {
  return `demo:${documentId}:${seat}`;
}

export function demoSeatName(seat: DemoSeat): string {
  return seat === "a" ? "Visitor A" : "Visitor B";
}
