import {
  type Message,
  decodeMessage,
  encodeAck,
  encodeAwareness,
  encodeQueryAwareness,
  encodeSyncStep1,
  encodeSyncStep2,
  encodeUpdate,
} from "@brahma/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Awareness, encodeAwarenessUpdate } from "y-protocols/awareness";
import * as Y from "yjs";
import { BACKOFF_BASE_MS, BACKOFF_MAX_MS, type ProviderEnvironment, SAVING_AFTER_MS, SyncProvider } from "./provider";

const OPEN = 1;
const CLOSED = 3;

/** A WebSocket stand-in the test drives by hand. */
class FakeSocket {
  readyState = 0;
  binaryType = "blob";
  sent: Message[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {}

  send(data: Uint8Array): void {
    this.sent.push(decodeMessage(data));
  }

  close(): void {
    this.readyState = CLOSED;
  }

  open(): void {
    this.readyState = OPEN;
    this.onopen?.();
  }

  receive(data: Uint8Array): void {
    this.onmessage?.({ data: data.slice().buffer as ArrayBuffer });
  }

  drop(code = 1006): void {
    this.readyState = CLOSED;
    this.onclose?.({ code });
  }

  sentOf<T extends Message["type"]>(type: T): Array<Extract<Message, { type: T }>> {
    return this.sent.filter((message) => message.type === type) as Array<Extract<Message, { type: T }>>;
  }
}

function setup(options: { online?: boolean } = {}) {
  const sockets: FakeSocket[] = [];
  let online = options.online ?? true;
  const connectivity = new Set<() => void>();
  const environment: ProviderEnvironment = {
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    isOnline: () => online,
    onConnectivityChange: (listener) => {
      connectivity.add(listener);
      return () => connectivity.delete(listener);
    },
    random: () => 1,
  };
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  const server = new Y.Doc();
  const provider = new SyncProvider({ url: "ws://sync.test/documents/x", doc, awareness, environment });

  const socket = () => sockets.at(-1)!;
  /** Complete the handshake the way the server does. */
  const handshake = () => {
    socket().open();
    socket().receive(encodeSyncStep1(server));
    const clientStep1 = socket().sentOf("sync-step-1").at(-1)!;
    socket().receive(encodeSyncStep2(server, clientStep1.stateVector));
  };
  const setOnline = (value: boolean) => {
    online = value;
    connectivity.forEach((listener) => listener());
  };

  return { doc, awareness, server, provider, sockets, socket, handshake, setOnline };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", { OPEN, CLOSED });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("SyncProvider", () => {
  it("connects, sends Step 1 first, and is Saved after the handshake", () => {
    const { provider, socket, handshake } = setup();
    expect(provider.getStatus()).toBe("connecting");
    handshake();
    expect(socket().sent[0].type).toBe("sync-step-1");
    expect(provider.getStatus()).toBe("saved");
    expect(socket().binaryType).toBe("arraybuffer");
  });

  it("answers the server's Step 1 with its own Step 2", () => {
    const { doc, socket, handshake } = setup();
    doc.getText("body").insert(0, "made before connecting");
    handshake();
    const step2 = socket().sentOf("sync-step-2")[0];
    const check = new Y.Doc();
    Y.applyUpdate(check, step2.update);
    expect(check.getText("body").toString()).toBe("made before connecting");
  });

  it("sends local edits and shows Saving only when an ack is late", () => {
    const { doc, provider, socket, handshake } = setup();
    handshake();
    socket().receive(encodeAck(1)); // the handshake Step 2
    const acked = vi.fn();
    provider.onAllAcked(acked);
    socket().receive(encodeAck(1));
    expect(acked).not.toHaveBeenCalled(); // the handshake alone is not an edit

    doc.getText("body").insert(0, "hi");
    expect(socket().sentOf("update")).toHaveLength(1);
    expect(provider.hasUnconfirmedChanges).toBe(true);
    expect(provider.getStatus()).toBe("saved");

    vi.advanceTimersByTime(SAVING_AFTER_MS);
    expect(provider.getStatus()).toBe("saving");

    socket().receive(encodeAck(2));
    expect(provider.getStatus()).toBe("saved");
    expect(provider.hasUnconfirmedChanges).toBe(false);
    expect(acked).toHaveBeenCalledTimes(1);
  });

  it("does not show Saving when the ack arrives within a second", () => {
    const { doc, provider, socket, handshake } = setup();
    handshake();
    socket().receive(encodeAck(1));
    doc.getText("body").insert(0, "quick");
    vi.advanceTimersByTime(150);
    socket().receive(encodeAck(2));
    vi.advanceTimersByTime(SAVING_AFTER_MS * 2);
    expect(provider.getStatus()).toBe("saved");
  });

  it("applies remote updates with itself as origin and does not echo them", () => {
    const { doc, provider, server, socket, handshake } = setup();
    handshake();
    const origins: unknown[] = [];
    doc.on("update", (_update, origin) => origins.push(origin));
    const before = Y.encodeStateVector(server);
    server.getText("body").insert(0, "from a peer");
    socket().receive(encodeUpdate(Y.encodeStateAsUpdate(server, before)));

    expect(doc.getText("body").toString()).toBe("from a peer");
    expect(origins).toEqual([provider]);
    expect(socket().sentOf("update")).toHaveLength(0);
  });

  it("reconnects with growing, capped backoff and shows Reconnecting", () => {
    const { provider, sockets, socket, handshake } = setup();
    handshake();
    const delays: number[] = [];
    for (let attempt = 0; attempt < 7; attempt++) {
      const count = sockets.length;
      socket().drop();
      expect(provider.getStatus()).toBe("reconnecting");
      let waited = 0;
      while (sockets.length === count) {
        vi.advanceTimersByTime(100);
        waited += 100;
      }
      delays.push(waited);
    }
    // random() is 1, so each delay is the full ceiling.
    expect(delays.slice(0, 5)).toEqual([500, 1000, 2000, 4000, 8000]);
    expect(Math.max(...delays)).toBe(BACKOFF_MAX_MS);
    expect(BACKOFF_BASE_MS).toBe(500);
  });

  it("keeps offline edits, delivers them on reconnect, and warns until acked", () => {
    const { doc, provider, server, socket, handshake } = setup();
    handshake();
    socket().receive(encodeAck(1));
    socket().drop();
    doc.getText("body").insert(0, "written while disconnected");
    expect(provider.hasUnconfirmedChanges).toBe(true);

    vi.advanceTimersByTime(BACKOFF_BASE_MS);
    handshake();
    const step2 = socket().sentOf("sync-step-2").at(-1)!;
    Y.applyUpdate(server, step2.update);
    expect(server.getText("body").toString()).toBe("written while disconnected");
    expect(provider.hasUnconfirmedChanges).toBe(true);

    socket().receive(encodeAck(1));
    expect(provider.hasUnconfirmedChanges).toBe(false);
    expect(provider.getStatus()).toBe("saved");
  });

  it("treats an unacked edit at disconnect as unconfirmed", () => {
    const { doc, provider, socket, handshake } = setup();
    handshake();
    socket().receive(encodeAck(1));
    doc.getText("body").insert(0, "in flight");
    socket().drop();
    expect(provider.hasUnconfirmedChanges).toBe(true);
  });

  it("shows Offline and waits for the network instead of retrying", () => {
    const { provider, sockets, socket, handshake, setOnline } = setup();
    handshake();
    setOnline(false);
    expect(provider.getStatus()).toBe("offline");
    socket().drop();
    const count = sockets.length;
    vi.advanceTimersByTime(60_000);
    expect(sockets.length).toBe(count);
    expect(provider.getStatus()).toBe("offline");

    setOnline(true);
    expect(sockets.length).toBe(count + 1);
    expect(provider.getStatus()).toBe("reconnecting");
  });

  it("stops for good when the document is deleted or missing", () => {
    const deleted = setup();
    deleted.handshake();
    deleted.socket().drop(4410);
    expect(deleted.provider.getStatus()).toBe("deleted");
    vi.advanceTimersByTime(60_000);
    expect(deleted.sockets).toHaveLength(1);

    const missing = setup();
    missing.socket().open();
    missing.socket().drop(4404);
    expect(missing.provider.getStatus()).toBe("not-found");
  });

  it("sends presence on connect, on change, and when the server asks", () => {
    const { awareness, socket, handshake } = setup();
    awareness.setLocalStateField("user", { name: "Ada" });
    handshake();
    expect(socket().sentOf("awareness")).toHaveLength(1);
    awareness.setLocalStateField("user", { name: "Ada L" });
    expect(socket().sentOf("awareness")).toHaveLength(2);
    socket().receive(encodeQueryAwareness());
    expect(socket().sentOf("awareness")).toHaveLength(3);
  });

  it("applies peer presence and clears it when the connection drops", () => {
    const { awareness, socket, handshake } = setup();
    handshake();
    const peerDoc = new Y.Doc();
    const peer = new Awareness(peerDoc);
    peer.setLocalStateField("user", { name: "Grace" });
    socket().receive(encodeAwareness(encodeAwarenessUpdate(peer, [peerDoc.clientID])));
    expect(awareness.getStates().get(peerDoc.clientID)).toEqual({ user: { name: "Grace" } });

    socket().drop();
    expect(awareness.getStates().has(peerDoc.clientID)).toBe(false);
    peer.destroy();
  });

  it("removes its own presence and closes on destroy", () => {
    const { awareness, doc, provider, socket, handshake } = setup();
    awareness.setLocalStateField("user", { name: "Ada" });
    handshake();
    provider.destroy();
    expect(awareness.getStates().has(doc.clientID)).toBe(false);
    expect(socket().readyState).toBe(CLOSED);
  });
});
