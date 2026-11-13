"use client";

import { Plus } from "lucide-react";
import { useFormStatus } from "react-dom";
import { createDocumentAction } from "@/app/actions";
import { cn } from "@/lib/cn";
import { iconProps } from "./icon-button";
import { useOnline } from "./use-device";

function SubmitButton({ variant }: { variant: "sidebar" | "primary" }) {
  const { pending } = useFormStatus();
  // Creating a document needs the server; offline creation is out of scope.
  const online = useOnline();
  return (
    <button
      type="submit"
      disabled={pending || !online}
      title={online ? undefined : "Available when you're back online."}
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
