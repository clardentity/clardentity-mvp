"use client";

import { useEffect, useRef } from "react";

import { COGNITIVE_MODES, COMING_SOON_MODES, MODE_BY_VALUE, type CognitiveMode } from "@/lib/modes";
import { companionLabel, useCompanionNames } from "@/lib/companionNames";
import { cx } from "@/components/ui/primitives";

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
}: {
  value: CognitiveMode | null;
  onChange: (mode: CognitiveMode) => void;
  disabled?: boolean;
  /** A "Soon" mode was tapped. When provided, those modes stay greyed but
   *  respond - opening the plans dialog - rather than being dead buttons that
   *  give no hint of what would unlock them. */
  onLocked?: (mode: CognitiveMode) => void;
}) {
  const names = useCompanionNames();
  const stripRef = useRef<HTMLDivElement>(null);
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
    const offset = pill.getBoundingClientRect().left - strip.getBoundingClientRect().left + strip.scrollLeft;
    strip.scrollLeft = Math.max(0, offset - (strip.clientWidth - pill.offsetWidth) / 2);
  }, [value]);

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
            const comingSoon = COMING_SOON_MODES.includes(mode.value);
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
                    <span className="rounded-full bg-surface-hover px-1.5 py-[1px] text-[10px] font-medium uppercase tracking-wide text-ink-muted">
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
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
      <div
        ref={stripRef}
        role="radiogroup"
        aria-label="Cognitive mode"
        data-tour="mode-picker"
        // Four pills already fill 375px edge to edge. Rather than wrap them
        // into a ragged second row or shrink the text below legibility, the
        // row scrolls: every mode stays one tap away and the control keeps
        // its shape at any width.
        className="scroll-slim inline-flex max-w-full overflow-x-auto rounded-lg border border-hairline-strong bg-surface-muted p-0.5"
      >
        {COGNITIVE_MODES.map((mode) => {
          const selected = value === mode.value;
          const comingSoon = COMING_SOON_MODES.includes(mode.value);
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
              title={comingSoon ? `${mode.when} (coming soon)` : mode.when}
              className={cx(
                "shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:px-3",
                comingSoon && "opacity-60",
                selected
                  ? "bg-brand text-white"
                  : "text-ink-secondary hover:bg-surface-hover hover:text-ink",
              )}
            >
              {companionLabel(names, mode.value, mode.label)}
            </button>
          );
        })}
      </div>
      {/* The one-line promise under the strip. Not on phones: the pill
          already names the mode, and on a 760px screen this line was one of
          the things pushing the thread down to a third of the height. */}
      <p className="hidden text-xs text-ink-muted sm:block">{MODE_BY_VALUE[value]?.hint}</p>
    </div>
  );
}
