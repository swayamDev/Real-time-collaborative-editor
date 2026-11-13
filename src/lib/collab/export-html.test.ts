import { describe, expect, it } from "vitest";
import { documentHtml, exportFileName } from "./export-html";

describe("documentHtml", () => {
  it("escapes the title and keeps the body", () => {
    const html = documentHtml('<b>"Plans"</b>', "<p>Body</p>");
    expect(html).toContain("<title>&lt;b&gt;&quot;Plans&quot;&lt;/b&gt;</title>");
    expect(html).toContain("<p>Body</p>");
  });

  it("names an untitled document", () => {
    expect(documentHtml("  ", "")).toContain("<h1>Untitled</h1>");
  });
});

describe("exportFileName", () => {
  it("removes characters file systems reject", () => {
    expect(exportFileName('Q3: plan/notes? "final"')).toBe("Q3 plan notes final.html");
    expect(exportFileName("")).toBe("Untitled.html");
  });
});
