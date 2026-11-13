export const TITLE_MAX_LENGTH = 200;

export type TitleResult = { ok: true; title: string } | { ok: false; error: string };

// Control characters and line breaks become spaces; runs of whitespace collapse.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/**
 * Normalize and validate a document title. An empty title is allowed and is
 * shown as "Untitled".
 */
export function validateTitle(input: unknown): TitleResult {
  if (typeof input !== "string") {
    return { ok: false, error: "Title must be text." };
  }
  const title = input.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  if ([...title].length > TITLE_MAX_LENGTH) {
    return { ok: false, error: `Titles can be up to ${TITLE_MAX_LENGTH} characters.` };
  }
  return { ok: true, title };
}

export function displayTitle(title: string): string {
  return title.trim() === "" ? "Untitled" : title;
}
