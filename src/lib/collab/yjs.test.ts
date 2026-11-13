import { CONTENT_FIELD } from "@brahma/protocol";
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { EMPTY_YJS_STATE, emptyYjsState } from "../empty-yjs-state";
import { loadDoc } from "./yjs";

describe("EMPTY_YJS_STATE", () => {
  it("matches the encoding of a new, empty Y.Doc", () => {
    expect(Uint8Array.from(EMPTY_YJS_STATE)).toEqual(Y.encodeStateAsUpdate(new Y.Doc()));
    expect(emptyYjsState()).toEqual(Uint8Array.from(EMPTY_YJS_STATE));
  });
});

describe("loadDoc", () => {
  it("loads the empty state and a zero length state as empty documents", () => {
    expect(loadDoc(emptyYjsState()).getXmlFragment(CONTENT_FIELD).toString()).toBe("");
    expect(loadDoc(new Uint8Array()).getXmlFragment(CONTENT_FIELD).toString()).toBe("");
  });

  it("round trips a full state", () => {
    const source = new Y.Doc();
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.insert(0, [new Y.XmlText("Hello")]);
    source.getXmlFragment(CONTENT_FIELD).push([paragraph]);
    expect(loadDoc(Y.encodeStateAsUpdate(source)).getXmlFragment(CONTENT_FIELD).toString()).toBe(
      "<paragraph>Hello</paragraph>",
    );
  });
});
