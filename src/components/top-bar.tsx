"use client";

import { Menu as MenuIcon, PanelLeft } from "lucide-react";
import { useShell } from "./app-shell";
import { IconButton, iconProps } from "./icon-button";
import { ThemeToggle } from "./theme-toggle";

interface TopBarProps {
  /** Current page, shown after "Documents" in the breadcrumb. */
  title?: string;
  titleMuted?: boolean;
  status?: React.ReactNode;
  presence?: React.ReactNode;
}

export function TopBar({ title, titleMuted, status, presence }: TopBarProps) {
  const { sidebarCollapsed, toggleSidebar, openDrawer } = useShell();

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 px-2 sm:px-3">
      <IconButton label="Open sidebar" onClick={openDrawer} className="md:hidden">
        <MenuIcon {...iconProps} />
      </IconButton>
      {sidebarCollapsed && (
        <IconButton label="Expand sidebar" onClick={toggleSidebar} className="hidden md:inline-flex">
          <PanelLeft {...iconProps} />
        </IconButton>
      )}

      <nav aria-label="Breadcrumb" className="min-w-0 flex-1 px-1">
        <ol className="flex min-w-0 items-center gap-1.5 text-ui-sm">
          <li className="hidden shrink-0 text-ink-muted sm:block">Documents</li>
          {title !== undefined && (
            <>
              <li aria-hidden className="hidden text-slate sm:block">
                /
              </li>
              <li
                aria-current="page"
                className={titleMuted ? "truncate text-ink-muted" : "truncate font-medium text-ink"}
                data-testid="breadcrumb-title"
              >
                {title}
              </li>
            </>
          )}
        </ol>
      </nav>

      {status}
      {presence}
      <ThemeToggle />
    </header>
  );
}
