"use client";

import { useEffect, useRef, useState } from "react";
import type { Claim } from "@/lib/sse";
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

/* What the band means, in one sentence each - the badge alone was a red
 * label with a number, and the question that came back was "what does it
 * give me?". The breakdown below it answers with the claim counts. */
const BAND_MEANING: Record<string, string> = {
  "Likely Fact": "Most of the claims in this answer are directly backed by the sources cited.",
  Plausible: "The claims are partly backed - sound, but short of direct confirmation.",
  "Needs Verification":
    "Few or none of the claims could be matched to a source. A claim marked not checked hasn't been disproved - no source was found to check it against - so this is worth verifying before you rely on it.",
};

/* Same five-tier vocabulary as the citation popover, counted up. */
const TIER_LABELS: Array<[string, string]> = [
  ["verifiable_fact", "backed directly"],
  ["probable_fact", "strongly supported"],
  ["gray_area", "sources neither confirm nor refute"],
  ["distorted", "overstated"],
  ["fabricated", "checked - nothing backs it"],
  ["unsupported", "not checked - no source found"],
  ["opinion", "stated as opinion"],
];

export function ConfidenceBadge({
  band,
  score,
  claims = [],
}: {
  band: string;
  score: number | null;
  /** The scored claims behind the band; drives the breakdown. */
  claims?: Claim[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const style =
    BAND_STYLES[band] ?? "bg-surface-sunken text-ink-secondary border-hairline";
  const dot = BAND_DOTS[band] ?? "bg-ink-muted";

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onEsc);
    };
  }, [open]);

  const counts = new Map<string, number>();
  for (const c of claims) {
    const key = c.entailment_label ?? "gray_area";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const factual = claims.filter((c) => c.entailment_label !== "opinion");
  const backed = factual.filter(
    (c) => c.entailment_label === "verifiable_fact" || c.entailment_label === "probable_fact",
  ).length;

  return (
    <span ref={ref} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${band}${score !== null ? `, ${Math.round(score)} out of 100` : ""}. What this means`}
        title="What this score means"
        className={cx(
          "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] font-medium transition-opacity hover:opacity-80",
          style,
        )}
      >
        <span className={cx("h-1.5 w-1.5 rounded-full", dot)} aria-hidden="true" />
        {band}
        {score !== null && <span className="tabular-nums opacity-70">{Math.round(score)}</span>}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={cx("h-2.5 w-2.5 opacity-70 transition-transform", open && "rotate-180")}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <span
          role="dialog"
          aria-label="What this score means"
          className="absolute right-0 top-full z-30 mt-1.5 block w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-hairline bg-surface-raised p-3 text-left text-[11px] normal-case tracking-normal shadow-lg"
        >
          <span className="block text-xs font-semibold text-ink">
            {band}
            {score !== null && (
              <span className="ml-1.5 font-normal tabular-nums text-ink-muted">
                {Math.round(score)} / 100
              </span>
            )}
          </span>
          <span className="mt-1 block leading-relaxed text-ink-secondary">
            {BAND_MEANING[band] ?? "How well the claims in this answer are grounded in cited sources."}
          </span>
          {claims.length > 0 && (
            <>
              <span className="mt-2 block font-medium text-ink">
                {backed} of {factual.length} factual {factual.length === 1 ? "claim" : "claims"}{" "}
                backed by a source
              </span>
              <span className="mt-1 block space-y-0.5">
                {TIER_LABELS.filter(([tier]) => counts.get(tier)).map(([tier, label]) => (
                  <span key={tier} className="flex justify-between text-ink-muted">
                    <span>{label}</span>
                    <span className="tabular-nums">{counts.get(tier)}</span>
                  </span>
                ))}
              </span>
              <span className="mt-2 block text-ink-muted">
                Open the full answer and tap a numbered marker to see the source behind
                each claim.
              </span>
            </>
          )}
        </span>
      )}
    </span>
  );
}
