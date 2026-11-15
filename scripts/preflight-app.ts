// Runs before `next build`. On Vercel (previews included) or with
// BRAHMA_PREFLIGHT=1 it refuses to build unless every production variable
// is set and no development-only setting is present. See src/lib/preflight.ts.
import { checkProductionEnvironment, mustPassPreflight } from "../src/lib/preflight";

if (!mustPassPreflight(process.env)) {
  console.log("Preflight: skipped (not a Vercel build; set BRAHMA_PREFLIGHT=1 to run it).");
  process.exit(0);
}

const problems = checkProductionEnvironment(process.env);
if (problems.length > 0) {
  console.error(`Preflight refused this build:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
  process.exit(1);
}
console.log("Preflight: the production environment is complete.");
