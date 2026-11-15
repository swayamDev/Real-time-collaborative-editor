/**
 * Variables the integration tests read from the environment (.env.local
 * locally, the workflow in CI). Tests that need anything else set it
 * themselves. Checked once, before any test runs.
 */
export const REQUIRED_INTEGRATION_ENV = ["DATABASE_URL", "BETTER_AUTH_SECRET"] as const;

export function missingIntegrationEnv(env: Record<string, string | undefined>): string[] {
  return REQUIRED_INTEGRATION_ENV.filter((name) => !env[name]);
}
