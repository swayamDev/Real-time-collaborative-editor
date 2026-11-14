import { getSchema } from "@tiptap/core";
import { contentExtensions } from "./extensions";

/**
 * The version of the document schema this bundle's editor runs. Bump it
 * whenever the schema changes (a node type, mark type or attribute is
 * added). Schema changes must be additive: never remove or rename a type
 * or attribute that documents may already contain. See "Changing the
 * document schema" in the README.
 *
 * Why it matters: an editor's binding removes shared content its schema
 * cannot hold. The sync server remembers the newest version each document
 * has seen and refuses older clients (close code 4426), which update and
 * reload instead of deleting newer content.
 */
export const DOCUMENT_SCHEMA_VERSION = 1;

/** Node and mark types with their attributes; schema-version.test.ts pins it per version. */
export function schemaFingerprint(): string {
  const schema = getSchema(contentExtensions());
  const describe = (types: Record<string, { spec: { attrs?: Record<string, unknown> } }>) =>
    Object.entries(types)
      .map(([name, type]) => `${name}(${Object.keys(type.spec.attrs ?? {}).sort().join(",")})`)
      .sort()
      .join(" ");
  return `nodes: ${describe(schema.nodes)} | marks: ${describe(schema.marks)}`;
}

let pageVersion: number | null = null;

/**
 * The version this page reports to the sync server. End-to-end builds
 * (NEXT_PUBLIC_E2E_HOOKS=1) can pretend, once, to be an older bundle, so a
 * test can see a stale client refused and recover after reloading; other
 * builds compile that branch away.
 */
export function clientSchemaVersion(): number {
  if (pageVersion !== null) return pageVersion;
  pageVersion = DOCUMENT_SCHEMA_VERSION;
  if (process.env.NEXT_PUBLIC_E2E_HOOKS === "1") {
    try {
      const pretend = localStorage.getItem("brahma:e2e:schema-version");
      if (pretend !== null) {
        localStorage.removeItem("brahma:e2e:schema-version");
        pageVersion = Number(pretend);
      }
    } catch {
      // No storage: the real version.
    }
  }
  return pageVersion;
}
