import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { SIDEBAR_COOKIE, THEME_COOKIE, parseSidebarCollapsed, parseTheme } from "@/lib/preferences";
import { listDocuments } from "@/server/documents";
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
  const [cookieStore, documents] = await Promise.all([cookies(), listDocuments()]);
  const theme = parseTheme(cookieStore.get(THEME_COOKIE)?.value);
  const sidebarCollapsed = parseSidebarCollapsed(cookieStore.get(SIDEBAR_COOKIE)?.value);

  return (
    <html
      lang="en"
      data-theme={theme}
      className={`${uiFont.variable} ${documentFont.variable} ${codeFont.variable}`}
    >
      <body>
        <AppShell documents={documents} initialTheme={theme} initialSidebarCollapsed={sidebarCollapsed}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
