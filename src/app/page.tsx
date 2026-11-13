import { redirect } from "next/navigation";
import { NewDocumentButton } from "@/components/new-document-button";
import { TopBar } from "@/components/top-bar";
import { listDocuments } from "@/server/documents";

export default async function Home() {
  const [latest] = await listDocuments();
  if (latest) redirect(`/d/${latest.id}`);

  return (
    <>
      <TopBar />
      <main id="main" className="flex-1 overflow-y-auto">
        <div className="doc-column pt-16 sm:pt-24">
          <h1 className="doc-title is-quiet">No documents yet.</h1>
          <p className="mt-2 text-[19px] leading-[1.65] text-ink-muted">Create your first document.</p>
          <div className="mt-8 font-ui">
            <NewDocumentButton variant="primary" />
          </div>
        </div>
      </main>
    </>
  );
}
