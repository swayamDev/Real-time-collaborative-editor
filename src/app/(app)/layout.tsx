import { cookies } from "next/headers";
import { AppShell } from "@/components/app-shell";
import { SIDEBAR_COOKIE, THEME_COOKIE, parseSidebarCollapsed, parseTheme } from "@/lib/preferences";
import { listDocuments } from "@/server/documents";
import { requireUserOrRedirect } from "@/server/session";

/** Everything behind sign-in: the shell, the sidebar and the documents. */
export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const user = await requireUserOrRedirect();
  const [cookieStore, documents] = await Promise.all([cookies(), listDocuments()]);
  return (
    <AppShell
      user={user}
      documents={documents}
      initialTheme={parseTheme(cookieStore.get(THEME_COOKIE)?.value)}
      initialSidebarCollapsed={parseSidebarCollapsed(cookieStore.get(SIDEBAR_COOKIE)?.value)}
    >
      {children}
    </AppShell>
  );
}
