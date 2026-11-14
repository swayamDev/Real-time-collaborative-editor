import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins/magic-link";
import { db } from "@/db/client";
import * as authSchema from "@/db/auth-schema";
import { normalizeEmail } from "@/lib/email-address";
import { sendEmail } from "./email";

const baseURL = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

const google =
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ? { google: { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET } }
    : undefined;

export const auth = betterAuth({
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET,
  // Only the app's own origin may call auth endpoints (CSRF, redirects).
  trustedOrigins: [baseURL],
  database: drizzleAdapter(db(), { provider: "pg", schema: authSchema }),
  socialProviders: google,
  session: {
    expiresIn: 60 * 60 * 24 * 30,
    updateAge: 60 * 60 * 24,
  },
  rateLimit: {
    enabled: true,
    // In Postgres, so the limits hold across server instances.
    storage: "database",
    window: 60,
    max: 100,
  },
  advanced: {
    // HttpOnly, SameSite=Lax by default; Secure whenever the base URL is https.
    useSecureCookies: baseURL.startsWith("https://"),
  },
  plugins: [
    magicLink({
      expiresIn: 60 * 10,
      storeToken: "hashed",
      sendMagicLink: async ({ email, url }) => {
        await sendEmail({
          to: normalizeEmail(email),
          subject: "Your Brahma sign-in link",
          text: `Open this link to sign in to Brahma. It works once and expires in 10 minutes.\n\n${url}\n\nIf you did not ask for it, you can ignore this email.`,
        });
      },
    }),
    // Lets server actions set auth cookies.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
