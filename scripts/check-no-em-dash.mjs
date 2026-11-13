// Repo rule: no em dashes in code, comments, UI copy or docs.
// Scans every tracked and untracked (not ignored) text file.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const EM_DASH = String.fromCharCode(0x2014);
const BINARY = /\.(woff2?|ttf|otf|png|jpe?g|gif|ico|webp|pdf|zip)$/i;

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
})
  .split("\n")
  .filter((file) => file && !BINARY.test(file));

const hits = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  text.split("\n").forEach((line, index) => {
    if (line.includes(EM_DASH)) hits.push(`${file}:${index + 1}`);
  });
}

if (hits.length > 0) {
  console.error(`Em dashes found (use a comma, colon, period or parentheses instead):\n${hits.join("\n")}`);
  process.exit(1);
}
