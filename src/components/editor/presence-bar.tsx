"use client";

import { NAME_MAX_LENGTH, initials } from "@brahma/protocol";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import type { Awareness } from "y-protocols/awareness";
import { cn } from "@/lib/cn";
import { saveGuestName } from "@/lib/collab/identity";
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
 * Who is here: your avatar first (it opens the name field), then others in
 * join order, up to four, then "+N". Names render as text only.
 */
export function PresenceBar({ awareness }: { awareness: Awareness }) {
  const people = useParticipants(awareness);
  const self = people.find((person) => person.isSelf);
  const others = people.filter((person) => !person.isSelf);
  const shown = others.slice(0, MAX_AVATARS - 1);
  const hidden = others.length - shown.length;
  const [editing, setEditing] = useState(false);

  if (!self) return null;

  const summary =
    others.length === 0
      ? "Only you are here"
      : `Here now: you, ${others.map((person) => person.name).join(", ")}`;

  return (
    <div className="relative flex items-center" data-testid="presence">
      <span className="sr-only">{summary}</span>
      <button
        type="button"
        onClick={() => setEditing((open) => !open)}
        aria-expanded={editing}
        aria-label={`Your name: ${self.name}. Change it`}
        title={`${self.name} (you)`}
        data-testid="self-avatar"
        className="mr-1.5 rounded-full"
      >
        <Avatar participant={self} />
      </button>
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
      {editing && <NameField awareness={awareness} current={self.name} onClose={() => setEditing(false)} />}
    </div>
  );
}

function NameField({ awareness, current, onClose }: { awareness: Awareness; current: string; onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const id = useId();

  useEffect(() => {
    inputRef.current?.select();
    const onPointerDown = (event: PointerEvent) => {
      if (!formRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [onClose]);

  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        const name = saveGuestName(inputRef.current?.value ?? "");
        const user = awareness.getLocalState()?.user ?? {};
        awareness.setLocalStateField("user", { ...user, name });
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
      }}
      className="animate-menu-in absolute top-full right-0 z-50 mt-2 w-64 rounded-md border border-hairline bg-raised p-3 shadow-float"
    >
      <label htmlFor={id} className="block text-ui-sm font-medium text-ink">
        Your name
      </label>
      <p className="mt-0.5 text-meta text-ink-muted">Shown to others next to your cursor.</p>
      <div className="mt-2 flex gap-2">
        <input
          ref={inputRef}
          id={id}
          defaultValue={current}
          maxLength={NAME_MAX_LENGTH}
          autoComplete="nickname"
          className="focus-inset h-8 min-w-0 flex-1 rounded-sm border border-hairline-strong bg-paper px-2 text-ui-sm text-ink outline-none focus:border-indigo"
        />
        <button
          type="submit"
          className="h-8 rounded-sm bg-indigo px-3 text-ui-sm font-medium text-on-indigo transition-colors duration-100 hover:bg-indigo-hover"
        >
          Save
        </button>
      </div>
    </form>
  );
}
