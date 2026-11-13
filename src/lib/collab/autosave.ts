import "client-only";
import * as Y from "yjs";
import { chooseTransport } from "./save-transport";
import { encodeUpdateSince } from "./yjs";

export type SaveStatus = "saved" | "saving" | "error";

/** How saves reach the server. Each call resolves with the server's updatedAt. */
export interface SaveTransportApi {
  saveContent(update: Uint8Array, options: { keepalive: boolean }): Promise<string | undefined>;
  saveTitle(title: string, options: { keepalive: boolean }): Promise<string | undefined>;
}

export interface AutosaveTiming {
  debounceMs: number;
  maxWaitMs: number;
  retryBaseMs: number;
  maxRetryMs: number;
}

export const DEFAULT_TIMING: AutosaveTiming = {
  debounceMs: 800,
  maxWaitMs: 5_000,
  retryBaseMs: 2_000,
  maxRetryMs: 30_000,
};

interface AutosaveHooks {
  onStatus: (status: SaveStatus) => void;
  onSaved: (updatedAt: string) => void;
}

/**
 * Debounced autosave for one Y.Doc.
 *
 * Each save sends Y.encodeStateAsUpdate(doc, ackedStateVector): the changes
 * the server has not confirmed yet. Dirty tracking counts Y.Doc update events
 * instead of comparing state vectors, because deletions do not advance the
 * state vector.
 *
 * Construct it right after loading the stored state, before any edit, so the
 * acknowledged state vector matches what the server has.
 */
export class AutosaveController {
  private ackedStateVector: Uint8Array;
  private version = 0;
  private ackedVersion = 0;
  private pendingTitle: string | null = null;
  private inFlight = false;
  private queued = false;
  private failures = 0;
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private maxWaitTimer?: ReturnType<typeof setTimeout>;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private status: SaveStatus = "saved";
  private stopped = false;

  constructor(
    private readonly doc: Y.Doc,
    private readonly transport: SaveTransportApi,
    private hooks: AutosaveHooks,
    private readonly timing: AutosaveTiming = DEFAULT_TIMING,
  ) {
    this.ackedStateVector = Y.encodeStateVector(doc);
    doc.on("update", this.onUpdate);
  }

  /** Unsaved local changes exist. */
  get dirty(): boolean {
    return this.version !== this.ackedVersion || this.pendingTitle !== null;
  }

  /** Something is not yet confirmed by the server. */
  get hasUnconfirmedChanges(): boolean {
    return this.dirty || this.inFlight;
  }

  /** Replace the saved callback (React passes a fresh closure on render). */
  setOnSaved(onSaved: (updatedAt: string) => void): void {
    this.hooks = { ...this.hooks, onSaved };
  }

  titleChanged(title: string): void {
    this.pendingTitle = title;
    this.schedule();
  }

  /** Save now. On unload, uses keepalive when the body fits in 64 KiB. */
  async flush({ unloading = false }: { unloading?: boolean } = {}): Promise<void> {
    this.clearTimers();

    if (this.inFlight) {
      this.queued = true;
      return;
    }
    if (!this.dirty) {
      this.publishStatus();
      return;
    }

    this.inFlight = true;
    this.publishStatus();

    const versionAtSend = this.version;
    const content = this.version !== this.ackedVersion ? encodeUpdateSince(this.doc, this.ackedStateVector) : null;
    const title = this.pendingTitle;
    const titleBytes = title === null ? 0 : new TextEncoder().encode(JSON.stringify({ title })).byteLength;
    const keepalive = chooseTransport((content?.update.byteLength ?? 0) + titleBytes, unloading) === "keepalive";

    try {
      const results = await Promise.all([
        content ? this.transport.saveContent(content.update, { keepalive }) : undefined,
        title !== null ? this.transport.saveTitle(title, { keepalive }) : undefined,
      ]);

      if (content) {
        this.ackedStateVector = content.stateVector;
        this.ackedVersion = versionAtSend;
      }
      if (title !== null && this.pendingTitle === title) this.pendingTitle = null;
      this.failures = 0;

      const updatedAt = results
        .filter((value): value is string => typeof value === "string")
        .sort()
        .at(-1);
      if (updatedAt) this.hooks.onSaved(updatedAt);
    } catch {
      this.failures += 1;
      if (!this.stopped) {
        const delay = Math.min(this.timing.maxRetryMs, this.timing.retryBaseMs * 2 ** (this.failures - 1));
        this.retryTimer = setTimeout(() => void this.flush(), delay);
      }
    } finally {
      this.inFlight = false;
    }

    if (this.queued && this.failures === 0) {
      this.queued = false;
      await this.flush();
      return;
    }
    this.queued = false;
    this.publishStatus();
  }

  /** Re-attach after stop(). Safe to call when already running. */
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.doc.on("update", this.onUpdate);
  }

  /**
   * Detach from the document and cancel timers. A save already in flight
   * still completes, but failures are not retried.
   */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.clearTimers();
    this.doc.off("update", this.onUpdate);
  }

  private onUpdate = () => {
    this.version += 1;
    this.schedule();
  };

  private schedule(): void {
    if (this.stopped) return;
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.flush(), this.timing.debounceMs);
    this.maxWaitTimer ??= setTimeout(() => void this.flush(), this.timing.maxWaitMs);
    this.publishStatus();
  }

  private clearTimers(): void {
    clearTimeout(this.debounceTimer);
    clearTimeout(this.maxWaitTimer);
    clearTimeout(this.retryTimer);
    this.debounceTimer = undefined;
    this.maxWaitTimer = undefined;
    this.retryTimer = undefined;
  }

  private publishStatus(): void {
    const next: SaveStatus =
      this.failures > 0 ? "error" : this.inFlight || this.dirty ? "saving" : "saved";
    if (next !== this.status) {
      this.status = next;
      this.hooks.onStatus(next);
    }
  }
}

/** The production transport: binary POST for content, JSON PATCH for the title. */
export function createHttpTransport(documentId: string): SaveTransportApi {
  async function send(url: string, init: RequestInit): Promise<string | undefined> {
    const response = await fetch(url, init);
    if (!response.ok) throw new Error(`Save failed with status ${response.status}`);
    const body = (await response.json()) as { updatedAt?: unknown };
    return typeof body.updatedAt === "string" ? body.updatedAt : undefined;
  }

  return {
    saveContent: (update, { keepalive }) =>
      send(`/api/documents/${documentId}/state`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: update as Uint8Array<ArrayBuffer>,
        keepalive,
      }),
    saveTitle: (title, { keepalive }) =>
      send(`/api/documents/${documentId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title }),
        keepalive,
      }),
  };
}
