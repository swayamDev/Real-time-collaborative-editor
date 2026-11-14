"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="main" className="flex-1 overflow-y-auto">
      <div className="doc-column pt-16 sm:pt-24">
        <h1 className="doc-title is-quiet">Something went wrong.</h1>
        <p className="mt-2 text-[19px] leading-[1.65] text-ink-muted">
          Brahma couldn&apos;t load this page. Your saved work is not affected.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-8 inline-flex h-9 items-center rounded-sm bg-indigo px-3.5 font-ui text-ui font-medium text-on-indigo transition-colors duration-100 hover:bg-indigo-hover"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
