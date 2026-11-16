import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import QRCode from "qrcode";
import { DemoRoom, StartDemoButton } from "@/components/demo/demo-room";
import { DEMO_COOKIE, readDemoPass, writeDemoPass } from "@/server/demo";

export const metadata: Metadata = {
  title: "Demo",
  description: "See live collaboration in Brahma without an account.",
  robots: { index: false },
};

/**
 * "Try the demo": public (proxy.ts) and never kept in a user's page cache
 * (sw/cache-policy.mjs). Starting a demo is a form post to a server action;
 * a visit alone creates nothing.
 */
export default async function DemoPage({ searchParams }: PageProps<"/demo">) {
  const params = await searchParams;
  const pass = readDemoPass((await cookies()).get(DEMO_COOKIE)?.value);

  if (pass) {
    let joinUrl: string | null = null;
    let qrCode: string | null = null;
    if (pass.seats === "ab") {
      const origin = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
      joinUrl = `${origin}/demo/join?pass=${encodeURIComponent(writeDemoPass({ ...pass, seats: "b" }))}`;
      const svg = await QRCode.toString(joinUrl, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
      qrCode = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    }
    return (
      <main id="main" className="min-h-dvh bg-sunken">
        <DemoRoom documentId={pass.documentId} expiresAt={pass.expiresAt} seats={pass.seats} joinUrl={joinUrl} qrCode={qrCode} />
      </main>
    );
  }

  return (
    <main id="main" className="flex min-h-dvh flex-col items-center bg-paper px-4 pt-[18vh] pb-8">
      <div className="w-full max-w-md">
        <p className="text-brand font-semibold tracking-[-0.01em] text-ink">Brahma</p>
        <h1 className="mt-8 font-document text-[30px] leading-[1.2] font-semibold text-ink">Try the demo</h1>
        <p className="mt-4 text-ui text-ink-muted">
          Two visitors edit one document side by side, through the real sync server, with live cursors. One of them
          can go offline and merge later. No account needed; the demo document is deleted after 30 minutes.
        </p>
        {params.busy && (
          <p role="alert" className="mt-4 text-ui text-madder" data-testid="demo-busy">
            The demo is busy right now. Try again later, or sign in to use Brahma.
          </p>
        )}
        {params.ended && (
          <p role="status" className="mt-4 text-ui text-ink" data-testid="demo-ended">
            That demo has ended. Start a new one.
          </p>
        )}
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <StartDemoButton />
          <Link href="/sign-in" className="text-ui text-indigo underline-offset-2 hover:underline">
            Sign in instead
          </Link>
        </div>
      </div>
      <footer className="mt-auto pt-16 text-meta text-ink-muted">
        <Link href="/privacy" className="underline-offset-2 hover:text-ink hover:underline">
          Privacy policy
        </Link>
      </footer>
    </main>
  );
}
