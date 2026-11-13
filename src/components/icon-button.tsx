import { forwardRef } from "react";
import { cn } from "@/lib/cn";

type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  /** Accessible name. Also shown as a native tooltip. */
  label: string;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, className, children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-sm text-ink-muted transition-colors duration-100 hover:bg-hover hover:text-ink",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
});

/** Shared props for lucide icons so every icon has the same weight. */
export const iconProps = { size: 16, strokeWidth: 1.75, "aria-hidden": true } as const;
