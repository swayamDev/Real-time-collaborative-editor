"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { SIDEBAR_COOKIE, THEME_COOKIE, type Theme, writePreferenceCookie } from "@/lib/preferences";
import type { DocumentSummary } from "@/server/documents";
import { Sidebar } from "./sidebar";

interface ShellContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  openDrawer: () => void;
  closeDrawer: () => void;
}

interface DocumentsContextValue {
  documents: DocumentSummary[];
  /** Local title change, shown in the sidebar immediately. */
  setTitle: (id: string, title: string) => void;
  /** Record a confirmed save so the document moves to the top. */
  touch: (id: string, updatedAt: string) => void;
  remove: (id: string) => void;
}

const ShellContext = createContext<ShellContextValue | null>(null);
const DocumentsContext = createContext<DocumentsContextValue | null>(null);

export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error("useShell must be used inside AppShell");
  return value;
}

export function useDocuments(): DocumentsContextValue {
  const value = useContext(DocumentsContext);
  if (!value) throw new Error("useDocuments must be used inside AppShell");
  return value;
}

function byLastEdited(a: DocumentSummary, b: DocumentSummary): number {
  return b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id);
}

const DESKTOP_QUERY = "(min-width: 768px)";

export function AppShell({
  documents: serverDocuments,
  initialTheme,
  initialSidebarCollapsed,
  children,
}: {
  documents: DocumentSummary[];
  initialTheme: Theme;
  initialSidebarCollapsed: boolean;
  children: React.ReactNode;
}) {
  // Documents: start from the server list, apply local changes on top, and
  // take the server list again whenever it is revalidated.
  const [documents, setDocuments] = useState(serverDocuments);
  const [lastServerDocuments, setLastServerDocuments] = useState(serverDocuments);
  if (serverDocuments !== lastServerDocuments) {
    setLastServerDocuments(serverDocuments);
    setDocuments(serverDocuments);
  }

  const setTitle = useCallback((id: string, title: string) => {
    setDocuments((docs) => docs.map((doc) => (doc.id === id ? { ...doc, title } : doc)));
  }, []);

  const touch = useCallback((id: string, updatedAt: string) => {
    setDocuments((docs) =>
      docs.map((doc) => (doc.id === id ? { ...doc, updatedAt } : doc)).sort(byLastEdited),
    );
  }, []);

  const remove = useCallback((id: string) => {
    setDocuments((docs) => docs.filter((doc) => doc.id !== id));
  }, []);

  const documentsValue = useMemo(
    () => ({ documents, setTitle, touch, remove }),
    [documents, setTitle, touch, remove],
  );

  // Theme
  const [theme, setThemeState] = useState(initialTheme);
  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    document.documentElement.dataset.theme = next;
    writePreferenceCookie(THEME_COOKIE, next);
  }, []);

  // Sidebar: collapsible on desktop, a drawer on small screens.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialSidebarCollapsed);
  const drawerRef = useRef<HTMLDialogElement>(null);

  const openDrawer = useCallback(() => drawerRef.current?.showModal(), []);
  const closeDrawer = useCallback(() => drawerRef.current?.close(), []);

  const toggleSidebar = useCallback(() => {
    if (!window.matchMedia(DESKTOP_QUERY).matches) {
      if (drawerRef.current?.open) drawerRef.current.close();
      else drawerRef.current?.showModal();
      return;
    }
    setSidebarCollapsed((collapsed) => {
      writePreferenceCookie(SIDEBAR_COOKIE, collapsed ? "expanded" : "collapsed");
      return !collapsed;
    });
  }, []);

  // Close the drawer after navigating, and if the window grows to desktop.
  const pathname = usePathname();
  useEffect(() => {
    drawerRef.current?.close();
  }, [pathname]);

  useEffect(() => {
    const query = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => {
      if (query.matches) drawerRef.current?.close();
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  // Mod+\ toggles the sidebar.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "\\") {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleSidebar]);

  const shellValue = useMemo(
    () => ({ theme, setTheme, sidebarCollapsed, toggleSidebar, openDrawer, closeDrawer }),
    [theme, setTheme, sidebarCollapsed, toggleSidebar, openDrawer, closeDrawer],
  );

  return (
    <ShellContext.Provider value={shellValue}>
      <DocumentsContext.Provider value={documentsValue}>
        <a
          href="#main"
          className="sr-only rounded-sm bg-raised px-3 py-2 text-ui font-medium text-ink shadow-float focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50"
        >
          Skip to content
        </a>
        <div className="flex h-dvh overflow-hidden">
          <aside
            aria-label="Sidebar"
            inert={sidebarCollapsed}
            className={cn(
              "hidden shrink-0 overflow-hidden border-r border-hairline bg-sunken transition-[width] duration-180 ease-out md:block",
              sidebarCollapsed ? "w-0 border-r-0" : "w-64",
            )}
          >
            <div className="h-full w-64">
              <Sidebar variant="docked" />
            </div>
          </aside>

          <dialog
            ref={drawerRef}
            aria-label="Sidebar"
            className="animate-drawer-in m-0 h-dvh max-h-dvh w-72 max-w-[85vw] border-r border-hairline bg-sunken p-0 text-ink md:hidden"
            onClick={(event) => {
              // A click on the backdrop lands on the dialog element itself.
              if (event.target === event.currentTarget) closeDrawer();
            }}
          >
            <Sidebar variant="drawer" />
          </dialog>

          <div className="flex min-w-0 flex-1 flex-col">{children}</div>
        </div>
      </DocumentsContext.Provider>
    </ShellContext.Provider>
  );
}
