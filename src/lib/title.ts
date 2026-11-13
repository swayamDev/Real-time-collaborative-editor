import { TITLE_MAX_LENGTH, cleanTitle } from "@brahma/protocol";

export { TITLE_MAX_LENGTH };

export type TitleResult = { ok: true; title: string } | { ok: false; error: string };

/**
 * Normalize and validate a document title. An empty title is allowed and is
 * shown as "Untitled".
 */
export function validateTitle(input: unknown): TitleResult {
  if (typeof input !== "string") {
    return { ok: false, error: "Title must be text." };
  }
  const title = cleanTitle(input);
  if ([...title].length > TITLE_MAX_LENGTH) {
    return { ok: false, error: `Titles can be up to ${TITLE_MAX_LENGTH} characters.` };
  }
  return { ok: true, title };
}

export function displayTitle(title: string): string {
  return title.trim() === "" ? "Untitled" : title;
}
