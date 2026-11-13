import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { estimateFragmentBytes, estimateInsertedBytes } from "./edit-size";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*" },
    text: {},
  },
  marks: { strong: {} },
});

function paragraphs(count: number, text: string) {
  return Array.from({ length: count }, () => schema.node("paragraph", null, [schema.text(text)]));
}

describe("estimateFragmentBytes", () => {
  it("counts UTF-8 bytes of text", () => {
    const ascii = schema.node("doc", null, paragraphs(1, "a".repeat(1000))).content;
    const emoji = schema.node("doc", null, paragraphs(1, "\u{1F600}".repeat(250))).content;
    expect(estimateFragmentBytes(ascii)).toBeGreaterThanOrEqual(1000);
    expect(estimateFragmentBytes(emoji)).toBeGreaterThanOrEqual(1000);
  });

  it("adds overhead per node and mark", () => {
    const plain = schema.node("doc", null, [schema.node("paragraph", null, [schema.text("x")])]).content;
    const bold = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("x", [schema.marks.strong.create()])]),
    ]).content;
    expect(estimateFragmentBytes(bold)).toBeGreaterThan(estimateFragmentBytes(plain));
    const many = schema.node(
      "doc",
      null,
      Array.from({ length: 1000 }, () => schema.node("paragraph")),
    ).content;
    expect(estimateFragmentBytes(many)).toBeGreaterThanOrEqual(1000 * 24);
  });
});

describe("estimateInsertedBytes", () => {
  it("measures what a transaction inserts", () => {
    const state = EditorState.create({ schema });
    const tr = state.tr.insert(1, schema.text("hello world"));
    expect(estimateInsertedBytes(tr)).toBeGreaterThanOrEqual(11);
    expect(estimateInsertedBytes(state.tr)).toBe(0);
  });
});
