"use client";

import { cx } from "@/components/ui/primitives";

/** SRS §9.3 bands. Colour is deliberately the strongest signal on a message,
 *  so these are the only saturated hues in the chat surface. */
const BAND_STYLES: Record<string, string> = {
  "Likely Fact": "bg-band-high-bg text-band-high border-band-high-border",
  Plausible: "bg-band-mid-bg text-band-mid border-band-mid-border",
  "Needs Verification": "bg-band-low-bg text-band-low border-band-low-border",
};

const BAND_DOTS: Record<string, string> = {
  "Likely Fact": "bg-band-high",
  Plausible: "bg-band-mid",
  "Needs Verification": "bg-band-low",
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
    BAND_STYLES[band] ?? "bg-surface-sunken text-ink-secondary border-hairline";
  const dot = BAND_DOTS[band] ?? "bg-ink-muted";

  return (
    <button
      type="button"
      onClick={onClick}
      title={onClick ? "Show the evidence behind this score" : undefined}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-opacity",
        style,
        onClick ? "cursor-pointer hover:opacity-80" : "cursor-default",
      )}
    >
      <span className={cx("h-1.5 w-1.5 rounded-full", dot)} aria-hidden="true" />
      {band}
      {score !== null && (
        <span className="tabular-nums opacity-70">{Math.round(score)}</span>
      )}
    </button>
  );
}
