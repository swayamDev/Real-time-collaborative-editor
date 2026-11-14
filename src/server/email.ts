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

let resend: Resend | null = null;

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
  const { error } = await resend.emails.send({ from, to: email.to, subject: email.subject, text: email.text });
  if (error) throw new Error(`Resend refused the email: ${error.message}`);
}
