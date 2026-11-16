"use client";

import { useEffect, useId, useRef } from "react";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  pending: boolean;
  error?: string | null;
  /** A second choice between Cancel and the main action. */
  secondaryAction?: { label: string; onClick: () => void };
  onConfirm: () => void;
  onCancel: () => void;
}

/** Destructive confirmation built on the native <dialog> (focus trap and Esc for free). */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pendingLabel,
  pending,
  error,
  secondaryAction,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  // Unique per dialog: several confirm dialogs can be on one page (sidebar, account menu).
  const titleId = useId();
  const descriptionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // Safer default: focus lands on Cancel, not on the destructive action.
      cancelRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
      className="dialog-fade m-auto w-[min(26rem,calc(100vw-32px))] rounded-lg border border-hairline bg-raised p-5 text-ink shadow-float"
    >
      <h2 id={titleId} className="text-[16px] leading-6 font-semibold break-words">
        {title}
      </h2>
      <p id={descriptionId} className="mt-1 text-ui text-ink-muted">
        {description}
      </p>
      {error && (
        <p role="alert" className="mt-3 text-ui-sm text-madder">
          {error}
        </p>
      )}
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="h-8 rounded-sm px-3 text-ui font-medium text-ink transition-colors duration-100 hover:bg-hover"
        >
          Cancel
        </button>
        {secondaryAction && (
          <button
            type="button"
            onClick={secondaryAction.onClick}
            disabled={pending}
            className="h-8 rounded-sm border border-hairline-strong px-3 text-ui font-medium text-ink transition-colors duration-100 hover:bg-hover disabled:opacity-70"
          >
            {secondaryAction.label}
          </button>
        )}
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className="h-8 rounded-sm bg-madder px-3 text-ui font-medium text-on-madder transition-colors duration-100 hover:bg-madder-hover disabled:opacity-70"
        >
          {pending ? pendingLabel : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
