import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  applyTitleInput,
  createTitleUndoManager,
  diffText,
  normalizeTitleInput,
  titleText,
  transformIndex,
} from "./shared-title";

describe("diffText", () => {
  it("finds a single insertion, deletion or replacement", () => {
    expect(diffText("Plan", "Plans")).toEqual({ index: 4, remove: 0, insert: "s" });
    expect(diffText("Plans", "Plan")).toEqual({ index: 4, remove: 1, insert: "" });
    expect(diffText("Q3 plan", "Q4 plan")).toEqual({ index: 1, remove: 1, insert: "4" });
    expect(diffText("same", "same")).toBeNull();
  });

  it("never splits an emoji", () => {
    const change = diffText("a\u{1F600}b", "a\u{1F601}b")!;
    expect(change.index).toBe(1);
    expect(change.remove).toBe(2);
    expect(change.insert).toBe("\u{1F601}");
  });
});

describe("applyTitleInput", () => {
  it("merges concurrent title edits from two people", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    applyTitleInput(titleText(a), "Plan");
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    applyTitleInput(titleText(a), "Q3 Plan");
    applyTitleInput(titleText(b), "Plan notes");
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    expect(titleText(a).toString()).toBe("Q3 Plan notes");
    expect(titleText(b).toString()).toBe("Q3 Plan notes");
  });

  it("keeps titles on one line", () => {
    expect(normalizeTitleInput("one\ntwo\r\nthree")).toBe("one two three");
  });
});

describe("per-user title undo", () => {
  it("undoes only local edits, never a collaborator's", () => {
    const mine = new Y.Doc();
    const theirs = new Y.Doc();
    const undo = createTitleUndoManager(titleText(mine));

    applyTitleInput(titleText(mine), "Mine");
    Y.applyUpdate(theirs, Y.encodeStateAsUpdate(mine));
    undo.stopCapturing();

    const before = Y.encodeStateVector(theirs);
    titleText(theirs).insert(4, " and theirs");
    Y.applyUpdate(mine, Y.encodeStateAsUpdate(theirs, before), "remote");
    expect(titleText(mine).toString()).toBe("Mine and theirs");

    undo.undo();
    expect(titleText(mine).toString()).toBe(" and theirs");
  });
});

describe("transformIndex", () => {
  it("shifts a caret after a remote insert before it", () => {
    expect(transformIndex(5, [{ insert: "abc" }])).toBe(8);
    expect(transformIndex(5, [{ retain: 2 }, { insert: "x" }])).toBe(6);
  });

  it("keeps a caret before a remote change in place", () => {
    expect(transformIndex(2, [{ retain: 4 }, { insert: "x" }])).toBe(2);
    expect(transformIndex(2, [{ retain: 4 }, { delete: 3 }])).toBe(2);
  });

  it("pulls a caret back after a remote delete", () => {
    expect(transformIndex(6, [{ retain: 1 }, { delete: 3 }])).toBe(3);
    // Caret inside the deleted range lands at the deletion point.
    expect(transformIndex(3, [{ retain: 1 }, { delete: 5 }])).toBe(1);
  });
});
