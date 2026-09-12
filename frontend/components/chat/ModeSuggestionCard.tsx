"use client";

import { COMING_SOON_MODES, MODE_BY_VALUE, type CognitiveMode } from "@/lib/modes";
import { companionLabel, useCompanionNames } from "@/lib/companionNames";
import { setSmartSwitching } from "@/lib/modeSwitching";
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
 * Wording and buttons follow the client's spec verbatim: "Switching to X mode
 * because it suits this better" / the reason / Ok | Stay in <current>.
 *
 * A suggestion for a mode that isn't open yet can't be taken: it becomes an
 * upgrade prompt instead, with "stay" still one click away - the product's
 * promise that the user picks the mode holds either way.
 */

export function ModeSuggestionCard({
  suggestedMode,
  reason,
  currentMode,
  busy,
  onSwitch,
  onContinue,
  onUpgrade,
}: {
  suggestedMode: string;
  reason: string | null;
  currentMode: string;
  busy?: boolean;
  onSwitch: () => void;
  onContinue: () => void;
  /** Opens the plans dialog. Called instead of `onSwitch` when the suggested
   *  mode is locked. */
  onUpgrade?: () => void;
}) {
  const names = useCompanionNames();
  const suggested = MODE_BY_VALUE[suggestedMode as CognitiveMode];
  const current = MODE_BY_VALUE[currentMode as CognitiveMode];
  if (!suggested) return null;

  const suggestedLabel = companionLabel(names, suggestedMode, suggested.label);
  const currentLabel = companionLabel(names, currentMode, current?.label ?? currentMode);
  const locked = COMING_SOON_MODES.includes(suggestedMode as CognitiveMode);

  return (
    <div className="mt-2 rounded-xl border border-brand-border bg-brand-soft p-3.5">
      <p className="text-sm font-medium text-ink">
        {locked
          ? `${suggestedLabel} mode would suit this better - it's part of Clardentity Pro.`
          : `Switching to ${suggestedLabel} mode because it suits this better.`}
      </p>
      {reason && (
        <p className="mt-1 text-xs leading-relaxed text-ink-secondary">{reason}</p>
      )}
      <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
        Nothing has been answered yet - whichever you pick is what gets written,
        checked and scored.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {locked ? (
          <button
            type="button"
            onClick={onUpgrade}
            disabled={busy || !onUpgrade}
            className={cx(
              "rounded-full bg-brand px-3.5 py-1.5 text-xs font-medium text-white",
              "transition-colors hover:bg-brand-dark disabled:opacity-60",
            )}
          >
            See Pro
          </button>
        ) : (
          <button
            type="button"
            onClick={onSwitch}
            disabled={busy}
            className={cx(
              "rounded-full bg-brand px-3.5 py-1.5 text-xs font-medium text-white",
              "transition-colors hover:bg-brand-dark disabled:opacity-60",
            )}
          >
            {busy ? "Asking…" : "Ok"}
          </button>
        )}
        <button
          type="button"
          onClick={onContinue}
          disabled={busy}
          className="rounded-full px-3 py-1.5 text-xs text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-60"
        >
          Stay in {currentLabel}
        </button>
        <button
          type="button"
          onClick={() => {
            // Manual switching from here on: the mode is whatever they
            // picked, and this card stops appearing. Reversible from the
            // "Suggestions" control beside the mode picker.
            setSmartSwitching(false);
            onContinue();
          }}
          disabled={busy}
          className="ml-auto text-[11px] text-ink-muted transition-colors hover:text-ink disabled:opacity-60"
        >
          Don&apos;t suggest modes
        </button>
      </div>
    </div>
  );
}
