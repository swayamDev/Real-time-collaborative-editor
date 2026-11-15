import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

const https = (process.env.BETTER_AUTH_URL ?? "").startsWith("https://");

/**
 * Sent with every response. No script-src policy yet: Next's inline
 * bootstrap scripts would need per-request nonces, which also changes how
 * pages are cached for offline use. Document content is handled as
 * untrusted where it is rendered instead (see src/lib/safe-href.ts).
 */
const SECURITY_HEADERS = [
  // Never framed (clickjacking); no <base> or form posts to other sites; no plugins.
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
  { key: "X-Frame-Options", value: "DENY" },
  // Document and share-link URLs carry ids and tokens: never send them to other sites.
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
  ...(https ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  env: {
    // Always defined, so builds without it inline "0" and the minifier drops
    // the test-only branches (an undefined NEXT_PUBLIC_ variable is left as a
    // runtime lookup instead).
    NEXT_PUBLIC_E2E_HOOKS: process.env.NEXT_PUBLIC_E2E_HOOKS === "1" ? "1" : "0",
  },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      // Browsers check for a new service worker on navigation; never let a
      // cache answer for them, so a deploy reaches every device promptly.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
    ];
  },
  // Every route reads per-request data (the database and the theme cookie),
  // so there is no static shell to prerender. The classic dynamic model keeps
  // the root layout simple without Suspense boundaries around cookie reads.
  cacheComponents: false,
  // Do not generate AGENTS.md or similar files during `next dev`.
  agentRules: false,
  poweredByHeader: false,
  // Workspace package shipped as TypeScript source.
  transpilePackages: ["@brahma/protocol"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

// Source maps go to Sentry (and are then deleted from the deployment) only
// when SENTRY_AUTH_TOKEN is set in the build; otherwise nothing is uploaded.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  telemetry: false,
  // The after-build step creates the release and uploads source maps, which
  // needs a token (production builds only). Without one it would only warn.
  useRunAfterProductionCompileHook: Boolean(process.env.SENTRY_AUTH_TOKEN),
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
    deleteSourcemapsAfterUpload: true,
  },
});
