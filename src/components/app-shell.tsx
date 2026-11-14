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
import { getLocalStore } from "@/lib/collab/device-store";
import { pruneInaccessible } from "@/lib/collab/prune";
import { authClient } from "@/lib/auth-client";
import { DATA_REMOVED, DATA_REMOVED_DETAIL } from "@/lib/copy";
import {
  SESSION_CHANNEL,
  type SessionMessage,
  claimDevice,
  clearPendingSignOut,
  pendingSignOut,
} from "@/lib/device-data";
import { SIDEBAR_COOKIE, THEME_COOKIE, type Theme, writePreferenceCookie } from "@/lib/preferences";
import type { DocumentSummary } from "@/server/documents";
import { Sidebar } from "./sidebar";

/** The signed-in user, as the client sees it. */
export interface ShellUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

interface ShellContextValue {
  user: ShellUser;
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
  /** Make sure a document is listed, e.g. one just created or opened by URL. */
  ensure: (document: DocumentSummary) => void;
  /** The current user's role changed while the document was open. */
  setRole: (id: string, role: DocumentSummary["role"]) => void;
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
  user,
  documents: serverDocuments,
  initialTheme,
  initialSidebarCollapsed,
  children,
}: {
  user: ShellUser;
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

  // This device belongs to whoever is signed in now: delete anyone else's
  // data (sign-out may never have run), then drop local copies of documents
  // this user can no longer open. Pruning trusts the server list only online.
  const [accessibleAtLoad] = useState(() => new Set(serverDocuments.map((doc) => doc.id)));
  // This user's data was removed from the device while sign-out could not
  // reach the server: show only that, and finish signing out once online.
  const [removed, setRemoved] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const finishSignOut = async () => {
      if (!navigator.onLine) return;
      const result = await authClient.signOut().catch(() => ({ error: true }));
      if (!result || result.error) return;
      clearPendingSignOut();
      window.location.replace("/sign-in");
    };
    void (async () => {
      if (pendingSignOut() === user.id) {
        setRemoved(true);
        await finishSignOut();
        return;
      }
      // Only for a user the server confirms (see claimDevice); pruning also
      // needs the server's list to be current.
      const claimed = await claimDevice(user.id).catch(() => "unconfirmed");
      if (cancelled || claimed !== "claimed") return;
      const store = await getLocalStore(user.id);
      if (store) await pruneInaccessible(store, accessibleAtLoad).catch(() => []);
    })();
    // Another tab signed in as someone else, or signed this user out.
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(SESSION_CHANNEL);
    if (channel) {
      channel.onmessage = (event: MessageEvent<SessionMessage>) => {
        const message = event.data;
        if (message?.type === "user" && message.userId !== user.id) window.location.reload();
        if (message?.type === "signed-out" && message.userId === user.id) {
          if (pendingSignOut() === user.id) setRemoved(true);
          else window.location.replace("/sign-in");
        }
      };
    }
    const onOnline = () => {
      if (pendingSignOut() === user.id) void finishSignOut();
    };
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      channel?.close();
      window.removeEventListener("online", onOnline);
    };
  }, [user.id, accessibleAtLoad]);

  const remove = useCallback((id: string) => {
    setDocuments((docs) => docs.filter((doc) => doc.id !== id));
  }, []);

  const ensure = useCallback((document: DocumentSummary) => {
    setDocuments((docs) =>
      docs.some((doc) => doc.id === document.id) ? docs : [...docs, document].sort(byLastEdited),
    );
  }, []);

  const setRole = useCallback((id: string, role: DocumentSummary["role"]) => {
    setDocuments((docs) => docs.map((doc) => (doc.id === id && doc.role !== role ? { ...doc, role } : doc)));
  }, []);

  const documentsValue = useMemo(
    () => ({ documents, setTitle, touch, remove, ensure, setRole }),
    [documents, setTitle, touch, remove, ensure, setRole],
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
    () => ({ user, theme, setTheme, sidebarCollapsed, toggleSidebar, openDrawer, closeDrawer }),
    [user, theme, setTheme, sidebarCollapsed, toggleSidebar, openDrawer, closeDrawer],
  );

  if (removed) {
    return (
      <main id="main" className="flex h-dvh items-center justify-center bg-paper px-4" data-testid="data-removed">
        <div className="max-w-md text-center">
          <h1 className="font-ui text-[20px] leading-7 font-semibold text-ink">{DATA_REMOVED}</h1>
          <p className="mt-2 text-ui text-ink-muted">{DATA_REMOVED_DETAIL}</p>
        </div>
      </main>
    );
  }

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
