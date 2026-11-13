/** A persistent message about this document, under the top bar. */
export function DocumentBanner({
  message,
  action,
  testId,
}: {
  message: string;
  action?: { label: string; onClick: () => void };
  testId: string;
}) {
  return (
    <div
      role="alert"
      data-testid={testId}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-hairline bg-sunken px-4 py-2.5 text-ui text-ink sm:px-6"
    >
      <p className="min-w-0 flex-1">{message}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="h-8 shrink-0 rounded-sm border border-hairline-strong bg-raised px-3 text-ui-sm font-medium text-ink transition-colors duration-100 hover:bg-hover"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
