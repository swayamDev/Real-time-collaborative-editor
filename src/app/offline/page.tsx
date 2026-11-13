import type { Metadata } from "next";
import { OfflineDocuments } from "@/components/offline-documents";
import { TopBar } from "@/components/top-bar";

export const metadata: Metadata = { title: "Offline" };

/**
 * Cached by the service worker at install and served for any page it has
 * no copy of while offline. The inline script records which address was
 * asked for, before the router settles on this route's own URL.
 */
export default function OfflinePage() {
  return (
    <>
      <script
        dangerouslySetInnerHTML={{ __html: "window.__brahmaRequestedPath=window.location.pathname;" }}
      />
      <TopBar />
      <main id="main" className="flex-1 overflow-y-auto">
        <OfflineDocuments />
      </main>
    </>
  );
}
