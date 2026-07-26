"use client";

const BAND_STYLES: Record<string, string> = {
  "Likely Fact":
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  Plausible: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  "Needs Verification": "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

export function ConfidenceBadge({
  band,
  score,
  onClick,
}: {
  band: string;
  score: number | null;
  onClick?: () => void;
}) {
  const style =
    BAND_STYLES[band] ?? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${style} ${
        onClick ? "cursor-pointer hover:opacity-80" : "cursor-default"
      }`}
    >
      {band}
      {score !== null ? ` · ${Math.round(score)}` : ""}
    </button>
  );
}
