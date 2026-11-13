export type Theme = "light" | "dark";

export const THEME_COOKIE = "brahma-theme";
export const SIDEBAR_COOKIE = "brahma-sidebar";

/** Light is the default. The system color scheme is intentionally ignored. */
export function parseTheme(value: string | undefined): Theme {
  return value === "dark" ? "dark" : "light";
}

export function parseSidebarCollapsed(value: string | undefined): boolean {
  return value === "collapsed";
}

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function writePreferenceCookie(name: string, value: string): void {
  document.cookie = `${name}=${value}; path=/; max-age=${ONE_YEAR_SECONDS}; samesite=lax`;
}
