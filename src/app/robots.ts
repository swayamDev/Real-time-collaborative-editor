import type { MetadataRoute } from "next";

/**
 * Crawlers may read the public pages (sign-in, the demo, privacy), the
 * icons and the preview image, and nothing else: every other page needs an
 * account, and API routes are never for crawlers. The demo page itself is
 * noindex; it is allowed here so crawlers can see that. Demo join links
 * carry a pass and are never crawled.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  return {
    rules: [
      {
        userAgent: "*",
        allow: [
          "/sign-in",
          "/demo$",
          "/privacy",
          "/og.png",
          "/favicon.ico",
          "/icon.svg",
          "/apple-touch-icon.png",
          "/icons/",
          "/manifest.webmanifest",
          "/_next/static/",
        ],
        disallow: ["/", "/api/"],
      },
    ],
    host: origin,
  };
}
