"use client";

import { displayTitle } from "@/lib/title";
import { TopBar } from "../top-bar";

export function DocumentEditor({ initialTitle }: { id: string; initialTitle: string; initialState: string }) {
  return (
    <>
      <TopBar title={displayTitle(initialTitle)} />
      <main id="main" className="flex-1 overflow-y-auto">
        <div className="doc-column pt-16">
          <h1 className="doc-title">{displayTitle(initialTitle)}</h1>
        </div>
      </main>
    </>
  );
}
