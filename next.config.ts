import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
