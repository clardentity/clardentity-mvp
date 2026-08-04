"use client";

export const COGNITIVE_MODES = [
  { value: "knowing", label: "Knowing", hint: "Fact lookup" },
  { value: "thinking", label: "Thinking", hint: "Step reasoning" },
  { value: "decision", label: "Decision", hint: "Tradeoffs" },
  { value: "learning", label: "Learning", hint: "Explain & quiz" },
] as const;

export type CognitiveMode = (typeof COGNITIVE_MODES)[number]["value"];

export function ModeSelector({
  value,
  onChange,
  disabled,
}: {
  value: CognitiveMode | null;
  onChange: (mode: CognitiveMode) => void;
  disabled?: boolean;
}) {
  return (
    // A segmented control rather than loose pills: the four modes are one
    // mutually-exclusive choice, and §7.2 requires the user make it explicitly.
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
            title={mode.hint}
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
  );
}
