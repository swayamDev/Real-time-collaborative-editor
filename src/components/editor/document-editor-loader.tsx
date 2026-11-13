"use client";

import dynamic from "next/dynamic";
import { createContext, useContext } from "react";
import { displayTitle } from "@/lib/title";
import { TopBar } from "../top-bar";

interface SkeletonInfo {
  title: string;
}

// next/dynamic's loading component receives no props, so the skeleton reads
// what it needs from context.
const SkeletonContext = createContext<SkeletonInfo>({ title: "" });

/**
 * Same box model as the editor: top bar, title, then a body area with the
 * editor's minimum height reserved, so nothing moves when it mounts.
 */
function EditorSkeleton() {
  const { title } = useContext(SkeletonContext);
  const empty = title.trim() === "";
  return (
    <>
      <TopBar title={displayTitle(title)} titleMuted={empty} />
      <main id="main" className="flex-1 overflow-y-auto" aria-busy="true">
        <article className="doc-column pt-14 sm:pt-24">
          <h1 className={empty ? "doc-title text-ink-muted" : "doc-title"} data-testid="title-skeleton">
            {displayTitle(title)}
          </h1>
          <div className="doc-prose doc-body mt-6" />
        </article>
      </main>
    </>
  );
}

// ssr: false keeps the editor, TipTap and Yjs out of every server bundle.
// Next drops this import from the server build entirely.
const DocumentEditor = dynamic(() => import("./document-editor").then((mod) => mod.DocumentEditor), {
  ssr: false,
  loading: EditorSkeleton,
});

type DocumentEditorProps = React.ComponentProps<typeof DocumentEditor>;

export function DocumentEditorLoader(props: DocumentEditorProps & { initialTitle: string }) {
  return (
    <SkeletonContext.Provider value={{ title: props.initialTitle }}>
      <DocumentEditor {...props} />
    </SkeletonContext.Provider>
  );
}
