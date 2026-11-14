/**
 * Which document schema versions a client may connect with. The deployment
 * is the source of truth: SCHEMA_VERSION_MIN and SCHEMA_VERSION_MAX in the
 * Worker config. A client's claim is only believed within those bounds, so
 * nobody can lock honest clients out by claiming a huge version, and
 * lowering MAX after a rollback lets current clients back in.
 */
export interface SchemaBounds {
  min: number;
  max: number;
}

export function schemaBounds(env: { SCHEMA_VERSION_MIN?: string; SCHEMA_VERSION_MAX?: string }): SchemaBounds {
  const min = Number(env.SCHEMA_VERSION_MIN);
  const max = Number(env.SCHEMA_VERSION_MAX);
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || min > max) {
    throw new Error("SCHEMA_VERSION_MIN and SCHEMA_VERSION_MAX must be integers with 1 <= MIN <= MAX.");
  }
  return { min, max };
}

export type SchemaDecision =
  /** Newer than this deployment accepts: refuse, record nothing. */
  | { kind: "unsupported" }
  /** Older than this document needs: the client updates and reloads. */
  | { kind: "outdated" }
  /**
   * Accept. `record` is the newest version to remember when it changed (also
   * when a remembered value fell outside the bounds); `raised` means older
   * clients still connected must be closed.
   */
  | { kind: "accept"; record: number | null; raised: boolean };

export function decideSchema(claim: number, remembered: number, bounds: SchemaBounds): SchemaDecision {
  if (claim > bounds.max) return { kind: "unsupported" };
  // Re-checked against the current config on every connect: a value
  // remembered under an older config (a rollback lowered MAX) is clamped.
  const newest = Math.min(Math.max(remembered, bounds.min), bounds.max);
  if (claim < newest) return { kind: "outdated" };
  return { kind: "accept", record: claim === remembered ? null : claim, raised: claim > newest };
}
