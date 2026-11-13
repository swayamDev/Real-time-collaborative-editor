import Link from "next/link";

/** Shown in place of the editor when the sync server says the document is gone. */
export function DocumentGone({ reason }: { reason: "deleted" | "not-found" }) {
  return (
    <div className="doc-column pt-14 sm:pt-24" data-testid="document-gone">
      <h1 className="doc-title is-quiet">
        {reason === "deleted" ? "This document was deleted." : "This document doesn't exist."}
      </h1>
      <p className="mt-2 text-[19px] leading-[1.65] text-ink-muted">
        {reason === "deleted"
          ? "It was deleted and no longer syncs."
          : "It may have been deleted, or the link is wrong."}
      </p>
      <Link
        href="/"
        className="mt-8 inline-flex h-9 items-center rounded-sm bg-indigo px-3.5 font-ui text-ui font-medium text-on-indigo transition-colors duration-100 hover:bg-indigo-hover"
      >
        Go to your documents
      </Link>
    </div>
  );
}
