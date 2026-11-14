/**
 * The document schema version a client's editor runs. Sent as a
 * subprotocol entry next to the sync and auth entries:
 *
 *   Sec-WebSocket-Protocol: brahma.v1, schema.<n>, auth.<jwt>
 *
 * It describes the client's code, not the user, so it is not a token claim.
 * The room refuses clients older than the newest version it has seen, so a
 * tab running a cached bundle never removes content made with newer node
 * types (an editor's binding removes what its schema cannot hold).
 */
export const SCHEMA_SUBPROTOCOL_PREFIX = "schema.";
const MAX_SCHEMA_VERSION = 1_000_000;

export function schemaSubprotocol(version: number): string {
  return `${SCHEMA_SUBPROTOCOL_PREFIX}${version}`;
}

/** The schema version offered in a Sec-WebSocket-Protocol header; 0 when absent or malformed. */
export function schemaFromSubprotocols(header: string | null): number {
  if (!header) return 0;
  const entry = header
    .split(",")
    .map((value) => value.trim())
    .find((value) => value.startsWith(SCHEMA_SUBPROTOCOL_PREFIX));
  if (!entry) return 0;
  const digits = entry.slice(SCHEMA_SUBPROTOCOL_PREFIX.length);
  if (!/^[1-9][0-9]{0,6}$/.test(digits)) return 0;
  const version = Number(digits);
  return version <= MAX_SCHEMA_VERSION ? version : 0;
}
