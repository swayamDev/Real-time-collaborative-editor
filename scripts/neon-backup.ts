// Branches the production database before a migration (deploy workflow).
// Needs NEON_API_KEY (scoped to the project where possible) and
// NEON_PROJECT_ID. Fails the deploy if the backup cannot be made, so a
// migration never runs without one. Prints the branch name for rollback.
import { backupName, backupsToDelete, productionBranch, type NeonBranch } from "./lib/neon-backup";

const API = "https://console.neon.tech/api/v2";
const key = process.env.NEON_API_KEY;
const project = process.env.NEON_PROJECT_ID;
if (!key || !project) {
  console.error("NEON_API_KEY and NEON_PROJECT_ID must be set.");
  process.exit(1);
}

async function neon<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "Content-Type": "application/json" },
  });
  if (!response.ok) throw new Error(`Neon API ${init.method ?? "GET"} ${path}: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

async function main(): Promise<void> {
  const { branches } = await neon<{ branches: NeonBranch[] }>(`/projects/${project}/branches`);
  const parent = productionBranch(branches);
  if (!parent) throw new Error("No default branch found in the Neon project.");

  const name = backupName(new Date(), process.env.GITHUB_SHA ?? "manual");
  // No endpoints: a copy-on-write branch at this moment, with no compute.
  const created = await neon<{ branch: NeonBranch }>(`/projects/${project}/branches`, {
    method: "POST",
    body: JSON.stringify({ branch: { parent_id: parent.id, name } }),
  });
  console.log(`Backup branch: ${created.branch.name} (${created.branch.id}), from ${parent.name}.`);

  for (const old of backupsToDelete([...branches, created.branch])) {
    await neon(`/projects/${project}/branches/${old.id}`, { method: "DELETE" });
    console.log(`Deleted old backup branch ${old.name}.`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
