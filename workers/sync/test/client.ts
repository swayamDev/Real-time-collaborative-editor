import { type Message, decodeMessage, encodeSyncStep2, encodeUpdate } from "@brahma/protocol";
import { SELF } from "cloudflare:test";
import * as Y from "yjs";

export function newDocumentId(): string {
  return crypto.randomUUID();
}

export interface Closed {
  code: number;
  reason: string;
}

/**
 * A minimal protocol client for tests. It keeps every message it receives
 * and mirrors the document in its own Y.Doc.
 */
export class TestClient {
  readonly doc = new Y.Doc();
  readonly received: Message[] = [];
  closed: Closed | null = null;
  private waiters: Array<() => void> = [];

  private constructor(readonly ws: WebSocket) {
    ws.binaryType = "arraybuffer";
    ws.addEventListener("message", (event) => {
      const message = decodeMessage(new Uint8Array(event.data as ArrayBuffer));
      this.received.push(message);
      if (message.type === "sync-step-2" || message.type === "update") {
        Y.applyUpdate(this.doc, message.update, "remote");
      }
      this.notify();
    });
    ws.addEventListener("close", (event) => {
      this.closed = { code: event.code, reason: event.reason };
      this.notify();
    });
  }

  static async connect(documentId: string, headers: Record<string, string> = {}): Promise<TestClient> {
    const response = await SELF.fetch(`http://sync.test/documents/${documentId}`, {
      headers: { Upgrade: "websocket", ...headers },
    });
    if (!response.webSocket) throw new Error(`No WebSocket: ${response.status}`);
    response.webSocket.accept();
    return new TestClient(response.webSocket);
  }

  private notify(): void {
    const waiters = this.waiters;
    this.waiters = [];
    waiters.forEach((resolve) => resolve());
  }

  /** Wait until `predicate` holds, re-checking after every event. */
  async until(predicate: () => boolean, label = "condition", timeoutMs = 3000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!predicate()) {
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for ${label} (closed: ${JSON.stringify(this.closed)})`);
      }
      await Promise.race([
        new Promise<void>((resolve) => this.waiters.push(resolve)),
        new Promise((resolve) => setTimeout(resolve, 50)),
      ]);
    }
  }

  count(type: Message["type"]): number {
    return this.received.filter((message) => message.type === type).length;
  }

  last<T extends Message["type"]>(type: T): Extract<Message, { type: T }> | undefined {
    return this.received.filter((message) => message.type === type).at(-1) as
      | Extract<Message, { type: T }>
      | undefined;
  }

  send(data: Uint8Array | string): void {
    this.ws.send(data);
  }

  /** Make an edit locally and send it, like the editor would. */
  edit(change: (doc: Y.Doc) => void): void {
    const before = Y.encodeStateVector(this.doc);
    change(this.doc);
    this.send(encodeUpdate(Y.encodeStateAsUpdate(this.doc, before)));
  }

  /** Answer the server's Step 1 with our Step 2, completing the handshake. */
  answerStep1(): void {
    const step1 = this.last("sync-step-1");
    if (!step1) throw new Error("No step 1 received");
    this.send(encodeSyncStep2(this.doc, step1.stateVector));
  }

  text(field = "body"): string {
    return this.doc.getText(field).toString();
  }

  close(): void {
    this.ws.close(1000, "done");
  }
}
