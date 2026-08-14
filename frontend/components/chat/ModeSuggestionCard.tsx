"use client";

import { MODE_BY_VALUE, type CognitiveMode } from "@/lib/modes";
import { cx } from "@/components/ui/primitives";

/* Offered before the answer exists, not after.
 *
 * A question answered in the wrong mode has already had its claims extracted,
 * its evidence gathered and its score computed against the wrong standard.
 * Offering to switch underneath that asks the reader to throw away work they
 * can see, so this stops first and asks. Nothing has been written when it
 * appears: no message saved, no answer generated, so either choice costs the
 * same single round trip.
 *
 * The chosen mode wins by default in the sense that continuing is always one
 * click and never a dead end - this is a suggestion, and the product's promise
 * is that the user picks the mode.
 */

export function ModeSuggestionCard({
  suggestedMode,
  reason,
  currentMode,
  busy,
  onSwitch,
  onContinue,
}: {
  suggestedMode: string;
  reason: string | null;
  currentMode: string;
  busy?: boolean;
  onSwitch: () => void;
  onContinue: () => void;
}) {
  const suggested = MODE_BY_VALUE[suggestedMode as CognitiveMode];
  const current = MODE_BY_VALUE[currentMode as CognitiveMode];
  if (!suggested) return null;

  return (
    <div className="mt-2 rounded-xl border border-brand-border bg-brand-soft p-3.5">
      <p className="text-sm font-medium text-ink">
        {suggested.label} mode suits this better.
      </p>
      {reason && (
        <p className="mt-1 text-xs leading-relaxed text-ink-secondary">{reason}</p>
      )}
      <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
        Nothing has been answered yet - whichever you pick is what gets written,
        checked and scored.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onSwitch}
          disabled={busy}
          className={cx(
            "rounded-full bg-brand px-3.5 py-1.5 text-xs font-medium text-white",
            "transition-colors hover:bg-brand-dark disabled:opacity-60",
          )}
        >
          {busy ? "Asking…" : `Answer in ${suggested.label}`}
        </button>
        <button
          type="button"
          onClick={onContinue}
          disabled={busy}
          className="rounded-full px-3 py-1.5 text-xs text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-60"
        >
          Stay in {current?.label ?? currentMode}
        </button>
      </div>
    </div>
  );
}
