import type { SyncStatus as Status } from "@/lib/collab/provider";
import { cn } from "@/lib/cn";

/** One label for connection and save state. See SyncProvider for when each shows. */
const LABELS: Partial<Record<Status, string>> = {
  connecting: "Connecting",
  saved: "Saved",
  saving: "Saving",
  reconnecting: "Reconnecting",
  offline: "Offline",
};

export function SyncStatus({ status }: { status: Status }) {
  const label = LABELS[status];
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="sync-status"
      data-status={status}
      className={cn(
        "px-2 text-ui-sm whitespace-nowrap",
        status === "reconnecting" || status === "offline" ? "text-ink" : "text-ink-muted",
      )}
    >
      {label}
    </div>
  );
}
