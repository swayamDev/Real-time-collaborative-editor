import {
  BATCH_TARGET_BYTES,
  CLOSE_TOO_LARGE,
  type Message,
  decodeMessage,
  encodeAck,
  encodeAwareness,
  encodeRole,
  encodeSyncStep1,
  encodeSyncStep2,
} from "@brahma/protocol";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Awareness, encodeAwarenessUpdate } from "y-protocols/awareness";
import * as Y from "yjs";
import { LocalDocument, TAB_ORIGIN } from "./local-document";
import { LocalStore } from "./local-store";
import type { Role } from "../permissions";
import {
  BACKOFF_MAX_MS,
  type LockManagerLike,
  type ProviderEnvironment,
  SyncProvider,
  TOKEN_REFRESH_AT,
  clientsMissingOnServer,
  packEntries,
} from "./provider";
import type { TokenResult } from "./sync-token-client";

const OPEN = 1;
const CLOSED = 3;

/** Stands in for the Durable Object: same replies, acks and limits. */
class FakeServer {
  readonly doc = new Y.Doc();
  /** Every document message received, decoded. */
  readonly received: Uint8Array[] = [];
  rejectIf: (update: Uint8Array) => boolean = () => false;
  /** Close every new socket with this code before it opens, like the room refusing a token. */
  refuseWith: number | null = null;

  handle(socket: FakeSocket, message: Message): void {
    switch (message.type) {
      case "sync-step-1":
        socket.deliver(encodeSyncStep2(this.doc, message.stateVector));
        socket.deliver(encodeSyncStep1(this.doc));
        return;
      case "sync-step-2":
      case "update":
        if (this.rejectIf(message.update)) {
          socket.serverClose(CLOSE_TOO_LARGE);
          return;
        }
        this.received.push(message.update);
        Y.applyUpdate(this.doc, message.update);
        socket.acks += 1;
        socket.deliver(encodeAck(socket.acks));
        return;
      default:
        return;
    }
  }

  text(): string {
    return this.doc.getText("body").toString();
  }
}

class FakeSocket {
  readyState = 0;
  binaryType = "blob";
  acks = 0;
  readonly sent: Message[] = [];
  /** The subprotocols the client offered, as a browser would send them. */
  protocols: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(private readonly server: FakeServer) {
    queueMicrotask(() => {
      if (this.readyState !== 0) return;
      if (this.server.refuseWith !== null) return this.serverClose(this.server.refuseWith);
      this.readyState = OPEN;
      this.onopen?.();
      // The server's own Step 1 on connect.
      this.deliver(encodeSyncStep1(this.server.doc));
    });
  }

  send(data: Uint8Array): void {
    const message = decodeMessage(data);
    this.sent.push(message);
    queueMicrotask(() => {
      if (this.readyState === OPEN) this.server.handle(this, message);
    });
  }

  deliver(data: Uint8Array): void {
    queueMicrotask(() => {
      if (this.readyState === OPEN) this.onmessage?.({ data: data.slice().buffer as ArrayBuffer });
    });
  }

  close(): void {
    this.readyState = CLOSED;
  }

  serverClose(code: number): void {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    queueMicrotask(() => this.onclose?.({ code }));
  }
}

/** A Web Locks stand-in: one holder per name, others wait their turn. */
function fakeLocks(): LockManagerLike & { grants: string[] } {
  const queues = new Map<string, Promise<unknown>>();
  const grants: string[] = [];
  return {
    grants,
    request<T>(name: string, callback: () => Promise<T>): Promise<T> {
      const previous = queues.get(name) ?? Promise.resolve();
      const run = previous.catch(() => {}).then(() => {
        grants.push(name);
        return callback();
      });
      queues.set(name, run);
      return run;
    },
  };
}

const realSetImmediate = globalThis.setImmediate;

/** Let IndexedDB (real event loop) and fake timers both move forward. */
async function tick(ms = 10): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await new Promise((resolve) => realSetImmediate(resolve));
}

async function until(predicate: () => boolean | Promise<boolean>, label: string, steps = 400): Promise<void> {
  for (let i = 0; i < steps; i++) {
    if (await predicate()) return;
    await tick();
  }
  throw new Error(`Timed out waiting for ${label}`);
}

interface Tab {
  local: LocalDocument;
  provider: SyncProvider;
  sockets: FakeSocket[];
  setOnline: (online: boolean) => void;
  /** Token results to hand out next, in order; then the default. */
  tokens: TokenResult[];
  tokenRequests: number;
  learned: Array<Role | null>;
}

