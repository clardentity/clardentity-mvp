"use client";

import type { DecisionReviewData } from "@/lib/sse";
import { cx } from "@/components/ui/primitives";

/* A verdict on each option the user brought.
 *
 * Distinct from the answer above it, which compares the options on their
 * merits. This asks a different question - is each one even a fair candidate -
 * and it is the half people don't think to ask for. Shown as a panel rather
 * than folded into the prose because it is a checklist against their own
 * words, and prose is the wrong shape for that.
 */

function Tick() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-3.5 w-3.5">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function Warn() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-3.5 w-3.5">
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </svg>
  );
}

export function DecisionReview({ review }: { review: DecisionReviewData }) {
  const hasOptions = Boolean(review.options?.length);
  const hasSuggestions = Boolean(review.suggestions?.length);
  if (!hasOptions && !hasSuggestions) return null;

  const unsound = review.options.filter((o) => !o.sound).length;

  return (
    <section className="mt-2.5 rounded-xl border border-hairline bg-surface-muted p-3">
      {hasOptions && (
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-secondary">
        Your options, checked
        <span className="ml-1.5 font-normal normal-case tracking-normal text-ink-muted">
          {unsound === 0
            ? "all sound"
            : unsound === review.options.length
              ? "all flagged"
              : `${unsound} flagged`}
        </span>
      </h4>
      )}

      {hasOptions && (
      <ul className="mt-2 space-y-2">
        {review.options.map((option, i) => (
          <li key={i} className="flex gap-2">
            <span
              className={cx("mt-0.5 shrink-0", option.sound ? "text-band-high" : "text-caution")}
            >
              {option.sound ? <Tick /> : <Warn />}
            </span>
            <span className="min-w-0">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-xs font-medium text-ink">{option.label}</span>
                {/* The bias is named here and only here. It is the reader's
                    own reasoning being described, which is the one place the
                    taxonomy label earns its keep. */}
                {option.bias_name && (
                  <span className="text-[11px] font-medium text-caution">{option.bias_name}</span>
                )}
              </span>
              <span className="mt-0.5 block text-xs leading-relaxed text-ink-secondary">
                {option.why}
              </span>
              {option.bias_definition && (
                <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-muted">
                  {option.bias_definition}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      )}

      {review.alternative && (
        // Only ever present when every option was flagged. Telling someone all
        // their choices are compromised and stopping there is a criticism
        // rather than help.
        <div className="mt-3 rounded-lg border border-brand-border bg-brand-soft px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-brand">
            None of these hold up. Consider instead
          </p>
          <p className="mt-1 text-xs font-medium leading-relaxed text-ink">
            {review.alternative}
          </p>
          {review.alternative_why && (
            <p className="mt-1 text-[11px] leading-relaxed text-ink-secondary">
              {review.alternative_why}
            </p>
          )}
        </div>
      )}
      {hasSuggestions && (
        // Decision mode's replacement for the evidence panel. Present whether
        // or not they brought options of their own: the useful output of a
        // decision question is decisions, and there is nothing to cite.
        <div className={hasOptions ? "mt-3 border-t border-hairline pt-3" : ""}>
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-ink-secondary">
            Decisions worth considering
          </h4>
          <ol className="mt-2 space-y-2">
            {review.suggestions.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded bg-surface-hover text-[10px] font-semibold tabular-nums text-ink-secondary">
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-medium leading-relaxed text-ink">
                    {s.decision}
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-secondary">
                    {s.why}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
