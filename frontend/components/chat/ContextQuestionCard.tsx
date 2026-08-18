"use client";

import { useState } from "react";

import { cx } from "@/components/ui/primitives";

/* The question a person would ask before giving an opinion.
 *
 * Deliberately not the clarifier. The clarifier runs after the answer and
 * offers two to four options to tap, which is right for "what do you want to
 * learn next" and grotesque for "why do you want to divorce your wife" - a
 * multiple-choice menu of reasons for ending a marriage would be worse than
 * asking nothing at all. So this is one open question and an empty box.
 *
 * It also cannot become a wall. Answering is optional and skipping is one
 * click: the point is to gather context a good answer needs, not to make
 * someone justify themselves to software before it will help them.
 */

export function ContextQuestionCard({
  question,
  busy,
  onAnswer,
  onSkip,
}: {
  question: string;
  busy?: boolean;
  onAnswer: (context: string) => void;
  onSkip: () => void;
}) {
  const [value, setValue] = useState("");
  const answered = value.trim().length > 0;

  return (
    <div className="mt-2 rounded-xl border border-hairline bg-surface-muted p-3.5">
      <p className="text-sm leading-relaxed text-ink">{question}</p>

      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // Enter sends, Shift+Enter breaks the line - the same contract as
          // the composer directly below it.
          if (e.key === "Enter" && !e.shiftKey && answered && !busy) {
            e.preventDefault();
            onAnswer(value.trim());
          }
        }}
        rows={2}
        autoFocus
        disabled={busy}
        placeholder="However much you want to say."
        className={cx(
          "mt-2.5 w-full resize-none rounded-lg border border-hairline bg-surface px-3 py-2",
          "text-sm text-ink placeholder:text-ink-muted",
          "focus:border-brand-border focus:outline-none disabled:opacity-60",
        )}
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onAnswer(value.trim())}
          disabled={busy || !answered}
          className={cx(
            "rounded-full bg-brand px-3.5 py-1.5 text-xs font-medium text-white",
            "transition-colors hover:bg-brand-dark disabled:opacity-40",
          )}
        >
          {busy ? "Sending…" : "Send"}
        </button>
        <button
          type="button"
          onClick={onSkip}
          disabled={busy}
          className="rounded-full px-3 py-1.5 text-xs text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-60"
        >
          Answer without this
        </button>
      </div>
    </div>
  );
}
