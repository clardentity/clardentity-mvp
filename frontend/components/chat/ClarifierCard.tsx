"use client";

import { useEffect, useState } from "react";
import { cx } from "@/components/ui/primitives";

/* One question the answer needs answered, with options you can click.
 *
 * The answer above it is already there - this is never a gate. That matters:
 * a companion that stops and asks before saying anything is a form, and the
 * whole point of asking is to make a good answer better rather than to make
 * you work before you get one.
 *
 * Options are numbered and 1-4 select them, because the fastest way to answer
 * a question you're already looking at is not to reach for the mouse. */

export function ClarifierCard({
  question,
  options,
  onAnswer,
  disabled,
}: {
  question: string;
  options: string[];
  onAnswer: (answer: string) => void;
  disabled?: boolean;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [custom, setCustom] = useState("");

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (dismissed || disabled) return;
      // Never while a field has focus. That covers the composer and this
      // card's own "something else" box, where a number key is a number.
      const active = document.activeElement;
      if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < options.length) {
        event.preventDefault();
        onAnswer(options[index]);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dismissed, disabled, options, onAnswer]);

  if (dismissed) return null;

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-brand-border bg-brand-soft">
      <div className="flex items-start justify-between gap-3 px-3 py-2">
        <p className="text-xs font-medium text-ink">{question}</p>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss question"
          className="shrink-0 rounded-md p-0.5 text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
            className="h-3 w-3"
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <ul className="divide-y divide-hairline border-t border-hairline">
        {options.map((option, index) => (
          <li key={option}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onAnswer(option)}
              className={cx(
                "flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors",
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

      <form
        className="flex items-center gap-2 border-t border-hairline px-3 py-2"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = custom.trim();
          if (trimmed) onAnswer(trimmed);
        }}
      >
        <input
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
          disabled={disabled}
          placeholder="Something else"
          aria-label="Answer in your own words"
          className="min-w-0 flex-1 bg-transparent text-xs text-ink placeholder:text-ink-muted focus:outline-none"
        />
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="shrink-0 rounded-md border border-hairline-strong px-2 py-0.5 text-[11px] text-ink-secondary transition-colors hover:bg-surface-hover"
        >
          Skip
        </button>
      </form>
    </div>
  );
}
