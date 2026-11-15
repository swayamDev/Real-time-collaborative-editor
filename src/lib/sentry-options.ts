import { scrubEvent } from "@brahma/protocol";

/**
 * Sentry settings shared by the browser, the Node server and the edge
 * runtime. Errors only (no performance tracing, no session replay), no
 * personal data: Sentry's own PII collection is off and every event passes
 * through scrubEvent. Disabled when no DSN is set (development and tests).
 */
export function sentryOptions() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  return {
    dsn,
    enabled: Boolean(dsn),
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV ?? "development",
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
  };
}
