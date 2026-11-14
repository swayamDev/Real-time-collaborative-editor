import { describe, expect, it } from "vitest";
import { DOCUMENT_SCHEMA_VERSION, schemaFingerprint } from "./schema-version";

/**
 * The document schema of every released version. When this test fails,
 * the schema changed: bump DOCUMENT_SCHEMA_VERSION, add the new fingerprint
 * here, and keep the change additive (see "Changing the document schema"
 * in the README). Never edit an existing entry.
 */
const FINGERPRINTS: Record<number, string> = {
  1:
    "nodes: blockquote() bulletList() codeBlock(language) doc() hardBreak() heading(level) horizontalRule() " +
    "listItem() orderedList(start,type) paragraph() taskItem(checked) taskList() text() | " +
    "marks: bold() code() italic() link(class,href,rel,target,title) strike()",
};

type Types = Map<string, Set<string>>;

/** "heading(level) link(href,rel)" as type name to attribute names. */
function parse(fingerprint: string): { nodes: Types; marks: Types } {
  const [nodes, marks] = fingerprint.split(" | ").map(
    (part) =>
      new Map(
        part
          .split(": ")[1]
          .split(" ")
          .map((entry) => {
            const [, name, attrs] = /^(\w+)\((.*)\)$/.exec(entry)!;
            return [name, new Set(attrs ? attrs.split(",") : [])] as const;
          }),
      ),
  );
  return { nodes, marks };
}

function expectContains(current: Types, earlier: Types, kind: string, version: string): void {
  for (const [name, attrs] of earlier) {
    expect(current.has(name), `${kind} ${name} from version ${version} was removed`).toBe(true);
    for (const attr of attrs) {
      expect(current.get(name)?.has(attr), `${kind} ${name}.${attr} from version ${version} was removed`).toBe(true);
    }
  }
}

describe("document schema version", () => {
  it("matches the fingerprint recorded for this version", () => {
    expect(
      schemaFingerprint(),
      "The document schema changed. Bump DOCUMENT_SCHEMA_VERSION and record the new fingerprint.",
    ).toBe(FINGERPRINTS[DOCUMENT_SCHEMA_VERSION]);
  });

  it("only ever grew: every type and attribute of every earlier version is still there", () => {
    const current = parse(schemaFingerprint());
    for (const [version, fingerprint] of Object.entries(FINGERPRINTS)) {
      const earlier = parse(fingerprint);
      expectContains(current.nodes, earlier.nodes, "node", version);
      expectContains(current.marks, earlier.marks, "mark", version);
    }
  });
});
