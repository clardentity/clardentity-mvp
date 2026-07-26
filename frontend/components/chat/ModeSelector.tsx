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
    <div className="flex flex-wrap gap-2">
      {COGNITIVE_MODES.map((mode) => {
        const selected = value === mode.value;
        return (
          <button
            key={mode.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(mode.value)}
            className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
              selected
                ? "border-brand bg-brand text-white"
                : "border-slate-300 bg-white text-slate-700 hover:border-brand dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
            }`}
            title={mode.hint}
          >
            {mode.label}
          </button>
        );
      })}
    </div>
  );
}
