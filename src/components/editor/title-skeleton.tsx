import { displayTitle } from "@/lib/title";

/** The title as plain text, same box as the title field, while the editor loads. */
export function TitleSkeleton({ title }: { title: string }) {
  const empty = title.trim() === "";
  return (
    <h1 className={empty ? "doc-title text-ink-muted" : "doc-title"} data-testid="title-skeleton">
      {displayTitle(title)}
    </h1>
  );
}
