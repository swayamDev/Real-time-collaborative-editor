"use client";

import { Plus } from "lucide-react";
import { useFormStatus } from "react-dom";
import { createDocumentAction } from "@/app/actions";
import { cn } from "@/lib/cn";
import { iconProps } from "./icon-button";

function SubmitButton({ variant }: { variant: "sidebar" | "primary" }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        "inline-flex items-center gap-2 rounded-sm font-medium transition-colors duration-100",
        variant === "sidebar"
          ? "h-8 w-full px-2 text-ui-sm text-ink hover:bg-hover disabled:text-ink-muted"
          : "h-9 bg-indigo px-3.5 text-ui text-on-indigo hover:bg-indigo-hover disabled:opacity-70",
      )}
    >
      <Plus {...iconProps} className={variant === "sidebar" ? "text-ink-muted" : undefined} />
      {pending ? "Creating" : "New document"}
    </button>
  );
}

export function NewDocumentButton({ variant = "sidebar" }: { variant?: "sidebar" | "primary" }) {
  return (
    <form action={createDocumentAction}>
      <SubmitButton variant={variant} />
    </form>
  );
}
