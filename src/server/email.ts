import "server-only";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Resend } from "resend";

export interface Email {
  to: string;
  subject: string;
  text: string;
}

/**
 * How email leaves the app, chosen by EMAIL_TRANSPORT:
 *   resend   production (RESEND_API_KEY, EMAIL_FROM)
 *   console  local development: the message is printed
 *   file     CI and end-to-end tests: appended to test-results/outbox/<email>.txt
 *
 * console and file are refused unless BETTER_AUTH_URL points at localhost,
 * so a deployment can never quietly log sign-in links.
 */
export type EmailTransport = "resend" | "console" | "file";

export function emailTransport(): EmailTransport {
  const transport = (process.env.EMAIL_TRANSPORT ?? "console") as EmailTransport;
  if (!["resend", "console", "file"].includes(transport)) {
    throw new Error(`Unknown EMAIL_TRANSPORT "${transport}".`);
  }
  if (transport !== "resend") {
    const host = new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000").hostname;
    if (host !== "localhost" && host !== "127.0.0.1") {
      throw new Error(`EMAIL_TRANSPORT=${transport} is only allowed on localhost. Use resend.`);
    }
  }
  return transport;
}

export const OUTBOX_DIR = join(process.cwd(), "test-results", "outbox");

/**
 * The provider refused to send for quota or rate reasons (Resend's free
 * plan allows 100 emails a day and 10 requests a second). Callers show the
 * same message as the app's own limits.
 */
export class EmailQuotaError extends Error {
  constructor(readonly code: string) {
    super(`Email provider quota reached: ${code}`);
    this.name = "EmailQuotaError";
  }
}

const QUOTA_ERRORS = new Set(["daily_quota_exceeded", "monthly_quota_exceeded", "rate_limit_exceeded"]);

/** The part of the Resend client used here; replaced in tests. */
export interface ResendLike {
  emails: {
    send(message: { from: string; to: string; subject: string; text: string }): Promise<{
      error: { name: string; message: string; statusCode: number | null } | null;
    }>;
  };
}

let resend: ResendLike | null = null;

/** Send through Resend, telling quota refusals apart from other failures. */
export async function sendWithResend(client: ResendLike, from: string, email: Email): Promise<void> {
  const { error } = await client.emails.send({ from, to: email.to, subject: email.subject, text: email.text });
  if (!error) return;
  if (QUOTA_ERRORS.has(error.name) || error.statusCode === 429) {
    console.error(`Resend refused an email for quota or rate reasons (${error.name}): ${error.message}`);
    throw new EmailQuotaError(error.name);
  }
  throw new Error(`Resend refused the email: ${error.message}`);
}

export async function sendEmail(email: Email): Promise<void> {
  const transport = emailTransport();
  if (transport === "console") {
    console.info(`\n[email] to ${email.to}: ${email.subject}\n${email.text}\n`);
    return;
  }
  if (transport === "file") {
    await mkdir(OUTBOX_DIR, { recursive: true });
    await appendFile(join(OUTBOX_DIR, `${email.to.toLowerCase()}.txt`), `${email.subject}\n${email.text}\n---\n`);
    return;
  }
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!apiKey || !from) throw new Error("RESEND_API_KEY and EMAIL_FROM must be set for EMAIL_TRANSPORT=resend.");
  resend ??= new Resend(apiKey);
  await sendWithResend(resend, from, email);
}
