import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Server code must never load Yjs or the editor. Each server bundle would
// carry its own copy of Yjs, and the copies collide in one Node process.
const CLIENT_ONLY_MODULES = {
  patterns: [
    {
      group: ["yjs", "yjs/*", "y-protocols", "y-protocols/*", "y-prosemirror", "lib0", "lib0/*", "@tiptap/*"],
      message: "Yjs and the editor are client-only. Keep them out of server code.",
    },
    {
      group: ["@/lib/collab/*", "**/lib/collab/*", "@/components/editor/document-editor"],
      message: "Collaboration code is client-only. Keep it out of server code.",
    },
  ],
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: [
      "src/server/**/*.ts",
      "src/db/**/*.ts",
      "src/app/**/page.tsx",
      "src/app/**/layout.tsx",
      "src/app/**/not-found.tsx",
      "src/app/**/route.ts",
      "src/app/actions.ts",
    ],
    rules: { "no-restricted-imports": ["error", CLIENT_ONLY_MODULES] },
  },
  {
    // page.waitForFunction does not await a returned Promise: an async
    // predicate is truthy at once, so the wait silently passes.
    files: ["e2e/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name='waitForFunction'] > :matches(ArrowFunctionExpression, FunctionExpression)[async=true]",
          message:
            "waitForFunction does not await an async predicate (the Promise is truthy, so it passes at once). Use expect.poll(() => page.evaluate(async () => ...)).",
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "workers/*/.wrangler/**", "workers/*/worker-configuration.d.ts"]),
]);

export default eslintConfig;
