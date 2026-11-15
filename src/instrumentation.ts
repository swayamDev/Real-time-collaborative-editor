import * as Sentry from "@sentry/nextjs";
import { checkProductionEnvironment, mustPassPreflight } from "./lib/preflight";
import { sentryOptions } from "./lib/sentry-options";

/**
 * Runs once when a server instance starts. On Vercel the production checks
 * run again here, so a deployment whose variables changed after the build
 * refuses to serve instead of running with development settings. Then
 * server errors go to Sentry, scrubbed of personal data.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs" && mustPassPreflight(process.env)) {
    const problems = checkProductionEnvironment(process.env);
    if (problems.length > 0) {
      throw new Error(`Production preflight failed:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
    }
  }
  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    Sentry.init(sentryOptions());
  }
}

/** Errors thrown while rendering or in route handlers and server actions. */
export const onRequestError = Sentry.captureRequestError;
