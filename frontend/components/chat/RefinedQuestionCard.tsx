"use client";

import { cx } from "@/components/ui/primitives";

/* Offered before the answer exists, not after.
 *
 * A question so vague that answering it well required guessing has already
 * had its guess baked into the answer by the time a "did you mean" note
 * shows up next to it. So this stops first and asks - like the mode and
 * context gates, nothing has been written when it appears: no message saved,
 * no answer generated, so either choice costs the same single round trip.
 */

export function RefinedQuestionCard({
  refinedQuestion,
  reason,
  busy,
  onAskRefined,
  onKeepOriginal,
}: {
  refinedQuestion: string;
  reason: string | null;
  busy?: boolean;
  onAskRefined: () => void;
  onKeepOriginal: () => void;
}) {
  return (
    <div className="mt-2 rounded-xl border border-brand-border bg-brand-soft p-3.5">
      <p className="text-sm font-medium text-ink">Did you mean: “{refinedQuestion}”?</p>
      {reason && <p className="mt-1 text-xs leading-relaxed text-ink-secondary">{reason}</p>}
      <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
        Nothing has been answered yet - whichever you pick is what gets written,
        checked and scored.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onAskRefined}
          disabled={busy}
          className={cx(
            "rounded-full bg-brand px-3.5 py-1.5 text-xs font-medium text-white",
            "transition-colors hover:bg-brand-dark disabled:opacity-60",
          )}
        >
          {busy ? "Asking…" : "Ask it this way"}
        </button>
        <button
          type="button"
          onClick={onKeepOriginal}
          disabled={busy}
          className="rounded-full px-3 py-1.5 text-xs text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-60"
        >
          Keep my wording
        </button>
      </div>
    </div>
  );
}
