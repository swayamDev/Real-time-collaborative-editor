import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

/**
 * The web app manifest (/manifest.webmanifest). Scope and start URL match
 * the service worker's scope ("/"), so an installed app opens through it
 * and works offline like the site. Icons come from pnpm brand.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: BRAND.name,
    short_name: BRAND.shortName,
    description: BRAND.description,
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: BRAND.light.paper,
    theme_color: BRAND.light.paper,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
