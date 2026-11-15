import "client-only";
import { TITLE_FIELD } from "@brahma/protocol";
import * as Y from "yjs";
import { type DocumentMeta, LocalStore, StorageFullError } from "./local-store";

/** Updates replayed from this device's store or the page's server snapshot. */
export const LOAD_ORIGIN = Symbol("load");
/** Updates relayed from another tab on this device (that tab stored them). */
export const TAB_ORIGIN = Symbol("tab");
/** Updates received from the sync server. */
export const REMOTE_ORIGIN = Symbol("remote");

/** Compact the acknowledged updates once there are this many rows. */
export const COMPACT_AFTER_ROWS = 200;
const REMOTE_BATCH_MS = 300;
/** A title change is saved to the device's document list after this pause. */
export const TITLE_SAVE_MS = 500;

/** A local edit as the provider sees it. */
export interface LocalEdit {
  update: Uint8Array;
  createdAt: number;
  /** Resolves with the store sequence number, or null if it could not be written. */
  seq: Promise<number | null>;
}

/** Something to send to the server: a stored pending row or an edit only in memory. */
export interface PendingEntry {
  update: Uint8Array;
  seq: number | null;
  edit: LocalEdit | null;
}

type Listener = () => void;

let persistenceRequested = false;

/**
 * Ask the browser not to evict this site's storage under pressure. Asked on
 * the first local edit rather than on load, so browsers that prompt (Firefox)
 * do so when it is clearly useful.
 */
function requestPersistentStorage(): void {
  if (persistenceRequested || typeof navigator === "undefined") return;
  persistenceRequested = true;
  void navigator.storage?.persist?.().catch(() => false);
}

function mergeToState(updates: Uint8Array[]): Uint8Array {
  const doc = new Y.Doc();
  for (const update of updates) Y.applyUpdate(doc, update);
  return Y.encodeStateAsUpdate(doc);
}

/**
 * One document's Y.Doc, bound to the on-device store.
 *
 * Every update is classified by its transaction origin:
 *   LOAD_ORIGIN, TAB_ORIGIN  already stored; ignored
 *   REMOTE_ORIGIN            the server has it; stored (batched) as acknowledged
 *   anything else            a local edit (typing, title, undo); stored as pending
 */
export class LocalDocument {
  readonly doc = new Y.Doc();
  private meta: DocumentMeta | null = null;
  private readonly unwritten = new Set<LocalEdit>();
  /** Edits that could not be written (storage full); still need to reach the server. */
  private readonly memoryOnly: LocalEdit[] = [];
  private readonly editListeners = new Set<(edit: LocalEdit) => void>();
  private readonly changeListeners = new Set<Listener>();
  private remoteBatch: Uint8Array[] = [];
  private remoteTimer: ReturnType<typeof setTimeout> | null = null;
  private titleTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  /** Set by dispose(): this page writes nothing more for this document. */
  private disposed = false;
  storageFull = false;
  /** Local edits on this device the server has not acknowledged (all tabs, as of the last count). */
  pendingCount = 0;

  private constructor(
    readonly store: LocalStore | null,
    readonly docId: string,
  ) {}

  /**
   * Open a document: apply what this device has, then the page's server
   * snapshot (harmless if older). Ready to render as soon as this resolves.
   */
  static async open(store: LocalStore | null, docId: string, serverSnapshot: Uint8Array): Promise<LocalDocument> {
    const local = new LocalDocument(store, docId);
    const loaded = store ? await store.loadDocument(docId) : { meta: null, base: [], pending: [] };
    local.meta = loaded.meta;
    local.pendingCount = loaded.pending.length;
    local.doc.transact(() => {
      for (const update of loaded.base) Y.applyUpdate(local.doc, update);
      for (const row of loaded.pending) Y.applyUpdate(local.doc, row.update);
      if (serverSnapshot.byteLength > 0) Y.applyUpdate(local.doc, serverSnapshot);
    }, LOAD_ORIGIN);
    if (store) {
      // Opening is when a document is first stored on this device, so this
      // is the one place that creates its record (see LocalStore).
      local.meta = await store.createDocument(docId, { lastOpenedAt: Date.now() }).catch(() => local.meta);
      // First time on this device: keep the snapshot so the document opens offline.
      if (loaded.base.length === 0 && serverSnapshot.byteLength > 2) {
        await store.appendRemote(docId, serverSnapshot).catch(() => {});
      }
    }
    local.doc.on("update", local.onUpdate);
    local.doc.getText(TITLE_FIELD).observe(local.onTitle);
    return local;
  }

  /** Synced with the server at least once on this device. */
  get everSynced(): boolean {
    return this.meta?.everSynced ?? false;
  }

  get halted(): boolean {
    return this.meta?.halted ?? false;
  }

  /** When the oldest local edit not yet written on the device was made. */
  get unwrittenSince(): number | null {
    let oldest: number | null = null;
    for (const edit of [...this.unwritten, ...this.memoryOnly]) {
      if (oldest === null || edit.createdAt < oldest) oldest = edit.createdAt;
    }
    return oldest;
  }

  /** Called for every local edit, after it starts being written. */
  onLocalEdit(listener: (edit: LocalEdit) => void): () => void {
    this.editListeners.add(listener);
    return () => this.editListeners.delete(listener);
  }

  /** Called when unwritten edits, storage state or metadata change. */
  onChange(listener: Listener): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  /** The store, while this page may still write to it for this document. */
  private get writable(): LocalStore | null {
    return this.disposed ? null : this.store;
  }

