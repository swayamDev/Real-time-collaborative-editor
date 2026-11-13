import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { AutosaveController, type SaveStatus, type SaveTransportApi } from "./autosave";
import { KEEPALIVE_BODY_LIMIT } from "./save-transport";
import { CONTENT_FIELD, createEmptyState, loadDoc, mergeIntoState } from "./yjs";

const timing = { debounceMs: 800, maxWaitMs: 5_000, retryBaseMs: 2_000, maxRetryMs: 30_000 };

/** In-memory server that merges updates like the real route handler. */
function fakeServer() {
  let stored = createEmptyState();
  let fail = false;
  const calls: Array<{ kind: "content" | "title"; keepalive: boolean; bytes: number }> = [];
  let title = "";
  const transport: SaveTransportApi = {
    async saveContent(update, { keepalive }) {
      calls.push({ kind: "content", keepalive, bytes: update.byteLength });
      if (fail) throw new Error("offline");
      stored = mergeIntoState(stored, update);
      return new Date().toISOString();
    },
    async saveTitle(next, { keepalive }) {
      calls.push({ kind: "title", keepalive, bytes: next.length });
      if (fail) throw new Error("offline");
      title = next;
      return new Date().toISOString();
    },
  };
  return {
    transport,
    calls,
    setFailing: (value: boolean) => {
      fail = value;
    },
    text: () => loadDoc(stored).getText("t").toString(),
    fragment: () => loadDoc(stored).getXmlFragment(CONTENT_FIELD).toString(),
    title: () => title,
  };
}

function setup(server = fakeServer()) {
  const doc = new Y.Doc();
  const statuses: SaveStatus[] = [];
  const saved: string[] = [];
  const controller = new AutosaveController(
    doc,
    server.transport,
    { onStatus: (s) => statuses.push(s), onSaved: (at) => saved.push(at) },
    timing,
  );
  return { doc, server, controller, statuses, saved };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("AutosaveController", () => {
  it("debounces edits into one save", async () => {
    const { doc, server, statuses } = setup();
    doc.getText("t").insert(0, "a");
    await vi.advanceTimersByTimeAsync(400);
    doc.getText("t").insert(1, "b");
    await vi.advanceTimersByTimeAsync(400);
    expect(server.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(400);
    expect(server.calls).toHaveLength(1);
    expect(server.text()).toBe("ab");
    expect(statuses).toEqual(["saving", "saved"]);
  });

  it("saves the first edit made after construction", async () => {
    const { doc, server } = setup();
    doc.getXmlFragment(CONTENT_FIELD).insert(0, [new Y.XmlElement("paragraph")]);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(server.fragment()).toBe("<paragraph></paragraph>");
  });

  it("saves at least every maxWait while typing continues", async () => {
    const { doc, server } = setup();
    for (let i = 0; i < 12; i++) {
      doc.getText("t").insert(i, "x");
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(server.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("sends only changes since the last confirmed save", async () => {
    const { doc, server } = setup();
    doc.getText("t").insert(0, "x".repeat(5_000));
    await vi.advanceTimersByTimeAsync(1_000);
    doc.getText("t").insert(5_000, "y");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(server.calls[0].bytes).toBeGreaterThan(5_000);
    expect(server.calls[1].bytes).toBeLessThan(100);
    expect(server.text()).toBe(`${"x".repeat(5_000)}y`);
  });

  it("saves a delete-only edit", async () => {
    const { doc, server, controller } = setup();
    doc.getText("t").insert(0, "keep remove");
    await vi.advanceTimersByTimeAsync(1_000);
    doc.getText("t").delete(4, 7);
    expect(controller.dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(server.text()).toBe("keep");
  });

  it("saves title changes on their own", async () => {
    const { server, controller } = setup();
    controller.titleChanged("Plans");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(server.calls.map((c) => c.kind)).toEqual(["title"]);
    expect(server.title()).toBe("Plans");
    expect(controller.dirty).toBe(false);
  });

  it("reports an error, retries with backoff, and recovers", async () => {
    const server = fakeServer();
    server.setFailing(true);
    const { doc, controller, statuses } = setup(server);
    doc.getText("t").insert(0, "offline edit");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(statuses.at(-1)).toBe("error");
    expect(controller.dirty).toBe(true);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(server.calls).toHaveLength(2);
    expect(statuses.at(-1)).toBe("error");

    server.setFailing(false);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(statuses.at(-1)).toBe("saved");
    expect(server.text()).toBe("offline edit");
  });

  it("retries immediately on a manual flush", async () => {
    const server = fakeServer();
    server.setFailing(true);
    const { doc, controller, statuses } = setup(server);
    doc.getText("t").insert(0, "x");
    await vi.advanceTimersByTimeAsync(1_000);
    server.setFailing(false);
    await controller.flush();
    expect(statuses.at(-1)).toBe("saved");
  });

  it("queues edits made while a save is in flight", async () => {
    const server = fakeServer();
    let release: () => void = () => {};
    const slow: SaveTransportApi = {
      ...server.transport,
      saveContent: (update, options) =>
        new Promise((resolve) => {
          release = () => void server.transport.saveContent(update, options).then(resolve);
        }),
    };
    const { doc, controller } = setup({ ...server, transport: slow });
    doc.getText("t").insert(0, "one");
    const first = controller.flush();
    doc.getText("t").insert(3, " two");
    void controller.flush();
    release();
    // The queued flush starts as soon as the first request finishes.
    await vi.advanceTimersByTimeAsync(0);
    release();
    await first;
    expect(server.text()).toBe("one two");
    expect(controller.hasUnconfirmedChanges).toBe(false);
  });

  it("uses keepalive on unload only when the body fits in 64 KiB", async () => {
    const { doc, server, controller } = setup();
    doc.getText("t").insert(0, "small");
    await controller.flush({ unloading: true });
    expect(server.calls.at(-1)?.keepalive).toBe(true);

    doc.getText("t").insert(0, "x".repeat(KEEPALIVE_BODY_LIMIT + 1));
    await controller.flush({ unloading: true });
    expect(server.calls.at(-1)?.keepalive).toBe(false);
    expect(server.calls.at(-1)?.bytes).toBeGreaterThan(KEEPALIVE_BODY_LIMIT);
  });

  it("reports the latest server timestamp", async () => {
    const { doc, saved } = setup();
    doc.getText("t").insert(0, "x");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(saved).toHaveLength(1);
  });

  it("resumes after start() following stop()", async () => {
    const { doc, server, controller } = setup();
    controller.stop();
    controller.start();
    doc.getText("t").insert(0, "back");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(server.text()).toBe("back");
  });

  it("stops listening after stop()", async () => {
    const { doc, server, controller } = setup();
    controller.stop();
    doc.getText("t").insert(0, "ignored");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.calls).toHaveLength(0);
  });
});
