import type { Metadata } from "next";
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
    <main id="main" className="flex min-h-dvh items-start justify-center bg-paper px-4 pt-[18vh]">
      <SignInForm next={next} googleEnabled={googleEnabled} />
    </main>
  );
}
