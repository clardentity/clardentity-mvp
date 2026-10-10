"use client";

import { useCallback, useEffect, useRef } from "react";

import { COGNITIVE_MODES, type CognitiveMode } from "@/lib/modes";
import { useLockedModes } from "@/lib/previewAccess";
import { companionLabel, useCompanionNames } from "@/lib/companionNames";
import { MaskIcon } from "@/components/ui/MaskIcon";
import { rectScale } from "@/lib/uiScale";
import { cx } from "@/components/ui/primitives";
import { useScrollEdges } from "@/lib/useScrollEdges";

export { COGNITIVE_MODES };
export type { CognitiveMode };

/** Mode choice is deliberately explicit (SRS §7.2 - no auto-detection), so the
 *  control has to make the choice easy rather than merely available. Before a
 *  mode is picked it shows all seven with a plain-language "when to use this";
 *  afterwards it collapses to a compact segmented control so it stops
 *  competing with the conversation for attention.
 */
export function ModeSelector({
  value,
  onChange,
  disabled,
  onLocked,
  lockedModes: lockedOverride,
  folded = false,
  onUnfold,
  holdFocus = false,
}: {
  value: CognitiveMode | null;
  onChange: (mode: CognitiveMode) => void;
  disabled?: boolean;
  /** A "Soon" mode was tapped. When provided, those modes stay greyed but
   *  respond - opening the plans dialog - rather than being dead buttons that
   *  give no hint of what would unlock them. */
  onLocked?: (mode: CognitiveMode) => void;
  /** Overrides the account's own locks. The landing page's guest demo passes
   *  an empty list, because the lock is a fact about an account and a guest
   *  does not have one: /guest/chat answers in any of the eight, so locking
   *  four of them there would refuse a companion the server is willing to
   *  be. */
  lockedModes?: readonly CognitiveMode[];
  /** Phone, while typing: the rail folds to one chip naming the current
   *  mode, giving the conversation back the rail's height above the
   *  keyboard. Tapping the chip calls `onUnfold`. */
  folded?: boolean;
  onUnfold?: () => void;
  /** Opened from the chip while typing: tapping a mode leaves the chat box
   *  focused, so the keyboard stays up. */
  holdFocus?: boolean;
}) {
  const names = useCompanionNames();
  // Which companions are locked is an account fact, not a constant: "Skip
  // for now" in the plans dialog opens them for testing.
  const accountLocks = useLockedModes();
  const lockedModes = lockedOverride ?? accountLocks;
  const stripRef = useRef<HTMLDivElement>(null);
  // on a phone the rail scrolls; its edges fade where more companions are
  const fadeEdges = useScrollEdges("x");
  const setStrip = useCallback(
    (el: HTMLDivElement | null) => {
      stripRef.current = el;
      return fadeEdges(el);
    },
    [fadeEdges],
  );
  const selectedRef = useRef<HTMLButtonElement>(null);

  // The row scrolls, so at 320px the fourth pill sits past the right edge -
  // and if that pill is the mode you are in, the control is hiding the one
  // thing it exists to tell you. Bring the selected mode into view.
  //
  // Its own scrollLeft rather than scrollIntoView: the latter also scrolls
  // every scrollable ancestor, which jerks the conversation on mount.
  //
  // Measured with bounding rects, not offsetLeft: the strip is not
  // positioned, so offsetLeft was relative to the page, and on a desktop
  // layout - strip hundreds of pixels from the left edge - that put even
  // the first pill "far to the right" and opened every chat scrolled to
  // Legal with Finder, the selected mode, out of view.
  useEffect(() => {
    const strip = stripRef.current;
    const pill = selectedRef.current;
    if (!strip || !pill) return;
    // scrollLeft, clientWidth and offsetWidth are in layout pixels; a measured
    // rect is in screen pixels, which the root's zoom has already shrunk. The
    // gap between the two has to be converted before it joins them.
    const gap =
      (pill.getBoundingClientRect().left - strip.getBoundingClientRect().left) / rectScale();
    const offset = gap + strip.scrollLeft;
    strip.scrollLeft = Math.max(0, offset - (strip.clientWidth - pill.offsetWidth) / 2);
    // folded too: unfolding mounts a fresh rail, scrolled to its start
  }, [value, folded]);

  const current = COGNITIVE_MODES.find((m) => m.value === value);
  if (folded && current) {
    return (
      <div className="flex">
        <button
          type="button"
          data-testid="mode-chip"
          // mousedown, the usual way to keep a phone keyboard up: the chat
          // box keeps its focus, so the keyboard
          // stays up while the rail opens.
          onMouseDown={(e) => e.preventDefault()}
          onClick={onUnfold}
          aria-label={`Mode: ${companionLabel(names, current.value, current.label)}. Show all modes`}
          aria-expanded={false}
          className="tap-area inline-flex items-center gap-1.5 rounded-full border border-brand-border bg-brand-soft py-1 pl-2.5 pr-3 text-sm font-medium text-brand animate-[fade-in_0.15s_ease]"
        >
          <MaskIcon src={current.icon} className="size-4" />
          <span className="whitespace-nowrap">{companionLabel(names, current.value, current.label)}</span>
          <svg viewBox="0 0 12 12" aria-hidden="true" className="size-3 opacity-70">
            <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    );
  }

  if (value === null) {
    return (
      <div>
        <p className="mb-2 text-sm text-ink-secondary">
          How should the companion approach this?
        </p>
        <div
          role="radiogroup"
          aria-label="Cognitive mode"
          data-tour="mode-picker"
          className="grid gap-2 sm:grid-cols-2"
        >
          {COGNITIVE_MODES.map((mode) => {
            const comingSoon = lockedModes.includes(mode.value);
            return (
              <button
                key={mode.value}
                type="button"
                role="radio"
                aria-checked={false}
                aria-disabled={comingSoon || undefined}
                disabled={disabled || (comingSoon && !onLocked)}
                onClick={() => (comingSoon ? onLocked?.(mode.value) : onChange(mode.value))}
                className={cx(
                  "rounded-xl border border-hairline bg-surface p-3 text-left transition-colors hover:border-brand-border hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-hairline disabled:hover:bg-surface",
                  comingSoon && "opacity-60",
                )}
              >
                <span className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                  {companionLabel(names, mode.value, mode.label)}
                  {comingSoon && (
                    <span className="rounded-full bg-surface-hover px-1.5 py-[1px] text-xs font-medium uppercase tracking-wide text-ink-muted">
                      Soon
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">
                  {mode.when}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    // min-w-0 so the pill row can shrink inside the flex parent instead of
    // forcing it wider; without it a 320px screen pushes the avatar beside it
    // onto its own line, or off the edge entirely.
    <div className="flex w-full min-w-0 flex-col gap-1.5">
      <div
        ref={setStrip}
        role="radiogroup"
        aria-label="Cognitive mode"
        data-tour="mode-picker"
        // The design's rail: eight separate cards spread across the width of
        // the composer below, each a 20px mark above a 16px name. Below that
        // width it scrolls rather than wrapping into a ragged second row -
        // every companion stays one tap away and the rail keeps its shape.
        className="scroll-slim scroll-fade-x flex w-full max-w-full items-stretch justify-between gap-1 overflow-x-auto"
      >
        {COGNITIVE_MODES.map((mode) => {
          const selected = value === mode.value;
          const comingSoon = lockedModes.includes(mode.value);
          return (
            <button
              key={mode.value}
              ref={selected ? selectedRef : undefined}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-disabled={comingSoon || undefined}
              disabled={disabled || (comingSoon && !onLocked)}
              onClick={() => (comingSoon ? onLocked?.(mode.value) : onChange(mode.value))}
              onMouseDown={holdFocus ? (e) => e.preventDefault() : undefined}
              title={comingSoon ? `${mode.when} (included in a paid plan)` : mode.when}
              className={cx(
                // touch-manipulation so a tap on a phone is a tap: the rail
                // scrolls sideways, and without it the browser waits to see
                // whether a finger down is the start of a drag.
                "flex shrink-0 touch-manipulation flex-col items-center justify-center gap-[2px] rounded-[8px] border px-3 py-1 text-sm leading-[normal] transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                comingSoon && "opacity-60",
                // The design draws every card the same and leaves selection
                // to us. A brand-tinted hairline was what that first became,
                // and on this canvas it is almost nothing: people were
                // clicking a mode, getting it, and not being able to tell.
                // The accent now carries the whole card - its edge, its fill
                // and its label - which is unmistakable at a glance without
                // the filled pill that would shout over a rail of eight.
                selected
                  ? "border-brand bg-brand-soft font-medium text-brand"
                  : "border-[color:var(--border)] bg-surface text-ink-secondary hover:border-hairline-strong hover:text-ink",
              )}
            >
              <MaskIcon src={mode.icon} className="size-5" />
              <span className="whitespace-nowrap">
                {companionLabel(names, mode.value, mode.label)}
              </span>
            </button>
          );
        })}
      </div>

    </div>
  );
}