let tokenSerial = 0;
const okToken = (role: Role = "editor", expiresIn = 600): TokenResult => ({
  kind: "ok",
  token: `token-${++tokenSerial}`,
  role,
  expiresIn,
});

let factory: IDBFactory;
let store: LocalStore;
let server: FakeServer;
let online: boolean;
let locks: ReturnType<typeof fakeLocks>;
const connectivity = new Set<() => void>();
const tabs: Tab[] = [];

async function openTab(docId = "doc", options: { role?: Role; tokens?: TokenResult[] } = {}): Promise<Tab> {
  const sockets: FakeSocket[] = [];
  const role = options.role ?? "editor";
  const environment: ProviderEnvironment = {
    createSocket: (_url, protocols) => {
      const socket = new FakeSocket(server);
      socket.protocols = protocols;
      sockets.push(socket);
      return socket as unknown as WebSocket;
    },
    isOnline: () => online,
    onConnectivityChange: (listener) => {
      connectivity.add(listener);
      return () => connectivity.delete(listener);
    },
    random: () => 1,
    locks,
  };
  const local = await LocalDocument.open(store, docId, new Uint8Array());
  const awareness = new Awareness(local.doc);
  const tab = {
    local,
    provider: null as unknown as SyncProvider,
    sockets,
    setOnline: (value: boolean) => {
      online = value;
      connectivity.forEach((listener) => listener());
    },
    tokens: options.tokens ?? [],
    tokenRequests: 0,
    learned: [] as Array<Role | null>,
  };
  tab.provider = new SyncProvider({
    url: "ws://sync.test/documents/doc",
    local,
    awareness,
    environment,
    initialRole: role,
    schemaVersion: 3,
    fetchToken: async () => {
      tab.tokenRequests += 1;
      return tab.tokens.shift() ?? okToken(role);
    },
    onAccessLearned: (learned) => tab.learned.push(learned),
  });
  tabs.push(tab);
  return tab;
}

function type(local: LocalDocument, text: string): void {
  local.doc.getText("body").insert(local.doc.getText("body").length, text);
}

async function pendingCount(): Promise<number> {
  return (await store.listPending("doc")).length;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  vi.stubGlobal("WebSocket", { OPEN, CLOSED });
  factory = new IDBFactory();
  store = await LocalStore.open(factory);
  server = new FakeServer();
  online = true;
  locks = fakeLocks();
  connectivity.clear();
});

