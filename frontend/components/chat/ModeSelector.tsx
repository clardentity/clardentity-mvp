"use client";

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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <div
        role="radiogroup"
        aria-label="Cognitive mode"
        className="inline-flex rounded-lg border border-hairline-strong bg-surface-muted p-0.5"
      >
        {COGNITIVE_MODES.map((mode) => {
          const selected = value === mode.value;
          return (
            <button
              key={mode.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange(mode.value)}
              title={mode.when}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
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
