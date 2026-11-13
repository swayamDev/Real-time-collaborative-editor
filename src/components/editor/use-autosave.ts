"use client";

import { useEffect, useState } from "react";
import type * as Y from "yjs";
import { AutosaveController, type SaveStatus, createHttpTransport } from "@/lib/autosave";

export type { SaveStatus };

interface AutosaveOptions {
  id: string;
  ydoc: Y.Doc;
  /** Called with the server's updatedAt after every confirmed save. */
  onSaved: (updatedAt: string) => void;
}

/**
 * Binds an AutosaveController to the page lifecycle: warns before unload
 * while changes are unconfirmed, saves on hide, and saves pending changes
 * when navigating to another document inside the app.
 */
export function useAutosave({ id, ydoc, onSaved }: AutosaveOptions) {
  const [status, setStatus] = useState<SaveStatus>("saved");
  // Created during the first render, before the editor can produce any update.
  const [controller] = useState(
    () =>
      new AutosaveController(ydoc, createHttpTransport(id), {
        onStatus: setStatus,
        onSaved,
      }),
  );
  useEffect(() => controller.setOnSaved(onSaved), [controller, onSaved]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!controller.hasUnconfirmedChanges) return;
      // Keepalive when the body fits in 64 KiB, a normal fetch otherwise.
      // The prompt stays either way until the server confirms.
      void controller.flush({ unloading: true });
      event.preventDefault();
      event.returnValue = "";
    };
    const onPageHide = () => {
      if (controller.dirty) void controller.flush({ unloading: true });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden" && controller.dirty) void controller.flush({ unloading: true });
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [controller]);

  // Leaving this document inside the app: the page stays alive, so a normal
  // fetch completes after unmount. Development StrictMode remounts are
  // harmless: the flush is a no-op when nothing is pending and start()
  // re-attaches the listener.
  useEffect(() => {
    controller.start();
    return () => {
      if (controller.dirty) void controller.flush();
      controller.stop();
    };
  }, [controller]);

  return {
    status,
    saveTitle: (title: string) => controller.titleChanged(title),
    saveNow: () => void controller.flush(),
  };
}
