import { describe, expect, it } from "vitest";
import { type NeonBranch, backupName, backupsToDelete, productionBranch } from "./neon-backup";

const branch = (name: string, created: string, isDefault = false): NeonBranch => ({
  id: `br-${name}`,
  name,
  created_at: created,
  default: isDefault,
});

describe("Neon backups", () => {
  const branches = [
    branch("main", "2026-01-01T00:00:00Z", true),
    branch("backup-20261101T000000Z-aaaaaaa", "2026-11-01T00:00:00Z"),
    branch("backup-20261102T000000Z-bbbbbbb", "2026-11-02T00:00:00Z"),
    branch("backup-20261103T000000Z-ccccccc", "2026-11-03T00:00:00Z"),
    branch("backup-20261104T000000Z-ddddddd", "2026-11-04T00:00:00Z"),
    branch("investigation", "2026-10-01T00:00:00Z"),
  ];

  it("branches from the default branch (old responses say primary)", () => {
    expect(productionBranch(branches)?.name).toBe("main");
    expect(productionBranch([{ id: "x", name: "old", created_at: "", primary: true }])?.name).toBe("old");
    expect(productionBranch([branch("a", "")])).toBeNull();
  });

  it("names backups by time and commit", () => {
    expect(backupName(new Date("2026-11-15T09:30:12.345Z"), "0123456789abcdef")).toBe("backup-20261115T093012Z-0123456");
  });

  it("keeps the newest backups and never deletes another branch", () => {
    expect(backupsToDelete(branches, 3).map((b) => b.name)).toEqual(["backup-20261101T000000Z-aaaaaaa"]);
    expect(backupsToDelete(branches, 1).map((b) => b.name)).toEqual([
      "backup-20261101T000000Z-aaaaaaa",
      "backup-20261102T000000Z-bbbbbbb",
      "backup-20261103T000000Z-ccccccc",
    ]);
    expect(backupsToDelete([branch("backup-x", "2026-01-01T00:00:00Z", true)], 0)).toEqual([]);
  });
});
