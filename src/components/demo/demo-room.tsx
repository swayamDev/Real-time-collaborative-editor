"use client";

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { DocumentBanner } from "../editor/document-banner";
import { CollaborativeBody } from "../editor/document-editor";
import { STATUS_LABELS } from "@/lib/collab/status";
import { useSyncStatus } from "../editor/use-sync-session";
import { type DemoSeat, SEAT_NAMES, useDemoSession } from "./demo-session";
import { StartDemoButton } from "./start-demo-button";

function minutesLeft(expiresAt: number): number {
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / 60_000));
}

function Countdown({ expiresAt }: { expiresAt: number }) {
  const [minutes, setMinutes] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setMinutes(minutesLeft(expiresAt));
    tick();
    const timer = setInterval(tick, 15_000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  if (minutes === null) return null;
  return (
    <span data-testid="demo-countdown">
      {minutes === 0 ? "This demo has ended." : `This demo ends in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`}
    </span>
  );
}

function PaneMessage({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 px-5 py-8 text-ui text-ink" data-testid="demo-pane-message">
      <p>{children}</p>
      {action}
    </div>
  );
}

function DemoPane({ documentId, seat, canGoOffline }: { documentId: string; seat: DemoSeat; canGoOffline: boolean }) {
  const [online, setOnline] = useState(true);
  const [generation, setGeneration] = useState(0);
  const session = useDemoSession(documentId, seat, online, generation);
  const status = useSyncStatus(session);
  // Nothing is kept on the device in the demo: offline, edits wait in this pane.
  const label = status === "saved-on-device" ? "Offline" : STATUS_LABELS[status];
  const editorRef = useRef<Editor | null>(null);
  const titleRef = useRef<HTMLTextAreaElement | null>(null);

  let body: React.ReactNode;
  if (status === "seat-moved") {
    body = (
      <PaneMessage
        action={
          <button
            type="button"
            onClick={() => setGeneration((value) => value + 1)}
            className="h-8 rounded-sm border border-hairline-strong bg-raised px-3 text-ui-sm font-medium text-ink hover:bg-hover"
          >
            Use {SEAT_NAMES[seat]} here
          </button>
        }
      >
        {SEAT_NAMES[seat]} is open on another device.
      </PaneMessage>
    );
  } else if (status === "demo-limit") {
    body = <PaneMessage action={<StartDemoButton label="Start a new demo" />}>This demo is full.</PaneMessage>;
  } else if (status === "deleted" || status === "not-found" || status === "revoked") {
    body = <PaneMessage action={<StartDemoButton label="Start a new demo" />}>This demo has ended.</PaneMessage>;
  } else {
    body = (
      <>
        {status === "halted" && (
          <DocumentBanner
            testId="sync-halted"
            message="This demo couldn't sync."
            secondaryAction={{ label: "Try again", onClick: () => session?.provider.retry() }}
          />
        )}
        <div className="doc-column min-h-48 py-6">
          {session ? (
            <CollaborativeBody
              key={session.local.doc.guid}
              doc={session.local.doc}
              session={session}
              readOnly={false}
              editorRef={editorRef}
              titleRef={titleRef}
              onNotice={() => {}}
            />
          ) : (
            <div className="doc-prose doc-body" />
          )}
        </div>
      </>
    );
  }

  return (
    <section
      aria-label={SEAT_NAMES[seat]}
      data-testid={`demo-pane-${seat}`}
      className="flex min-w-0 flex-col rounded-sm border border-hairline bg-paper"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-hairline px-4 py-2.5">
        <h2 className="text-ui font-semibold text-ink">{SEAT_NAMES[seat]}</h2>
        <span role="status" aria-live="polite" data-testid={`demo-status-${seat}`} data-status={status} className="text-ui-sm text-ink-muted">
          {label}
        </span>
        {canGoOffline && (
          <button
            type="button"
            data-testid="demo-offline-toggle"
            aria-pressed={!online}
            onClick={() => setOnline((value) => !value)}
            className="ml-auto h-8 rounded-sm border border-hairline-strong bg-raised px-3 text-ui-sm font-medium text-ink hover:bg-hover"
          >
            {online ? "Go offline" : "Go online"}
          </button>
        )}
      </header>
      {body}
    </section>
  );
}

export function DemoRoom({
  documentId,
  expiresAt,
  seats,
  joinUrl,
  qrCode,
}: {
  documentId: string;
  expiresAt: number;
  /** "ab" on the device that started the demo; "b" on a device that joined. */
  seats: "ab" | "b";
  joinUrl: string | null;
  /** An SVG data URL of the join link, when there is one. */
  qrCode: string | null;
}) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-2">
        <p className="text-brand font-semibold tracking-[-0.01em] text-ink">Brahma demo</p>
        <p className="max-w-3xl text-ui text-ink-muted">
          {seats === "ab"
            ? "Two visitors, one document. Type in either pane: every edit goes through the sync server to the other. Try Go offline on Visitor B, type in both panes, then Go online and watch the edits merge."
            : "You are Visitor B. Type here and the other device sees it live; edits from there appear here."}{" "}
          <Countdown expiresAt={expiresAt} />
        </p>
      </div>
      <div className={seats === "ab" ? "grid gap-4 md:grid-cols-2" : "grid gap-4"}>
        {seats === "ab" && <DemoPane documentId={documentId} seat="a" canGoOffline={false} />}
        <DemoPane documentId={documentId} seat="b" canGoOffline />
      </div>
      {joinUrl && qrCode && (
        <details className="max-w-3xl rounded-sm border border-hairline bg-sunken px-4 py-3 text-ui text-ink">
          <summary className="cursor-pointer font-medium">Open Visitor B on another device</summary>
          <div className="mt-3 flex flex-wrap items-start gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- a generated data URL, nothing to optimize */}
            <img src={qrCode} alt="QR code for the Visitor B link" width={160} height={160} className="rounded-sm bg-white p-2" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <p className="text-ink-muted">
                Scan it, or open the link on a phone. That device becomes Visitor B, and this page&apos;s Visitor B pane
                steps aside. The link works only for this demo, until it ends.
              </p>
              <a href={joinUrl} className="break-all text-indigo underline underline-offset-2" data-testid="demo-join-link">
                {joinUrl}
              </a>
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
