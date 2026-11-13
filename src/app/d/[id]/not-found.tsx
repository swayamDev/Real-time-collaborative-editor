import Link from "next/link";
import { TopBar } from "@/components/top-bar";

export default function DocumentNotFound() {
  return (
    <>
      <TopBar />
      <main id="main" className="flex-1 overflow-y-auto">
        <div className="doc-column pt-16 sm:pt-24">
          <h1 className="doc-title is-quiet">This document doesn&apos;t exist.</h1>
          <p className="mt-2 text-[19px] leading-[1.65] text-ink-muted">
            It may have been deleted, or the link is wrong.
          </p>
          <Link
            href="/"
            className="mt-8 inline-flex h-9 items-center rounded-sm bg-indigo px-3.5 font-ui text-ui font-medium text-on-indigo transition-colors duration-100 hover:bg-indigo-hover"
          >
            Go to your documents
          </Link>
        </div>
      </main>
    </>
  );
}
