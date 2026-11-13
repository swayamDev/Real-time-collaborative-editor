import { cn } from "@/lib/cn";
import { STATUS_LABELS, type SyncStatus as Status } from "@/lib/collab/status";

/** One label for connection, device and server state. See computeStatus for the rules. */
export function SyncStatus({ status, pending = false }: { status: Status; pending?: boolean }) {
  const attention = status === "reconnecting" || status === "reconnecting-local" || status === "saved-on-device";
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="sync-status"
      data-status={status}
      data-pending={pending}
      className={cn("px-2 text-ui-sm whitespace-nowrap", attention ? "text-ink" : "text-ink-muted")}
    >
      {STATUS_LABELS[status]}
    </div>
  );
}
