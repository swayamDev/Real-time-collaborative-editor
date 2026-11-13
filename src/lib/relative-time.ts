const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const absoluteUtc = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * Deterministic fallback rendered on the server and during hydration.
 * Uses UTC so the server and the browser always produce the same string.
 */
export function formatAbsoluteDate(iso: string): string {
  return absoluteUtc.format(new Date(iso));
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Compact edit time for the sidebar, in the viewer's time zone. Client only. */
export function formatRelativeTime(iso: string, now: number): string {
  const date = new Date(iso);
  const elapsed = Math.max(0, now - date.getTime());

  if (elapsed < MINUTE) return "Just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;

  const today = new Date(now);
  if (sameLocalDay(date, today)) return `${Math.floor(elapsed / HOUR)}h`;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameLocalDay(date, yesterday)) return "Yesterday";

  const options: Intl.DateTimeFormatOptions =
    date.getFullYear() === today.getFullYear()
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" };
  return new Intl.DateTimeFormat("en-US", options).format(date);
}

/** Full timestamp for tooltips. Client only. */
export function formatFullTimestamp(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}
