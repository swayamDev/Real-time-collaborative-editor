"use client";

import { X } from "lucide-react";
import { useEffect } from "react";
import { IconButton, iconProps } from "../icon-button";

/**
 * A short message about something the editor refused or could not do.
 * Announced to screen readers; dismisses itself after a few seconds.
 */
export function EditorNotice({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDismiss, 8_000);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  return (
    <div aria-live="assertive" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4">
      {message && (
        <div
          role="alert"
          data-testid="editor-notice"
          className="animate-menu-in pointer-events-auto flex max-w-md items-start gap-2 rounded-md border border-hairline bg-raised py-2 pr-1 pl-3 text-ui text-ink shadow-float"
        >
          <p className="py-1.5">{message}</p>
          <IconButton label="Dismiss" onClick={onDismiss}>
            <X {...iconProps} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
