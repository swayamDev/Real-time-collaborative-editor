"use client";

import dynamic from "next/dynamic";

// ssr: false keeps the editor, TipTap and Yjs out of every server bundle
// (scripts/check-bundles.mjs), as for the document page.
export const DemoRoomLoader = dynamic(() => import("./demo-room").then((module) => module.DemoRoom), {
  ssr: false,
  loading: () => <div className="mx-auto min-h-[60vh] w-full max-w-6xl px-4 py-8 sm:px-6" aria-busy="true" />,
});
