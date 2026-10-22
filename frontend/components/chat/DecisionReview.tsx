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
 *
 * Rebuilt onto the app's own scale. It used to be 12px from its heading to
 * its smallest footnote, with the bias names set in uppercase amber, and it
 * sat directly above a 20px gist - so the analysis read as small print
 * attached to the answer rather than as the other half of it. There are three
 * steps now: the option you are being told about, why, and the footnote that
 * defines the bias. The bias name is a chip rather than a shout.
 */

function Tick() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-5">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function Warn() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-5">
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </svg>
  );
}

/** The named bias, or the verdict on a suggestion. A chip, in the colour of
 *  what it is saying - which is enough emphasis for a phrase that is often a
 *  dozen words of Latin. */
function Chip({ tone, children }: { tone: "sound" | "flagged"; children: React.ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-[1px] text-xs leading-[normal]",
        tone === "sound"
          ? "border-band-high-border bg-band-high-bg text-band-high"
          : "border-caution-border bg-caution-bg text-caution",
      )}
    >
      {children}
    </span>
  );
}

/* The bias definitions and the crossed-out explanation are text-sm, the size
 * of the sentences above them, held apart by colour alone: at text-xs they
 * were 10px on the screen under the root zoom, and a tester (2026-10-22)
 * asked for them larger. */
function Heading({ children, note }: { children: React.ReactNode; note?: string }) {
  return (
    <h4 className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium leading-[normal] text-ink">
      {children}
      {note && <span className="text-xs font-normal text-ink-muted">{note}</span>}
    </h4>
  );
}

export function DecisionReview({ review }: { review: DecisionReviewData }) {
  const hasOptions = Boolean(review.options?.length);
  const hasSuggestions = Boolean(review.suggestions?.length);
  if (!hasOptions && !hasSuggestions) return null;

  const unsound = review.options.filter((o) => !o.sound).length;

  return (
    // The card the rest of the app is built from: white, a hairline, a 12px
    // radius. The old inset grey made it look like a quoted aside.
    <section className="mb-3 rounded-[12px] border border-hairline bg-surface p-4">
      {hasOptions && (
        <>
          <Heading
            note={
              unsound === 0
                ? "all sound"
                : unsound === review.options.length
                  ? "all flagged"
                  : `${unsound} flagged`
            }
          >
            Your options, checked
          </Heading>

          <ul className="mt-4 space-y-4">
            {review.options.map((option, i) => (
              <li key={i} className="flex gap-3">
                <span
                  className={cx("mt-px shrink-0", option.sound ? "text-band-high" : "text-caution")}
                >
                  {option.sound ? <Tick /> : <Warn />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-sm font-medium leading-[normal] text-ink">
                      {option.label}
                    </span>
                    {/* The bias is named here and only here. It is the reader's
                        own reasoning being described, which is the one place the
                        taxonomy label earns its keep. */}
                    {option.bias_name && <Chip tone="flagged">{option.bias_name}</Chip>}
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-ink-secondary">{option.why}</p>
                  {option.bias_definition && (
                    <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                      {option.bias_definition}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {review.alternative && (
        // Only ever present when every option was flagged. Telling someone all
        // their choices are compromised and stopping there is a criticism
        // rather than help.
        <div className="mt-4 rounded-[12px] border border-brand-border bg-brand-soft p-4">
          <Heading>None of these are correct. Consider instead</Heading>
          <p className="mt-2 text-sm font-medium leading-relaxed text-ink">{review.alternative}</p>
          {review.alternative_why && (
            <p className="mt-1 text-sm leading-relaxed text-ink-secondary">
              {review.alternative_why}
            </p>
          )}
        </div>
      )}

      {hasSuggestions && (
        // Decision mode's replacement for the evidence panel. Present whether
        // or not they brought options of their own: the useful output of a
        // decision question is decisions, and there is nothing to cite.
        <div className={hasOptions ? "mt-5 border-t border-hairline pt-5" : ""}>
          <Heading>One decision that&apos;s correct, and the ones that aren&apos;t</Heading>
          {/* What the crossed-out lines are, said before anyone has to work it
              out. A tester (2026-10-20) "was confused why I am seeing answer
              which is crossed" until realising it showed "the clarity between
              right and wrong choices" - which is the point, so say it. */}
          {review.suggestions.some((s) => !s.sound) && (
            <p className="mt-1 text-sm leading-relaxed text-ink-muted">
              The crossed-out ones are choices people often reach for here. Each is shown with the
              reasoning trap behind it, so you can see why not to.
            </p>
          )}
          {/* Not numbered. A numbered list of decisions reads as a ranking,
              and three of these are things not to do - the reader has to be
              able to tell which is which at a glance, before reading a word
              of the reasoning. Tick or warning, colour, and the chip do that
              job; position does not. */}
          <ul className="mt-4 space-y-4">
            {review.suggestions.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className={cx("mt-px shrink-0", s.sound ? "text-band-high" : "text-caution")}>
                  {s.sound ? <Tick /> : <Warn />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span
                      className={cx(
                        "text-sm font-medium leading-[normal]",
                        // A struck-through decision cannot be misread as advice
                        // if someone skims only the bold line.
                        s.sound
                          ? "text-ink"
                          : "text-ink-secondary line-through decoration-caution/50",
                      )}
                    >
                      {s.decision}
                    </span>
                    <Chip tone={s.sound ? "sound" : "flagged"}>
                      {s.sound ? "Correct" : (s.bias_name ?? "Incorrect")}
                    </Chip>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-ink-secondary">{s.why}</p>
                  {!s.sound && s.bias_definition && (
                    <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                      {s.bias_definition}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
