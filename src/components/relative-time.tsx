"use client";

import { useSyncExternalStore } from "react";
import { formatAbsoluteDate, formatFullTimestamp, formatRelativeTime } from "@/lib/relative-time";

// One shared clock for every timestamp on the page, ticking every 30 seconds.
let now = Date.now();
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((notify) => notify());
    }, 30_000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) clearInterval(timer);
  };
}

const getSnapshot = () => now;
// Server render and hydration have no clock, so they show an absolute date.
const getServerSnapshot = () => null;

export function RelativeTime({ iso, className }: { iso: string; className?: string }) {
  const clock = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const label = clock === null ? formatAbsoluteDate(iso) : formatRelativeTime(iso, clock);
  return (
    <time dateTime={iso} title={clock === null ? undefined : `Edited ${formatFullTimestamp(iso)}`} className={className}>
      {label}
    </time>
  );
}
