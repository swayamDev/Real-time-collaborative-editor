import { describe, expect, it } from "vitest";
import { isSafeHref } from "./safe-href";

describe("isSafeHref", () => {
  it.each(["https://example.com/a?b=c#d", "http://example.com", "mailto:ada@example.com", " https://example.com "])(
    "allows %s",
    (href) => expect(isSafeHref(href)).toBe(true),
  );

  it.each([
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "java\nscript:alert(1)",
    "\u0000javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "ftp://example.com",
    "tel:123",
    "//evil.example/path",
    "/relative",
    "#anchor",
    "",
    "   ",
  ])("refuses %j", (href) => expect(isSafeHref(href)).toBe(false));

  it("refuses non-strings and very long values", () => {
    expect(isSafeHref(undefined)).toBe(false);
    expect(isSafeHref({ toString: () => "https://x" })).toBe(false);
    expect(isSafeHref(`https://example.com/${"a".repeat(3000)}`)).toBe(false);
  });
});
