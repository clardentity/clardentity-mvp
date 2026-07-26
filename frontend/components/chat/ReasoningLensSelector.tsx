"use client";

export const REASONING_LENSES = [
  { value: "analytical", label: "Analytical" },
  { value: "critical", label: "Critical" },
  { value: "creative", label: "Creative" },
  { value: "divergent", label: "Divergent" },
  { value: "convergent", label: "Convergent" },
  { value: "abstract", label: "Abstract" },
  { value: "concrete", label: "Concrete" },
  { value: "associative", label: "Associative" },
  { value: "linear", label: "Linear" },
  { value: "non_linear", label: "Non-linear" },
  { value: "meta_cognitive", label: "Meta-cognitive" },
] as const;

export type ReasoningLens = (typeof REASONING_LENSES)[number]["value"];

export function ReasoningLensSelector({
  value,
  onChange,
  disabled,
}: {
  value: ReasoningLens | null;
  onChange: (lens: ReasoningLens | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="reasoning-lens" className="text-xs text-slate-400">
        Reasoning lens
      </label>
      <select
        id="reasoning-lens"
        value={value ?? ""}
        disabled={disabled}
        onChange={(e) => onChange((e.target.value || null) as ReasoningLens | null)}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 focus:border-brand focus:outline-none disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
      >
        <option value="">None (balanced)</option>
        {REASONING_LENSES.map((lens) => (
          <option key={lens.value} value={lens.value}>
            {lens.label}
          </option>
        ))}
      </select>
    </div>
  );
}
