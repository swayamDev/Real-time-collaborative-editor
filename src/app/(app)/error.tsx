"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect } from "react";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <main id="main" className="flex-1 overflow-y-auto">
      <div className="doc-column pt-16 sm:pt-24">
        <h1 className="doc-title is-quiet">Something went wrong.</h1>
        <p className="mt-2 text-[19px] leading-[1.65] text-ink-muted">
          Brahma couldn&apos;t load this page. Your saved work is not affected.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-9 items-center rounded-sm bg-indigo px-3.5 font-ui text-ui font-medium text-on-indigo transition-colors duration-100 hover:bg-indigo-hover"
          >
            Try again
          </button>
          <Link
            href="/"
            className="inline-flex h-9 items-center rounded-sm border border-hairline-strong bg-raised px-3.5 font-ui text-ui font-medium text-ink transition-colors duration-100 hover:bg-hover"
          >
            Go to your documents
          </Link>
        </div>
      </div>
    </main>
  );
}
