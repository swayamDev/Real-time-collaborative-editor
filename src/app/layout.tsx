import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { ServiceWorkerRegistration } from "@/components/service-worker";
import { THEME_COOKIE, parseTheme } from "@/lib/preferences";
import { codeFont, documentFont, uiFont } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Brahma", template: "%s - Brahma" },
  description: "A collaborative document editor.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html
      lang="en"
      data-theme={theme}
      className={`${uiFont.variable} ${documentFont.variable} ${codeFont.variable}`}
    >
      <body>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
