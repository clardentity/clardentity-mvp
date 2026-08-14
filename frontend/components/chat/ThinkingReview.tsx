"use client";

import type { ThinkingReviewData } from "@/lib/sse";

/* What Thinking mode shows where the evidence panel would be.
 *
 * Claims and citations are the wrong instrument for a reasoning chain: it is
 * sound or unsound because of how it moves between steps, not because a
 * document agrees with it. So the panel here is a contrast - the reasoning
 * that holds for this question against the way it most easily goes wrong -
 * and the failure modes carry their catalogue names, because "you'll weight
 * the first number you saw" is worth more with "Anchoring Bias" attached.
 *
 * It describes the question, not our answer, which means it is also a
 * checklist you can hold the answer up against.
 */

export function ThinkingReview({ review }: { review: ThinkingReviewData }) {
  if (!review.sound?.length || !review.biased?.length) return null;

  return (
    <section className="mt-2.5 rounded-xl border border-hairline bg-surface-muted p-3">
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-secondary">
        How to think about this
      </h4>

      <div className="mt-2.5 grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-band-high">
            Holds up
          </p>
          <ul className="mt-1.5 space-y-2">
            {review.sound.map((entry, i) => (
              <li key={i}>
                <p className="text-xs font-medium leading-relaxed text-ink">{entry.approach}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-ink-secondary">
                  {entry.why}
                </p>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-caution">
            Goes wrong
          </p>
          <ul className="mt-1.5 space-y-2">
            {review.biased.map((entry, i) => (
              <li key={i}>
                <p className="text-xs font-medium leading-relaxed text-ink">{entry.approach}</p>
                {entry.bias_name && (
                  <p className="mt-0.5 text-[11px] font-medium text-caution">{entry.bias_name}</p>
                )}
                <p className="mt-0.5 text-[11px] leading-relaxed text-ink-secondary">
                  {entry.why}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
