"use client";

/** The model's own one-sentence bottom line, shown above the folded answer.
 *  Not itself collapsible - it's the summary the fold exists to sit under,
 *  so it has to already be visible for the fold to make sense. */
export function CruxCard({ text }: { text: string }) {
  return (
    <div className="mb-2.5 rounded-xl border border-hairline-strong bg-surface-hover px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        The gist
      </p>
      <p className="mt-1 text-sm font-medium leading-relaxed text-ink">{text}</p>
    </div>
  );
}
