"use client";

import { Ellipsis } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { renameDocumentAction } from "@/app/actions";
import { cn } from "@/lib/cn";
import { TITLE_MAX_LENGTH, displayTitle } from "@/lib/title";
import type { DocumentSummary } from "@/server/documents";
import { useDocuments } from "./app-shell";
import { iconProps } from "./icon-button";
import { Menu } from "./menu";
import { RelativeTime } from "./relative-time";

interface DocumentRowProps {
  document: DocumentSummary;
  active: boolean;
  onRequestDelete: () => void;
}

export function DocumentRow({ document, active, onRequestDelete }: DocumentRowProps) {
  const { setTitle, touch } = useDocuments();
  const [renaming, setRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = displayTitle(document.title);
  const untitled = document.title.trim() === "";

  const commitRename = async (value: string) => {
    setRenaming(false);
    if (value === document.title) return;
    const previous = document.title;
    setError(null);
    setTitle(document.id, value);
    try {
      const result = await renameDocumentAction(document.id, value);
      if (!result.ok) {
        setTitle(document.id, previous);
        setError(result.error);
        return;
      }
      setTitle(document.id, result.value.title);
      touch(document.id, result.value.updatedAt);
    } catch {
      setTitle(document.id, previous);
      setError("Couldn't rename. Check your connection and try again.");
    }
  };

  return (
    <li className="group relative">
      {renaming ? (
        <input
           
          autoFocus
          aria-label="Document title"
          defaultValue={document.title}
          maxLength={TITLE_MAX_LENGTH}
          placeholder="Untitled"
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void commitRename(event.currentTarget.value);
            } else if (event.key === "Escape") {
              event.preventDefault();
              setRenaming(false);
            }
          }}
          onBlur={(event) => void commitRename(event.currentTarget.value)}
          className="focus-inset h-8 w-full rounded-sm border border-indigo bg-raised px-2 text-ui-sm text-ink outline-none placeholder:text-ink-muted"
        />
      ) : (
        <>
          <Link
            href={`/d/${document.id}`}
            aria-current={active ? "page" : undefined}
            onDoubleClick={() => setRenaming(true)}
            className={cn(
              "focus-inset flex h-8 items-center gap-2 rounded-sm px-2 text-ui-sm transition-colors duration-100",
              active ? "bg-indigo-tint font-medium text-ink" : "text-ink hover:bg-hover",
            )}
          >
            <span className={cn("min-w-0 flex-1 truncate", untitled && "text-ink-muted")}>{label}</span>
            <RelativeTime
              iso={document.updatedAt}
              className={cn(
                "shrink-0 text-meta text-ink-muted tabular-nums group-focus-within:invisible group-hover:invisible pointer-coarse:invisible",
                menuOpen && "invisible",
              )}
            />
          </Link>
          <div
            className={cn(
              "absolute top-0 right-0 flex h-8 items-center pr-0.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100",
              menuOpen && "opacity-100",
            )}
          >
            <Menu
              onOpenChange={setMenuOpen}
              items={[
                { label: "Rename", onSelect: () => setRenaming(true) },
                { label: "Delete", destructive: true, onSelect: onRequestDelete },
              ]}
              trigger={(props) => (
                <button
                  {...props}
                  type="button"
                  aria-label={`Actions for ${label}`}
                  title="Actions"
                  className="inline-flex size-7 items-center justify-center rounded-sm text-ink-muted hover:bg-hover hover:text-ink"
                >
                  <Ellipsis {...iconProps} />
                </button>
              )}
            />
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="px-2 pt-1 pb-1.5 text-meta text-madder">
          {error}
        </p>
      )}
    </li>
  );
}
