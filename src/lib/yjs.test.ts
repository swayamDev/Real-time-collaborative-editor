import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  CONTENT_FIELD,
  createEmptyState,
  encodeUpdateSince,
  isValidUpdate,
  loadDoc,
  mergeIntoState,
} from "./yjs";

function writeParagraph(doc: Y.Doc, text: string): void {
  const fragment = doc.getXmlFragment(CONTENT_FIELD);
  const paragraph = new Y.XmlElement("paragraph");
  paragraph.insert(0, [new Y.XmlText(text)]);
  fragment.push([paragraph]);
}

function contentOf(doc: Y.Doc): string {
  return doc.getXmlFragment(CONTENT_FIELD).toString();
}

/** Simulates the server: the stored state plus each saved update, merged. */
function persist(stored: Uint8Array, ...updates: Uint8Array[]): Uint8Array {
  return updates.reduce((state, update) => mergeIntoState(state, update), stored);
}

describe("createEmptyState and loadDoc", () => {
  it("loads an empty state into an empty document", () => {
    const doc = loadDoc(createEmptyState());
    expect(contentOf(doc)).toBe("");
  });

  it("treats a zero length state as an empty document", () => {
    expect(contentOf(loadDoc(new Uint8Array()))).toBe("");
  });

  it("round trips a full state", () => {
    const source = new Y.Doc();
    writeParagraph(source, "Hello");
    const loaded = loadDoc(Y.encodeStateAsUpdate(source));
    expect(contentOf(loaded)).toBe("<paragraph>Hello</paragraph>");
  });
});

describe("encodeUpdateSince and mergeIntoState", () => {
  it("persists a delta on top of the stored state", () => {
    let stored = createEmptyState();
    const client = loadDoc(stored);
    let acked = Y.encodeStateVector(client);

    writeParagraph(client, "First");
    const first = encodeUpdateSince(client, acked);
    stored = persist(stored, first.update);
    acked = first.stateVector;

    writeParagraph(client, "Second");
    const second = encodeUpdateSince(client, acked);
    stored = persist(stored, second.update);

    expect(contentOf(loadDoc(stored))).toBe(contentOf(client));
    expect(contentOf(loadDoc(stored))).toContain("Second");
  });

  it("sends only new content in a delta", () => {
    const client = new Y.Doc();
    writeParagraph(client, "x".repeat(10_000));
    const acked = Y.encodeStateVector(client);
    writeParagraph(client, "small");
    const { update } = encodeUpdateSince(client, acked);
    expect(update.byteLength).toBeLessThan(200);
  });

  it("encodes the full state when nothing has been acknowledged", () => {
    const client = new Y.Doc();
    writeParagraph(client, "Everything");
    const { update } = encodeUpdateSince(client, null);
    expect(contentOf(loadDoc(update))).toBe(contentOf(client));
  });

  it("persists a delete-only edit, which does not change the state vector", () => {
    let stored = createEmptyState();
    const client = loadDoc(stored);
    writeParagraph(client, "Keep");
    writeParagraph(client, "Remove");
    const saved = encodeUpdateSince(client, null);
    stored = persist(stored, saved.update);

    client.getXmlFragment(CONTENT_FIELD).delete(1, 1);
    expect(Y.encodeStateVector(client)).toEqual(saved.stateVector);

    stored = persist(stored, encodeUpdateSince(client, saved.stateVector).update);
    expect(contentOf(loadDoc(stored))).toBe("<paragraph>Keep</paragraph>");
  });

  it("is idempotent when the same update is saved twice (retry after a lost response)", () => {
    const client = new Y.Doc();
    writeParagraph(client, "Once");
    const { update } = encodeUpdateSince(client, null);
    const stored = persist(createEmptyState(), update, update);
    expect(contentOf(loadDoc(stored))).toBe("<paragraph>Once</paragraph>");
  });

  it("merges updates from two clients regardless of order", () => {
    const base = createEmptyState();
    const a = loadDoc(base);
    const b = loadDoc(base);
    writeParagraph(a, "From A");
    writeParagraph(b, "From B");
    const ua = encodeUpdateSince(a, null).update;
    const ub = encodeUpdateSince(b, null).update;

    const ab = contentOf(loadDoc(persist(base, ua, ub)));
    const ba = contentOf(loadDoc(persist(base, ub, ua)));
    expect(ab).toBe(ba);
    expect(ab).toContain("From A");
    expect(ab).toContain("From B");
  });
});

describe("isValidUpdate", () => {
  it("accepts real updates", () => {
    const doc = new Y.Doc();
    writeParagraph(doc, "Valid");
    expect(isValidUpdate(Y.encodeStateAsUpdate(doc))).toBe(true);
    expect(isValidUpdate(createEmptyState())).toBe(true);
  });

  it("rejects empty and malformed input", () => {
    expect(isValidUpdate(new Uint8Array())).toBe(false);
    expect(isValidUpdate(new Uint8Array([255, 255, 255, 255, 255]))).toBe(false);
  });
});
