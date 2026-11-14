import "client-only";
import * as Y from "yjs";
import { LOAD_ORIGIN, REMOTE_ORIGIN, TAB_ORIGIN } from "./local-document";

type TabMessage = { type: "update"; update: Uint8Array } | { type: "hello"; stateVector: Uint8Array };

/**
 * Keeps tabs of the same document on this device in sync, with or without
 * a network. Each tab relays only its own local edits; the receiving tab
 * applies them with TAB_ORIGIN, so they are not stored or queued twice
 * (the tab that made them did both). A tab that opens says hello with its
 * state vector and the others answer with anything it lacks.
 */
export class TabChannel {
  private readonly channel: BroadcastChannel;
  private closed = false;
  /** Off for viewers: their copy only takes changes from the server. */
  private acceptEdits = true;

  constructor(
    docId: string,
    private readonly doc: Y.Doc,
  ) {
    this.channel = new BroadcastChannel(`brahma-doc:${docId}`);
    this.channel.onmessage = (event: MessageEvent<TabMessage>) => this.onMessage(event.data);
    doc.on("update", this.onUpdate);
    this.post({ type: "hello", stateVector: Y.encodeStateVector(doc) });
  }

  /**
   * A viewer must not pick up edits another tab made but never synced (a
   * stale tab, or one that lost write access); the server is its only source.
   */
  setAcceptEdits(accept: boolean): void {
    this.acceptEdits = accept;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.doc.off("update", this.onUpdate);
    this.channel.close();
  }

  private onUpdate = (update: Uint8Array, origin: unknown): void => {
    if (origin === TAB_ORIGIN || origin === LOAD_ORIGIN || origin === REMOTE_ORIGIN) return;
    this.post({ type: "update", update });
  };

  private onMessage(message: TabMessage): void {
    if (this.closed || !message || !this.acceptEdits) return;
    if (message.type === "update" && message.update instanceof Uint8Array) {
      Y.applyUpdate(this.doc, message.update, TAB_ORIGIN);
    } else if (message.type === "hello" && message.stateVector instanceof Uint8Array) {
      const missing = Y.encodeStateAsUpdate(this.doc, message.stateVector);
      // An update with no structs and an empty delete set is two bytes.
      if (missing.byteLength > 2) this.post({ type: "update", update: missing });
    }
  }

  private post(message: TabMessage): void {
    if (!this.closed) this.channel.postMessage(message);
  }
}