  /** Everything not yet acknowledged, oldest first: stored rows, then memory-only edits. */
  async pendingEntries(): Promise<PendingEntry[]> {
    const rows = this.writable ? await this.writable.listPending(this.docId) : [];
    return [
      ...rows.map((row) => ({ update: row.update, seq: row.seq, edit: null })),
      ...this.memoryOnly.map((edit) => ({ update: edit.update, seq: null, edit })),
    ];
  }

  /** The server stored these entries. */
  async acknowledge(entries: readonly PendingEntry[]): Promise<void> {
    const seqs: number[] = [];
    for (const entry of entries) {
      if (entry.seq !== null) seqs.push(entry.seq);
      else if (entry.edit) {
        const seq = await entry.edit.seq;
        if (seq !== null) seqs.push(seq);
        const index = this.memoryOnly.indexOf(entry.edit);
        if (index !== -1) this.memoryOnly.splice(index, 1);
      }
    }
    const store = this.writable;
    if (store && seqs.length > 0) await store.acknowledge(this.docId, seqs).catch(() => {});
    await this.recount();
  }

  /** Re-read how many local edits are still waiting for the server. */
  async recount(): Promise<void> {
    const stored = this.writable ? (await this.writable.listPending(this.docId).catch(() => [])).length : 0;
    this.pendingCount = stored + this.memoryOnly.length;
    this.emitChange();
  }

  async markSynced(): Promise<void> {
    const store = this.writable;
    if (!store || this.meta?.everSynced) return;
    const fields = { everSynced: true, title: this.doc.getText(TITLE_FIELD).toString() };
    this.meta = (await store.updateMeta(this.docId, fields).catch(() => null)) ?? this.meta;
    this.emitChange();
  }

  async setHalted(halted: boolean): Promise<void> {
    const store = this.writable;
    if (store) this.meta = (await store.updateMeta(this.docId, { halted }).catch(() => null)) ?? this.meta;
    this.emitChange();
  }

  /** Fold acknowledged updates into one snapshot once there are many. Call under the flush lock. */
  async compactIfNeeded(): Promise<void> {
    const store = this.writable;
    if (!store) return;
    await this.flushRemote();
    if ((await store.updateCount(this.docId)) >= COMPACT_AFTER_ROWS) {
      await store.compact(this.docId, mergeToState);
    }
  }

  /** Write any batched remote updates now. */
  async flushRemote(): Promise<void> {
    if (this.remoteTimer) clearTimeout(this.remoteTimer);
    this.remoteTimer = null;
    const batch = this.remoteBatch;
    this.remoteBatch = [];
    const store = this.writable;
    if (!store || batch.length === 0) return;
    await store.appendRemote(this.docId, Y.mergeUpdates(batch)).catch(() => {});
  }

  /**
   * Stop writing this document to the device, for good, before its local
   * copy is deleted (access removed, deleted on the server, sign-out). The
   * title save and batched remote updates are dropped, and later edits,
   * acknowledgements and compactions write nothing. The Y.Doc stays usable
   * in memory, so the page can still offer a download. Resolves once local
   * edits already being written have settled, so the store is final.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.titleTimer) clearTimeout(this.titleTimer);
    if (this.remoteTimer) clearTimeout(this.remoteTimer);
    this.titleTimer = null;
    this.remoteTimer = null;
    this.remoteBatch = [];
    await Promise.all([...this.unwritten].map((edit) => edit.seq));
  }

  /** The page is done with this document (unmount): write what is batched, then stop listening. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.doc.off("update", this.onUpdate);
    this.doc.getText(TITLE_FIELD).unobserve(this.onTitle);
    void this.flushRemote();
    if (this.titleTimer) clearTimeout(this.titleTimer);
  }

  private onUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === LOAD_ORIGIN || origin === TAB_ORIGIN) return;
    if (origin === REMOTE_ORIGIN) {
      if (this.disposed) return;
      this.remoteBatch.push(update);
      this.remoteTimer ??= setTimeout(() => void this.flushRemote(), REMOTE_BATCH_MS);
      return;
    }
    this.recordLocalEdit(update);
  };

  private recordLocalEdit(update: Uint8Array): void {
    requestPersistentStorage();
    const edit: LocalEdit = { update, createdAt: Date.now(), seq: Promise.resolve(null) };
    this.pendingCount += 1;
    const store = this.writable;
    if (store && !this.storageFull) {
      this.unwritten.add(edit);
      // Rejects without writing if the document is no longer stored (deleted
      // by another tab): the edit then stays in memory, like a full disk.
      edit.seq = store.appendLocal(this.docId, update).then(
        (seq) => {
          this.unwritten.delete(edit);
          this.emitChange();
          return seq;
        },
        (error: unknown) => {
          this.unwritten.delete(edit);
          if (error instanceof StorageFullError) this.storageFull = true;
          this.memoryOnly.push(edit);
          this.emitChange();
          return null;
        },
      );
    } else {
      this.memoryOnly.push(edit);
    }
    this.emitChange();
    this.editListeners.forEach((listener) => listener(edit));
  }

  private onTitle = (): void => {
    if (!this.writable) return;
    if (this.titleTimer) clearTimeout(this.titleTimer);
    this.titleTimer = setTimeout(() => {
      this.titleTimer = null;
      const store = this.writable;
      if (store) void store.updateMeta(this.docId, { title: this.doc.getText(TITLE_FIELD).toString() }).catch(() => {});
    }, TITLE_SAVE_MS);
  };

  private emitChange(): void {
    this.changeListeners.forEach((listener) => listener());
  }
}
