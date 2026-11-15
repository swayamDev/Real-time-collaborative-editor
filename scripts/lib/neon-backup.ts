/**
 * Before each production migration, branch the production database as a
 * backup (copy on write: instant, no compute). Keeps the newest few backup
 * branches, since the free plan allows 10 branches per project.
 */

export const BACKUP_PREFIX = "backup-";
export const BACKUPS_TO_KEEP = 3;

export interface NeonBranch {
  id: string;
  name: string;
  created_at: string;
  /** Current API field; older responses used "primary". */
  default?: boolean;
  primary?: boolean;
}

/** The branch production runs on: the project's default branch. */
export function productionBranch(branches: readonly NeonBranch[]): NeonBranch | null {
  return branches.find((branch) => branch.default ?? branch.primary) ?? null;
}

/** backup-<UTC timestamp>-<commit>, sortable by name and traceable to the deploy. */
export function backupName(now: Date, commit: string): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  return `${BACKUP_PREFIX}${stamp}-${commit.slice(0, 7)}`;
}

/** Backup branches beyond the newest `keep`, oldest first; never any other branch. */
export function backupsToDelete(branches: readonly NeonBranch[], keep = BACKUPS_TO_KEEP): NeonBranch[] {
  const backups = branches
    .filter((branch) => branch.name.startsWith(BACKUP_PREFIX) && !(branch.default ?? branch.primary))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return backups.slice(keep).reverse();
}
