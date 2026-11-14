import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { TopBar } from "@/components/top-bar";
import { isDocumentId } from "@/lib/ids";
import { requireUserOrRedirect } from "@/server/session";
import { joinByLink } from "@/server/sharing";
import { scheduleAccessChanges } from "@/server/sync";

export const metadata: Metadata = { title: "Shared document" };

/** Opening a share link: requires sign-in, then grants the link's role (never lowering one). */
export default async function ShareLinkPage({ params }: PageProps<"/s/[id]/[token]">) {
  const { id, token } = await params;
  const user = await requireUserOrRedirect(`/s/${id}/${token}`);
  if (isDocumentId(id)) {
    const result = await joinByLink(id, token, user.id);
    if (result.ok) {
      if (result.change) scheduleAccessChanges(id, [result.change]);
      redirect(`/d/${id}`);
    }
  }
  return (
    <>
      <TopBar />
      <main id="main" className="flex-1 overflow-y-auto">
        <div className="doc-column pt-14 sm:pt-24" data-testid="share-link-invalid">
          <h1 className="doc-title is-quiet">This link doesn&apos;t work.</h1>
          <p className="mt-2 text-[19px] leading-[1.65] text-ink-muted">
            It was turned off or replaced. Ask the owner for a new one.
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
