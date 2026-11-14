"use client";

import { initials } from "@brahma/protocol";
import { useState, useSyncExternalStore } from "react";
import type { Awareness } from "y-protocols/awareness";
import { cn } from "@/lib/cn";
import { type Participant, onCollabVar, participants } from "@/lib/collab/presence";

const MAX_AVATARS = 4;

function useParticipants(awareness: Awareness): Participant[] {
  const [store] = useState(() => {
    let snapshot = participants(awareness);
    return {
      subscribe(listener: () => void) {
        const onChange = () => {
          snapshot = participants(awareness);
          listener();
        };
        awareness.on("change", onChange);
        return () => awareness.off("change", onChange);
      },
      get: () => snapshot,
    };
  });
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

function Avatar({ participant, className }: { participant: Participant; className?: string }) {
  if (participant.image) {
    // The ring in the person's color keeps photos matched to their caret.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={participant.image}
        alt=""
        width={24}
        height={24}
        referrerPolicy="no-referrer"
        className={cn("size-6 rounded-full ring-2", className)}
        style={{ ["--tw-ring-color" as string]: `var(--collab-${participant.color})` }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-6 items-center justify-center rounded-full text-[10px] leading-none font-semibold ring-2 ring-paper",
        className,
      )}
      style={{ background: `var(--collab-${participant.color})`, color: onCollabVar(participant.color) }}
    >
      {initials(participant.name)}
    </span>
  );
}

/**
 * Who is here: you first, then others in join order, up to four, then "+N".
 * Names and avatars come from accounts (the sync server rewrites them from
 * the token) and render as text and https images only.
 */
export function PresenceBar({ awareness }: { awareness: Awareness }) {
  const people = useParticipants(awareness);
  const self = people.find((person) => person.isSelf);
  const others = people.filter((person) => !person.isSelf);
  const shown = others.slice(0, MAX_AVATARS - 1);
  const hidden = others.length - shown.length;

  if (!self) return null;

  const summary =
    others.length === 0
      ? "Only you are here"
      : `Here now: you, ${others.map((person) => person.name).join(", ")}`;

  return (
    <div className="relative flex items-center" data-testid="presence">
      <span className="sr-only">{summary}</span>
      <span title={`${self.name} (you)`} data-testid="self-avatar" data-name={self.name} className="mr-1.5 inline-flex">
        <Avatar participant={self} />
      </span>
      <ul className="flex items-center -space-x-1.5 pr-1.5" aria-hidden>
        {shown.map((person) => (
          <li key={person.clientId} title={person.name} data-testid="peer-avatar" data-name={person.name}>
            <Avatar participant={person} />
          </li>
        ))}
        {hidden > 0 && (
          <li
            title={others.slice(shown.length).map((person) => person.name).join(", ")}
            className="inline-flex size-6 items-center justify-center rounded-full bg-sunken text-[10px] font-semibold text-ink-muted ring-2 ring-paper"
          >
            +{hidden}
          </li>
        )}
      </ul>
    </div>
  );
}
