/**
 * Which title the sidebar shows for each document (issue #2).
 *
 * The server's list lags a rename by a few seconds: its title column is
 * written by the sync server's next snapshot. So the sidebar prefers what
 * this browser already knows:
 *
 *   1. the open document's live title, while it is open;
 *   2. otherwise the most recent title known here (renamed in this tab, or
 *      saved on this device), if it changed after the server row did;
 *   3. otherwise the server's title.
 *
 * Rows come from the server list only. A title known here never adds a row,
 * so a revoked or deleted document cannot reappear. And when the server row
 * changed after the title here (a rename in another browser, snapshotted),
 * the server wins. Times compare this browser's clock with the server's, so
 * a skew of a few seconds can briefly favor the wrong side.
 */
export interface TitledRow {
  id: string;
  title: string;
  /** When the server row last changed (ISO 8601); a snapshot sets it. */
  updatedAt: string;
}

/** A title this tab set: live (the open document) or a recent rename. */
export interface TitleOverride {
  title: string;
  /** When it changed, ms since epoch. */
  at: number;
  live: boolean;
}

/** A title saved on this device, and when it changed (absent for older records). */
export interface DeviceTitle {
  title: string;
  titleChangedAt?: number;
}

export function pickTitle(row: TitledRow, override?: TitleOverride, device?: DeviceTitle): string {
  if (override?.live) return override.title;
  const serverAt = Date.parse(row.updatedAt);
  let best: { title: string; at: number } | null = null;
  for (const candidate of [
    override ? { title: override.title, at: override.at } : null,
    device?.titleChangedAt !== undefined ? { title: device.title, at: device.titleChangedAt } : null,
  ]) {
    if (candidate && candidate.at > serverAt && (!best || candidate.at > best.at)) best = candidate;
  }
  return best ? best.title : row.title;
}

/** The server's rows, in the server's order, with the best known title for each. Never adds a row. */
export function withKnownTitles<T extends TitledRow>(
  rows: readonly T[],
  overrides: ReadonlyMap<string, TitleOverride>,
  device: ReadonlyMap<string, DeviceTitle>,
): T[] {
  return rows.map((row) => {
    const title = pickTitle(row, overrides.get(row.id), device.get(row.id));
    return title === row.title ? row : { ...row, title };
  });
}
