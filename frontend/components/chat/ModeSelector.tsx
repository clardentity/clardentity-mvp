"use client";

import { useEffect, useRef } from "react";

import { COGNITIVE_MODES, MODE_BY_VALUE, type CognitiveMode } from "@/lib/modes";

export { COGNITIVE_MODES };
export type { CognitiveMode };

/** Mode choice is deliberately explicit (SRS §7.2 - no auto-detection), so the
 *  control has to make the choice easy rather than merely available. Before a
 *  mode is picked it shows all four with a plain-language "when to use this";
 *  afterwards it collapses to a compact segmented control so it stops
 *  competing with the conversation for attention.
 */
export function ModeSelector({
  value,
  onChange,
  disabled,
}: {
  value: CognitiveMode | null;
  onChange: (mode: CognitiveMode) => void;
  disabled?: boolean;
}) {
  const stripRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);

  // The row scrolls, so at 320px the fourth pill sits past the right edge -
  // and if that pill is the mode you are in, the control is hiding the one
  // thing it exists to tell you. Bring the selected mode into view.
  //
  // Its own scrollLeft rather than scrollIntoView: the latter also scrolls
  // every scrollable ancestor, which jerks the conversation on mount.
  useEffect(() => {
    const strip = stripRef.current;
    const pill = selectedRef.current;
    if (!strip || !pill) return;
    strip.scrollLeft = Math.max(0, pill.offsetLeft - (strip.clientWidth - pill.offsetWidth) / 2);
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
          className="grid gap-2 sm:grid-cols-2"
        >
          {COGNITIVE_MODES.map((mode) => (
            <button
              key={mode.value}
              type="button"
              role="radio"
              aria-checked={false}
              disabled={disabled}
              onClick={() => onChange(mode.value)}
              className="rounded-xl border border-hairline bg-surface p-3 text-left transition-colors hover:border-brand-border hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="block text-sm font-semibold text-ink">{mode.label}</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">
                {mode.when}
              </span>
            </button>
          ))}
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
        // Four pills already fill 375px edge to edge. Rather than wrap them
        // into a ragged second row or shrink the text below legibility, the
        // row scrolls: every mode stays one tap away and the control keeps
        // its shape at any width.
        className="scroll-slim inline-flex max-w-full overflow-x-auto rounded-lg border border-hairline-strong bg-surface-muted p-0.5"
      >
        {COGNITIVE_MODES.map((mode) => {
          const selected = value === mode.value;
          return (
            <button
              key={mode.value}
              ref={selected ? selectedRef : undefined}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(mode.value)}
              title={mode.when}
              className={`shrink-0 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 sm:px-3 ${
                selected
                  ? "bg-brand text-white"
                  : "text-ink-secondary hover:bg-surface-hover hover:text-ink"
              }`}
            >
              {mode.label}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-ink-muted">{MODE_BY_VALUE[value].hint}</p>
    </div>
  );
}
