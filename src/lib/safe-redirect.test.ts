import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./safe-redirect";

describe("safeReturnPath", () => {
  it("keeps same-site paths", () => {
    expect(safeReturnPath("/d/123?x=1")).toBe("/d/123?x=1");
  });

  it("refuses anything that could leave the site", () => {
    // "/\\evil.example" is a path some browsers treat like "//evil.example".
    for (const value of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", null]) {
      expect(safeReturnPath(value)).toBe("/");
    }
  });
});