afterEach(() => {
  for (const tab of tabs.splice(0)) {
    tab.provider.destroy();
    tab.local.destroy();
  }
  store.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("connecting and live edits", () => {
  it("goes from Connecting to Saved after the handshake and an empty flush", async () => {
    const tab = await openTab();
    expect(tab.provider.getStatus()).toBe("connecting");
    await until(() => tab.provider.getStatus() === "saved", "saved");
    expect(tab.sockets[0].sent[0].type).toBe("sync-step-1");
  });

  it("sends live edits, and acknowledgements clear them from the device queue", async () => {
    const tab = await openTab();
    await until(() => tab.provider.getStatus() === "saved", "saved");
    type(tab.local, "hello");
    await until(() => server.text() === "hello", "server has the edit");
    await until(async () => (await pendingCount()) === 0, "queue cleared");
    expect(tab.provider.hasUnsavedChanges).toBe(false);
    await until(() => !tab.provider.hasPendingEdits, "nothing pending");
  });
});

describe("offline", () => {
  it("keeps edits on the device while offline and syncs them when back", async () => {
    online = false;
    const tab = await openTab();
    // Offline from the start: never "Connecting".
    expect(tab.provider.getStatus()).toBe("saved-on-device");
    type(tab.local, "written offline");
    await until(async () => (await pendingCount()) === 1, "stored on device");
    expect(tab.provider.getStatus()).toBe("saved-on-device");
    expect(tab.provider.hasUnsavedChanges).toBe(false);

    tab.setOnline(true);
    await until(() => server.text() === "written offline", "flushed");
    await until(() => tab.provider.getStatus() === "saved", "saved");
    expect(await pendingCount()).toBe(0);
  });

  it("splits more than 1 MiB of offline edits into messages under the batch size", async () => {
    online = false;
    const tab = await openTab();
    const chunk = "x".repeat(200_000);
    for (let i = 0; i < 7; i++) type(tab.local, chunk);
    await until(async () => (await pendingCount()) === 7, "stored on device");

    tab.setOnline(true);
    await until(() => server.text().length === 1_400_000, "all edits on server", 800);
    const updates = tab.sockets.at(-1)!.sent.filter((message) => message.type === "update");
    expect(updates.length).toBeGreaterThan(1);
    for (const message of updates) {
      if (message.type === "update") expect(message.update.byteLength).toBeLessThanOrEqual(BATCH_TARGET_BYTES + 1024);
    }
  });

  it("says Reconnecting. Saved on this device. when the socket drops but edits are written", async () => {
    const tab = await openTab();
    await until(() => tab.provider.getStatus() === "saved", "saved");
    tab.sockets.at(-1)!.serverClose(1006);
    await until(() => tab.provider.getStatus() === "reconnecting-local", "reconnecting, saved locally");
  });
});

describe("rejected edits", () => {
  it("halts instead of skipping an edit the server rejects even on its own", async () => {
    online = false;
    const tab = await openTab();
    type(tab.local, "first ");
    await until(async () => (await pendingCount()) === 1, "first stored");
    type(tab.local, "BAD ");
    await until(async () => (await pendingCount()) === 2, "second stored");
    type(tab.local, "third");
    await until(async () => (await pendingCount()) === 3, "third stored");

    const badText = new TextEncoder().encode("BAD");
    const contains = (haystack: Uint8Array, needle: Uint8Array) =>
      haystack.some((_, i) => needle.every((byte, j) => haystack[i + j] === byte));
    server.rejectIf = (update) => contains(update, badText);

    tab.setOnline(true);
    await until(() => tab.provider.getStatus() === "halted", "halted", 2_000);

    // The first edit went through; the rejected one and everything after it
    // stayed on the device, and nothing after it was ever sent.
    expect(server.text()).toBe("first ");
    expect(await pendingCount()).toBe(2);
    expect((await store.getMeta("doc"))?.halted).toBe(true);
    const socketsAtHalt = tab.sockets.length;
    await tick(BACKOFF_MAX_MS * 2);
    expect(tab.sockets.length).toBe(socketsAtHalt);
  });
});

describe("convergence", () => {
  it("sends what the server lacks even when the queue does not cover it", async () => {
    const tab = await openTab();
    await until(() => tab.provider.getStatus() === "saved", "saved");
    tab.sockets.at(-1)!.serverClose(1006);
    await until(() => tab.provider.getStatus() !== "saved", "disconnected");

    // An edit that never entered this tab's queue (as if a row were lost).
    tab.local.doc.transact(() => tab.local.doc.getText("body").insert(0, "not in the queue"), TAB_ORIGIN);
    expect(await pendingCount()).toBe(0);

    await tick(1_000);
    await until(() => server.text() === "not in the queue", "converged", 800);
    expect(clientsMissingOnServer(tab.local.doc, Y.encodeStateVector(server.doc))).toEqual([]);
  });
});

describe("two tabs", () => {
  it("only one tab flushes the queue when both reconnect at once", async () => {
    online = false;
    const a = await openTab();
    for (const word of ["one ", "two ", "three"]) type(a.local, word);
    await until(async () => (await pendingCount()) === 3, "stored");
    const b = await openTab();

    a.setOnline(true); // both tabs see the network return together
    await until(() => server.text() === "one two three", "flushed", 800);
    await until(
      () => a.provider.getStatus() === "saved" && b.provider.getStatus() === "saved",
      "both saved",
      800,
    );

    // The queued edits reached the server exactly once.
    const withQueue = server.received.filter((update) => {
      const probe = new Y.Doc();
      Y.applyUpdate(probe, update);
      return probe.getText("body").toString().length > 0;
    });
    expect(withQueue).toHaveLength(1);
    expect(locks.grants.filter((name) => name === "brahma-flush:doc").length).toBeGreaterThanOrEqual(2);
  });
});

describe("other states", () => {
  it("stops for good when the document is deleted", async () => {
    const tab = await openTab();
    await until(() => tab.provider.getStatus() === "saved", "saved");
    tab.sockets.at(-1)!.serverClose(4410);
    await until(() => tab.provider.getStatus() === "deleted", "deleted");
    await tick(BACKOFF_MAX_MS * 2);
    expect(tab.sockets).toHaveLength(1);
  });

  it("sends presence on connect and clears peers when the connection drops", async () => {
    const tab = await openTab();
    const awareness = (tab.provider as unknown as { options: { awareness: Awareness } }).options.awareness;
    awareness.setLocalStateField("user", { name: "Ada" });
    await until(() => tab.provider.getStatus() === "saved", "saved");
    const peerDoc = new Y.Doc();
    const peer = new Awareness(peerDoc);
    peer.setLocalStateField("user", { name: "Grace" });
    tab.sockets[0].deliver(encodeAwareness(encodeAwarenessUpdate(peer, [peerDoc.clientID])));
    await until(() => awareness.getStates().has(peerDoc.clientID), "peer present");
    tab.sockets[0].serverClose(1006);
    await until(() => !awareness.getStates().has(peerDoc.clientID), "peer cleared");
    peer.destroy();
  });
});

describe("sync tokens", () => {
  it("connects with brahma.v1, its schema version and the token as subprotocols", async () => {
    const tab = await openTab("doc", { tokens: [okToken("editor")] });
    await until(() => tab.provider.getStatus() === "saved", "saved");
    expect(tab.sockets[0].protocols).toEqual(["brahma.v1", "schema.3", `auth.token-${tokenSerial}`]);
  });

  it("refreshes the token in band at 70% of its lifetime, without reconnecting", async () => {
    const tab = await openTab();
    await until(() => tab.provider.getStatus() === "saved", "saved");
    await tick(600_000 * TOKEN_REFRESH_AT + 50);
    await until(() => tab.sockets[0].sent.some((message) => message.type === "auth"), "auth message");
    expect(tab.tokenRequests).toBe(2);
    expect(tab.sockets).toHaveLength(1);
  });

  it("shows session ended when the refresh finds the user signed out", async () => {
    const tab = await openTab();
    await until(() => tab.provider.getStatus() === "saved", "saved");
    tab.tokens.push({ kind: "signed-out" });
    await tick(600_000 * TOKEN_REFRESH_AT + 50);
    await until(() => tab.provider.getStatus() === "session-ended", "session ended");
    await tick(BACKOFF_MAX_MS * 2);
    expect(tab.sockets).toHaveLength(1);
  });

  it("never opens a socket when the first token request finds no session", async () => {
    const tab = await openTab("doc", { tokens: [{ kind: "signed-out" }] });
    await until(() => tab.provider.getStatus() === "session-ended", "session ended");
    expect(tab.sockets).toHaveLength(0);
  });

  it("retries with backoff while the app is unreachable", async () => {
    const tab = await openTab("doc", { tokens: [{ kind: "unavailable" }, { kind: "unavailable" }] });
    await until(() => tab.provider.getStatus() === "saved", "saved", 1_000);
    expect(tab.tokenRequests).toBe(3);
  });
});

describe("close codes", () => {
  it("4401: fetches a fresh token and reconnects once", async () => {
    const tab = await openTab();
    await until(() => tab.provider.getStatus() === "saved", "saved");
    tab.sockets[0].serverClose(4401);
    await until(() => tab.sockets.length === 2, "reconnected");
    expect(tab.tokenRequests).toBe(2);
    await until(() => tab.provider.getStatus() === "saved", "saved again");
  });

  it("4401 twice without a sync between ends the session instead of looping", async () => {
    const tab = await openTab();
    await until(() => tab.provider.getStatus() === "saved", "saved");
    // The room keeps refusing even fresh tokens (for example, a revoked session).
    server.refuseWith = 4401;
    tab.sockets[0].serverClose(4401);
    await until(() => tab.provider.getStatus() === "session-ended", "session ended");
    expect(tab.tokenRequests).toBe(2);
    await tick(BACKOFF_MAX_MS * 2);
    expect(tab.sockets).toHaveLength(2);
  });

  it("4403: revoked, never reconnects, and tells other tabs", async () => {
    const tab = await openTab();
    await until(() => tab.provider.getStatus() === "saved", "saved");
    tab.sockets[0].serverClose(4403);
    await until(() => tab.provider.getStatus() === "revoked", "revoked");
    await tick(BACKOFF_MAX_MS * 2);
    expect(tab.sockets).toHaveLength(1);
    expect(tab.learned).toContain(null);
  });

  it("4405: stops for downgrade handling as a viewer, without reconnecting itself", async () => {
    const tab = await openTab();
    await until(() => tab.provider.getStatus() === "saved", "saved");
    tab.sockets[0].serverClose(4405);
    await until(() => tab.provider.getStatus() === "downgraded", "downgraded");
    expect(tab.provider.getRole()).toBe("viewer");
    expect(tab.learned).toContain("viewer");
    await tick(BACKOFF_MAX_MS * 2);
    expect(tab.sockets).toHaveLength(1);
  });

  it("4405 as a viewer halts instead of looping", async () => {
    const tab = await openTab("doc", { role: "viewer" });
    await until(() => tab.provider.getStatus() === "saved", "saved");
    tab.sockets[0].serverClose(4405);
    await until(() => tab.provider.getStatus() === "halted", "halted");
    await tick(BACKOFF_MAX_MS * 2);
    expect(tab.sockets).toHaveLength(1);
  });

  it("4426: stops for an update without reconnecting, and keeps queued edits on the device", async () => {
    online = false;
    const tab = await openTab();
    type(tab.local, "written offline");
    await until(async () => (await pendingCount()) === 1, "stored");
    server.refuseWith = 4426;
    tab.setOnline(true);
    await until(() => tab.provider.getStatus() === "outdated", "outdated");
    await tick(BACKOFF_MAX_MS * 2);
    expect(tab.sockets).toHaveLength(1);
    expect(server.text()).toBe("");
    expect(await pendingCount()).toBe(1);
  });

  it("1008: halts with no retry", async () => {
    const tab = await openTab();
    await until(() => tab.provider.getStatus() === "saved", "saved");
    tab.sockets[0].serverClose(1008);
    await until(() => tab.provider.getStatus() === "halted", "halted");
    await tick(BACKOFF_MAX_MS * 2);
    expect(tab.sockets).toHaveLength(1);
  });

  it("1007 with nothing in flight halts with no retry", async () => {
    const tab = await openTab();
    await until(() => tab.provider.getStatus() === "saved", "saved");
    tab.sockets[0].serverClose(1007);
    await until(() => tab.provider.getStatus() === "halted", "halted");
    await tick(BACKOFF_MAX_MS * 2);
    expect(tab.sockets).toHaveLength(1);
  });

  it("a token request answering no access stops as revoked", async () => {
    const tab = await openTab("doc", { tokens: [{ kind: "no-access" }] });
    await until(() => tab.provider.getStatus() === "revoked", "revoked");
    expect(tab.sockets).toHaveLength(0);
  });

  it("a token request answering deleted stops as deleted", async () => {
    const tab = await openTab("doc", { tokens: [{ kind: "deleted" }] });
    await until(() => tab.provider.getStatus() === "deleted", "deleted");
    expect(tab.sockets).toHaveLength(0);
  });
});

describe("roles", () => {
  it("a role message downgrades in place when nothing is pending", async () => {
    const tab = await openTab();
    await until(() => tab.provider.getStatus() === "saved", "saved");
    tab.sockets[0].deliver(encodeRole("viewer"));
    await until(() => tab.provider.getRole() === "viewer", "viewer");
    expect(tab.provider.getStatus()).toBe("saved");
    expect(tab.learned).toEqual(["viewer"]);
  });

  it("a downgrade with edits the server never received stops for downgrade handling", async () => {
    online = false;
    const tab = await openTab("doc", { tokens: [okToken("viewer")] });
    type(tab.local, "written offline");
    await until(async () => (await pendingCount()) === 1, "stored");
    tab.setOnline(true);
    await until(() => tab.provider.getStatus() === "downgraded", "downgraded");
    // Nothing was sent: the socket was never opened.
    expect(tab.sockets).toHaveLength(0);
    expect(server.text()).toBe("");
  });

  it("a viewer never sends document changes", async () => {
    const tab = await openTab("doc", { role: "viewer" });
    await until(() => tab.provider.getStatus() === "saved", "saved");
    type(tab.local, "should not leave");
    await until(() => tab.provider.getStatus() === "downgraded", "stopped");
    expect(tab.sockets[0].sent.filter((message) => message.type === "update")).toHaveLength(0);
    expect(server.text()).toBe("");
  });

  it("an upgrade from another tab is checked with the server, not trusted", async () => {
    const tab = await openTab("doc", { role: "viewer" });
    await until(() => tab.provider.getStatus() === "saved", "saved");
    const before = tab.tokenRequests;
    tab.tokens.push(okToken("viewer"));
    tab.provider.applyAccessNotice("editor");
    await until(() => tab.tokenRequests === before + 1, "asked the server");
    expect(tab.provider.getRole()).toBe("viewer");
  });

  it("a downgrade or revoke from another tab applies at once", async () => {
    const tab = await openTab();
    await until(() => tab.provider.getStatus() === "saved", "saved");
    tab.provider.applyAccessNotice("viewer");
    expect(tab.provider.getRole()).toBe("viewer");
    tab.provider.applyAccessNotice(null);
    expect(tab.provider.getStatus()).toBe("revoked");
  });
});

describe("packEntries", () => {
  const entry = (bytes: number) => ({ update: new Uint8Array(bytes), seq: bytes, edit: null });

  it("packs oldest first under the target and isolates on request", () => {
    expect(packEntries([entry(400), entry(400), entry(400)], 1000).map((batch) => batch.length)).toEqual([2, 1]);
    expect(packEntries([entry(2000), entry(10)], 1000).map((batch) => batch.length)).toEqual([1, 1]);
    expect(packEntries([entry(1), entry(1), entry(1)], 1000, 1)).toHaveLength(3);
  });
});
