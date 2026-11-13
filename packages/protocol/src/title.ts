import { TITLE_MAX_LENGTH } from "./limits";

// Control characters and line breaks become spaces; runs of whitespace collapse.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/** Whitespace and control-character cleanup shared by the app and the sync server. */
export function cleanTitle(raw: string): string {
  return raw.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
}

/** What the sync server copies into the Postgres title column. */
export function titleForColumn(raw: string): string {
  return [...cleanTitle(raw)].slice(0, TITLE_MAX_LENGTH).join("");
}
