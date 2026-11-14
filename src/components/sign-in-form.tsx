"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { RATE_LIMITED } from "@/lib/copy";

export function SignInForm({ next, googleEnabled }: { next: string; googleEnabled: boolean }) {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sendLink = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const address = email.trim().toLowerCase();
    const { error: failure } = await authClient.signIn.magicLink({ email: address, callbackURL: next });
    setBusy(false);
    if (failure) {
      setError(failure.status === 429 ? RATE_LIMITED : "Couldn't send the link. Try again.");
      return;
    }
    setSentTo(address);
  };

  return (
    <div className="w-full max-w-sm">
      <p className="text-brand font-semibold tracking-[-0.01em] text-ink">Brahma</p>
      <h1 className="mt-8 font-document text-[30px] leading-[1.2] font-semibold text-ink">Sign in to Brahma</h1>

      {sentTo ? (
        <p role="status" className="mt-4 text-ui text-ink" data-testid="magic-link-sent">
          Check your email. We sent a sign-in link to {sentTo}.
        </p>
      ) : (
        <div className="mt-8 flex flex-col gap-4">
          {googleEnabled && (
            <>
              <button
                type="button"
                onClick={() => void authClient.signIn.social({ provider: "google", callbackURL: next })}
                className="h-10 rounded-sm border border-hairline-strong bg-raised text-ui font-medium text-ink transition-colors duration-100 hover:bg-hover"
              >
                Continue with Google
              </button>
              <div className="flex items-center gap-3 text-meta text-ink-muted" aria-hidden>
                <span className="h-px flex-1 bg-hairline" />
                or
                <span className="h-px flex-1 bg-hairline" />
              </div>
            </>
          )}
          <form onSubmit={sendLink} className="flex flex-col gap-2">
            <label htmlFor="email" className="text-ui-sm font-medium text-ink">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="focus-inset h-10 rounded-sm border border-hairline-strong bg-raised px-3 text-ui text-ink outline-none focus:border-indigo"
            />
            <button
              type="submit"
              disabled={busy}
              className="mt-2 h-10 rounded-sm bg-indigo text-ui font-medium text-on-indigo transition-colors duration-100 hover:bg-indigo-hover disabled:opacity-70"
            >
              Email me a sign-in link
            </button>
          </form>
          {error && (
            <p role="alert" className="text-ui-sm text-madder">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
