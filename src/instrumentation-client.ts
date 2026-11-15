import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "./lib/sentry-options";

// Browser errors, scrubbed of personal data (see sentry-options.ts).
Sentry.init(sentryOptions());

// Required by the SDK for navigation instrumentation; with tracing off (tracesSampleRate 0) it records nothing.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
