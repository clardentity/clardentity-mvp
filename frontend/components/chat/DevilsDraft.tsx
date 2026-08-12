"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/apiClient";
import { authErrorMessage } from "@/lib/auth";
import { cx, Spinner } from "@/components/ui/primitives";
import { cleanMessageText } from "@/lib/text";

/** Both panes read as prose so the eye compares wording, which is the only
 *  thing that differs between them. Citation markers point at a source list
 *  neither pane is showing. */
function comparableText(text: string): string {
  return cleanMessageText(text).replace(/\s*\[\d+\]/g, "");
}

/* "Devil's Draft" - the draft before the checks, and the devil's advocate at
 * the same time. The point of showing it is that a careful answer, read alone,
 * gives you no sense of what the care cost you: hedges and counter-arguments
 * read as waffle right up until you see the confident version that leaves them
 * out, and then it's obvious which of them were load-bearing.
 *
 * Generated in parallel with the answer's own validation, so by the time the
 * message lands the comparison is already sitting on it and the panel opens
 * instantly. The endpoint remains for older messages that predate that, and
 * for any turn where the parallel generation failed. */

function DevilIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {/* Horns over a speech bubble: an argument with an agenda. */}
      <path d="M5 8V5l3 2M19 8V5l-3 2" />
      <path d="M20 15a2 2 0 0 1-2 2H8l-4 3V10a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function DevilsDraft({
  conversationId,
  messageId,
  answer,
  preloaded,
}: {
  conversationId: string;
  messageId: string;
  answer: string;
  /** Generated alongside the answer and shipped with it. When present the
   *  panel opens instantly and the endpoint is never called. */
  preloaded?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | null>(preloaded ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (text || loading) return;

    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ counterfactual_content: string }>(
        `/chat/${conversationId}/messages/${messageId}/devils-advocate`,
        { method: "POST" },
      );
      setText(res.counterfactual_content);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        title="See the same answer written to persuade rather than to inform"
        className={cx(
          "-mx-1 inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-xs transition-colors",
          open
            ? "text-caution"
            : "text-ink-muted hover:bg-surface-hover hover:text-caution",
        )}
      >
        <DevilIcon className="h-3.5 w-3.5" />
        {open ? "Hide the Devil's Draft" : "Devil's Draft"}
        <span className="text-ink-muted">compare against the unchecked version</span>
      </button>

      {open && (
        <div className="mt-2">
          {/* Said before the two panes rather than after them. It is the
              instruction for how to read the comparison, and underneath it
              was a footnote explaining something you had already misread. */}
          <p className="text-[11px] leading-relaxed text-ink-muted">
            Same question, same conclusion, bias screening switched off. The
            second version states things flatly, drops the caveats and leads
            with whatever lands hardest - so the difference between them is
            what the screening was doing for you.
          </p>

          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <section className="rounded-lg border border-hairline bg-surface-muted p-3">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-band-high">
                What you were told
              </h4>
              <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-secondary">
                {/* The bubble above renders this cleaned and with its
                    citations turned into markers; showing the raw string here
                    put stray "[2]"s and leftover markup on one side of a
                    comparison whose whole point is the difference in
                    *wording*. */}
                {comparableText(answer)}
              </p>
            </section>

            <section className="rounded-lg border border-caution-border bg-caution-bg p-3">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-caution">
                What it would have said unchecked
              </h4>
              {loading && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-caution">
                  <Spinner className="h-3 w-3" />
                  Arguing the other way…
                </p>
              )}
              {error && <p className="mt-1.5 text-xs text-band-low">{error}</p>}
              {text && (
                // Body in the ordinary reading colour, not the warning
                // colour. A full paragraph of orange is a thing you skim and
                // give up on, and this is the half you are meant to read
                // closely - the border and heading already carry the warning.
                <p className="mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-secondary">
                  {comparableText(text)}
                </p>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
