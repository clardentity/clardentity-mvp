"use client";

import { useState } from "react";
import { cx } from "@/components/ui/primitives";

/* Offered before the answer exists, not after.
 *
 * One specific piece of information is missing and there's a short,
 * enumerable set of likely answers - "what are you trying to get better at?"
 * with a handful of genuinely different readings - so this asks with
 * tappable options instead of either guessing one or opening a free-text box
 * (`ContextQuestionCard`'s job, for questions with no short answer list).
 * Nothing has been written when it appears: no message saved, no answer
 * generated, so tapping an option, typing one, or skipping all cost the same
 * single round trip.
 *
 * Options are numbered and 1-4 select them, for the same reason the old
 * post-answer clarifier did: the fastest way to answer a question you're
 * already looking at is not to reach for the mouse.
 */

export function ClarifyingOptionsCard({
  question,
  options,
  busy,
  onAnswer,
  onSkip,
}: {
  question: string;
  options: string[];
  busy?: boolean;
  onAnswer: (answer: string) => void;
  onSkip: () => void;
}) {
  const [customOpen, setCustomOpen] = useState(false);
  const [custom, setCustom] = useState("");

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-brand-border bg-brand-soft">
      <p className="px-3.5 py-2.5 text-sm font-medium text-ink">{question}</p>

      <ul className="divide-y divide-hairline border-t border-hairline">
        {options.map((option, index) => (
          <li key={option}>
            <button
              type="button"
              disabled={busy}
              onClick={() => onAnswer(option)}
              className={cx(
                "flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm transition-colors",
                "hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded border border-hairline-strong text-[10px] tabular-nums text-ink-muted">
                {index + 1}
              </span>
              <span className="text-ink">{option}</span>
            </button>
          </li>
        ))}
      </ul>

      {customOpen ? (
        <form
          className="flex items-center gap-2 border-t border-hairline px-3.5 py-2"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = custom.trim();
            if (trimmed) onAnswer(trimmed);
          }}
        >
          <input
            value={custom}
            onChange={(event) => setCustom(event.target.value)}
            disabled={busy}
            autoFocus
            placeholder="Something else"
            aria-label="Answer in your own words"
            className="min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-muted focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || !custom.trim()}
            className="shrink-0 rounded-full bg-brand px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-brand-dark disabled:opacity-40"
          >
            {busy ? "Asking…" : "Send"}
          </button>
        </form>
      ) : (
        <div className="flex items-center gap-2 border-t border-hairline px-3.5 py-2">
          <button
            type="button"
            onClick={() => setCustomOpen(true)}
            disabled={busy}
            className="rounded-full px-2.5 py-1 text-xs text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-60"
          >
            Something else
          </button>
          <button
            type="button"
            onClick={onSkip}
            disabled={busy}
            className="ml-auto rounded-full px-2.5 py-1 text-xs text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-60"
          >
            Answer without this
          </button>
        </div>
      )}
    </div>
  );
}
