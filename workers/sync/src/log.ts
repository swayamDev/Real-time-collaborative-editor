/**
 * One JSON line per event, for Workers Logs (which indexes JSON fields).
 * Fields are codes and fixed reasons only: never document content, names,
 * emails or tokens.
 */
export function logEvent(event: string, fields: Record<string, string | number | boolean | null> = {}): void {
  console.log(JSON.stringify({ event, ...fields }));
}
