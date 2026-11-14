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
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
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

export default nextConfig;
