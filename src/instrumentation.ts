import { checkProductionEnvironment, mustPassPreflight } from "./lib/preflight";

/**
 * Runs once when a server instance starts. On Vercel the production checks
 * run again here, so a deployment whose variables changed after the build
 * refuses to serve instead of running with development settings.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs" && mustPassPreflight(process.env)) {
    const problems = checkProductionEnvironment(process.env);
    if (problems.length > 0) {
      throw new Error(`Production preflight failed:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
    }
  }
}
