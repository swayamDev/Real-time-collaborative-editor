const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ESCAPES[character]);
}

/** A standalone HTML file of the document, for keeping a copy outside Brahma. */
export function documentHtml(title: string, bodyHtml: string): string {
  const shown = title.trim() === "" ? "Untitled" : title;
  return [
    "<!doctype html>",
    '<html lang="en">',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(shown)}</title>`,
    `<h1>${escapeHtml(shown)}</h1>`,
    bodyHtml,
    "</html>",
  ].join("\n");
}

/** A file name safe on every common file system. */
export function exportFileName(title: string): string {
  const base = title.replace(/[\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  return `${base || "Untitled"}.html`;
}

export function downloadFile(name: string, contents: string, type = "text/html"): void {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
