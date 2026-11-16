import Link from "next/link";

/**
 * A full page message outside the app shell (404, errors): the brand, a
 * heading, one line, and a clear way back. Server and client safe.
 */
export function StandaloneMessage({
  title,
  message,
  action,
  link = { href: "/", label: "Go to Brahma" },
}: {
  title: string;
  message: string;
  /** A button, for "Try again". */
  action?: { label: string; onClick: () => void };
  link?: { href: string; label: string };
}) {
  const primary =
    "inline-flex h-9 items-center rounded-sm bg-indigo px-3.5 font-ui text-ui font-medium text-on-indigo transition-colors duration-100 hover:bg-indigo-hover";
  const secondary =
    "inline-flex h-9 items-center rounded-sm border border-hairline-strong bg-raised px-3.5 font-ui text-ui font-medium text-ink transition-colors duration-100 hover:bg-hover";
  return (
    <main id="main" className="min-h-dvh bg-paper">
      <div className="doc-column pt-16 sm:pt-24">
        <Link href="/" className="font-ui text-brand font-semibold tracking-[-0.01em] text-ink">
          Brahma
        </Link>
        <h1 className="doc-title is-quiet mt-10">{title}</h1>
        <p className="mt-2 text-[19px] leading-[1.65] text-ink-muted">{message}</p>
        <div className="mt-8 flex flex-wrap gap-3">
          {action && (
            <button type="button" onClick={action.onClick} className={primary}>
              {action.label}
            </button>
          )}
          <Link href={link.href} className={action ? secondary : primary} data-testid="way-back">
            {link.label}
          </Link>
        </div>
      </div>
    </main>
  );
}
