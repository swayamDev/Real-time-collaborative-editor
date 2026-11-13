import { describe, expect, it } from "vitest";
import { TITLE_MAX_LENGTH, displayTitle, validateTitle } from "./title";

describe("validateTitle", () => {
  it("trims and collapses whitespace", () => {
    expect(validateTitle("  Q3   planning \t notes  ")).toEqual({ ok: true, title: "Q3 planning notes" });
  });

  it("replaces line breaks and control characters with spaces", () => {
    expect(validateTitle("Line one\nLine two\u0007")).toEqual({ ok: true, title: "Line one Line two" });
  });

  it("allows an empty title", () => {
    expect(validateTitle("   ")).toEqual({ ok: true, title: "" });
  });

  it("accepts a title at the length limit", () => {
    expect(validateTitle("a".repeat(TITLE_MAX_LENGTH)).ok).toBe(true);
  });

  it("rejects a title over the length limit", () => {
    expect(validateTitle("a".repeat(TITLE_MAX_LENGTH + 1))).toEqual({
      ok: false,
      error: "Titles can be up to 200 characters.",
    });
  });

  it("counts characters, not UTF-16 code units", () => {
    expect(validateTitle("\u{1F4DA}".repeat(TITLE_MAX_LENGTH)).ok).toBe(true);
  });

  it("rejects non-string input", () => {
    expect(validateTitle(42)).toEqual({ ok: false, error: "Title must be text." });
    expect(validateTitle(undefined).ok).toBe(false);
  });
});

describe("displayTitle", () => {
  it("shows Untitled for an empty title", () => {
    expect(displayTitle("")).toBe("Untitled");
    expect(displayTitle("  ")).toBe("Untitled");
    expect(displayTitle("Notes")).toBe("Notes");
  });
});
