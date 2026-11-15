import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/sign-in-form";
import { safeReturnPath } from "@/lib/safe-redirect";
import { getCurrentUser } from "@/server/session";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const next = safeReturnPath(((await searchParams).next as string | undefined) ?? "/");
  if (await getCurrentUser()) redirect(next);
  const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center bg-paper px-4 pt-[18vh] pb-8">
      <SignInForm next={next} googleEnabled={googleEnabled} />
      <footer className="mt-auto pt-16 text-meta text-ink-muted">
        <Link href="/privacy" className="underline-offset-2 hover:text-ink hover:underline">
          Privacy policy
        </Link>
      </footer>
    </main>
  );
}
