"use client";

/** The model's own one-sentence bottom line, shown above the folded answer.
 *  Not itself collapsible - it's the summary the fold exists to sit under,
 *  so it has to already be visible for the fold to make sense. No heading:
 *  it is the first sentence of the answer, set apart by weight and the box,
 *  and a label on top of it read as a second title competing with the mode. */
export function CruxCard({ text }: { text: string }) {
  return (
    <div className="mb-2.5 rounded-xl border border-hairline-strong bg-surface-hover px-3 py-2.5">
      <p className="text-sm font-medium leading-relaxed text-ink">{text}</p>
    </div>
  );
}
