import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Brahma stores about you, where it is kept, and how to have it deleted.",
};

const REPOSITORY = "https://github.com/swayamDev/Real-time-collaborative-editor";
const NEW_ISSUE = `${REPOSITORY}/issues/new`;
const SECURITY_POLICY = `${REPOSITORY}/security/policy`;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="font-document text-[24px] leading-[1.25] font-semibold text-ink">{title}</h2>
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

function List({ children }: { children: React.ReactNode }) {
  return <ul className="flex list-disc flex-col gap-2 pl-6 marker:text-ink-muted">{children}</ul>;
}

function External({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="text-indigo underline underline-offset-2 hover:no-underline" rel="noreferrer" target="_blank">
      {children}
    </a>
  );
}

/**
 * Public: reachable signed out (proxy.ts) and never kept in a user's page
 * cache (sw/cache-policy.mjs). Keep it in step with what the app does; the
 * README's "Privacy policy" section lists what to update when that changes.
 */
export default function PrivacyPage() {
  return (
    <main id="main" className="min-h-dvh bg-paper pt-14 pb-24 sm:pt-24">
      <article className="doc-column leading-[1.65] text-ink">
        <p className="font-ui text-brand font-semibold tracking-[-0.01em] text-ink">
          <Link href="/sign-in">Brahma</Link>
        </p>
        <h1 className="doc-title mt-8">Privacy policy</h1>
        <p className="mt-4 font-ui text-ui text-ink-muted">Last updated 16 November 2026</p>

        <p className="mt-8">
          Brahma is a collaborative document editor. This page explains what it stores about you, where it is kept,
          who else handles it, and how to have it deleted. Brahma is a personal project, not a company.
        </p>

        <Section title="What is stored">
          <List>
            <li>
              <strong>Your account.</strong> If you sign in with Google: your name, email address and the link to your
              profile picture, and the sign-in tokens Google returns, which are kept with your account and used for
              nothing else. If you sign in with an emailed link: your email address only (the part before the @ is shown
              as your name).
            </li>
            <li>
              <strong>Your sign-ins.</strong> Each sign-in keeps you signed in for up to 30 days. It is stored with the IP
              address and browser description (user agent) it came from.
            </li>
            <li>
              <strong>Your documents.</strong> Their titles and content, including the edit history needed to merge
              changes made by several people. Also who owns each document and who can open it: the people it is shared
              with, invitations (the invited email address, the role, and who sent it), and share links.
            </li>
            <li>
              <strong>Abuse limits.</strong> Counts of recent attempts, such as sign-in links requested, kept against an
              IP address or an email address so that nobody can flood an inbox or the service.
            </li>
            <li>
              <strong>Sign-in links.</strong> A record of each emailed link until it is used or expires, after 10
              minutes.
            </li>
            <li>
              <strong>The demo.</strong> If you try the demo, what you type in it is kept for 30 minutes, then deleted.
              The demo needs no account and stores no name or email address. Starting one is counted against your IP
              address, to limit how many demos one address can start.
            </li>
          </List>
          <p>
            While you have a document open, the people you share it with see your name, picture, colour and cursor. The
            owner of a document can see the names and email addresses of everyone who has access to it.
          </p>
        </Section>

        <Section title="Where it is kept">
          <List>
            <li>
              <strong>Database:</strong> Neon Postgres, in Singapore. Before each update of the app, a backup copy of the
              database is made; the three most recent are kept. Neon can also restore the database to any point in the
              last 6 hours.
            </li>
            <li>
              <strong>App:</strong> hosted by Vercel, with servers in Singapore. Every page you load passes through
              Vercel, which keeps request logs (address, time, page) for about an hour.
            </li>
            <li>
              <strong>Real-time sync:</strong> Cloudflare. While a document is open, edits pass through Cloudflare, and a
              working copy is kept in the Cloudflare data centre nearest to whoever opened it first, then saved to the
              database. Cloudflare keeps short-lived logs of requests to the sync service (time, document identifier, and
              why a connection was refused), without document content.
            </li>
            <li>
              <strong>Your device:</strong> so documents open quickly and work offline, your browser keeps copies of the
              documents you opened, edits not yet sent, and copies of pages, in IndexedDB and the browser&apos;s cache.
              Signing out deletes them. If someone else signs in on the same browser, the previous person&apos;s copies
              are deleted first. When you lose access to a document, its copy is deleted from your device.
            </li>
          </List>
        </Section>

        <Section title="Who else handles it">
          <List>
            <li>
              <strong>Google,</strong> if you choose to sign in with Google.
            </li>
            <li>
              <strong>Resend</strong> sends sign-in links and invitation emails. It receives the recipient&apos;s address
              and the email itself (the link, and for an invitation, the document title and who sent it).
            </li>
            <li>
              <strong>Sentry</strong> receives reports when something breaks, so it can be fixed. Before a report leaves
              the app, names, email addresses, IP addresses, cookies, request details, sign-in tokens and share-link
              tokens are removed. No sessions are recorded and no performance tracing is sent.
            </li>
            <li>
              <strong>Neon, Vercel and Cloudflare,</strong> as described above.
            </li>
          </List>
        </Section>

        <Section title="Cookies and browser storage">
          <List>
            <li>
              <strong>Sign-in cookies</strong> keep you signed in (up to 30 days). They cannot be read by the page&apos;s
              scripts.
            </li>
            <li>
              <strong>brahma-theme</strong> and <strong>brahma-sidebar</strong> remember your light or dark choice and
              whether the sidebar is open (one year).
            </li>
            <li>
              <strong>brahma-demo</strong>, only if you start the demo or open a demo link: which demo is yours and
              which visitor you are. It expires when the demo ends, after 30 minutes, and cannot be read by the
              page&apos;s scripts.
            </li>
            <li>
              <strong>Browser storage:</strong> the document copies and page copies described above, a note to finish
              signing out if you signed out while offline, and a note that stops an update from reloading the page
              twice.
            </li>
          </List>
          <p>There are no analytics, advertising or tracking cookies.</p>
        </Section>

        <Section title="What is not done">
          <p>
            Your data is not sold, not shared for advertising, and not used for analytics or tracking. Your documents
            are used only to show them to you and to the people you share them with.
          </p>
        </Section>

        <Section title="Deleting your data">
          <List>
            <li>
              <strong>Documents:</strong> deleting a document removes it for everyone at once and erases its title and
              content from the database immediately. Only a record that it existed and was deleted remains, so devices
              that were offline learn about it. The content then remains only in database backups: Neon&apos;s restore
              history, for 6 hours, and the copies made before each update of the app, until three newer ones replace
              them.
            </li>
            <li>
              <strong>This device:</strong> signing out deletes everything Brahma keeps in your browser.
            </li>
            <li>
              <strong>Your account:</strong> there is no button for this yet. To have your account and everything
              stored about you erased (sign-ins, documents you own, your access to other documents, and invitations),
              open an issue asking for it. Do not post your email address or other personal details there: you will get a reply in
              the issue to arrange a private way to confirm the account is yours.
            </li>
          </List>
        </Section>

        <Section title="Contact">
          <p>
            Questions or requests: <External href={NEW_ISSUE}>open an issue on GitHub</External>. Issues are public, so
            leave out personal details. To report a security problem privately, follow the{" "}
            <External href={SECURITY_POLICY}>security policy</External>.
          </p>
          <p>If this policy changes, this page will show the new date.</p>
        </Section>
      </article>
    </main>
  );
}
