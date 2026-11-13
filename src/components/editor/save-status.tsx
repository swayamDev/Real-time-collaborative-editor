import type { SaveStatus as Status } from "./use-autosave";

/** Exact copy: "Saving", "Saved", "Couldn't save. Retry". */
export function SaveStatus({ status, onRetry }: { status: Status; onRetry: () => void }) {
  return (
    <div role="status" aria-live="polite" data-testid="save-status" className="px-2 text-ui-sm whitespace-nowrap">
      {status === "error" ? (
        <span className="text-madder">
          Couldn&apos;t save.{" "}
          <button
            type="button"
            onClick={onRetry}
            className="font-medium underline decoration-1 underline-offset-2 hover:decoration-2"
          >
            Retry
          </button>
        </span>
      ) : (
        <span className="text-ink-muted">{status === "saving" ? "Saving" : "Saved"}</span>
      )}
    </div>
  );
}
