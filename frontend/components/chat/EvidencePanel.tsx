"use client";

import Link from "next/link";
import { useState } from "react";
import type { Claim } from "@/lib/sse";
import { cx } from "@/components/ui/primitives";

const ENTAILMENT_LABELS: Record<string, string> = {
  full: "Fully supported",
  partial: "Partially supported",
  none: "Not supported",
  unsupported: "Unsupported",
};

const ENTAILMENT_TONES: Record<string, string> = {
  full: "text-band-high",
  partial: "text-band-mid",
  none: "text-band-low",
  unsupported: "text-band-low",
};

/** A detected cognitive bias, named from the taxonomy rather than shown as a
 *  raw flag. The definition travels with the claim from the API so the reader
 *  can tell what the label means without leaving the message. */
function BiasCallout({ claim }: { claim: Claim }) {
  if (!claim.distortion_flag) return null;

  const name = claim.bias_name ?? claim.distortion_flag.replace(/_/g, " ");

  return (
    <div className="mt-2 rounded-lg border border-caution-border bg-caution-bg p-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-caution">
          Possible bias
        </span>
        <Link
          href={`/biases?focus=${encodeURIComponent(claim.distortion_flag)}`}
          className="text-xs font-semibold text-caution underline underline-offset-2 opacity-90 hover:opacity-100"
        >
          {name}
        </Link>
        {claim.bias_category_name && (
          <span className="text-[11px] text-caution opacity-80">
            · {claim.bias_category_name}
          </span>
        )}
      </div>

      {claim.bias_definition && (
        <p className="mt-1 text-[11px] leading-relaxed text-caution opacity-90">
          {claim.bias_definition}
        </p>
      )}
      {claim.distortion_explanation && (
        <p className="mt-1.5 text-xs leading-relaxed text-ink-secondary">
          <span className="font-medium text-ink">In this claim: </span>
          {claim.distortion_explanation}
        </p>
      )}
    </div>
  );
}

export function EvidencePanel({
  claims,
  band,
  panelId,
}: {
  claims: Claim[];
  band: string | null;
  panelId?: string;
}) {
  // Low-confidence answers open expanded: that is exactly when the reader
  // most needs to see what the score was based on.
  const [expanded, setExpanded] = useState(band === "Needs Verification");

  if (claims.length === 0) return null;

  const flagged = claims.filter((c) => c.distortion_flag).length;

  return (
    <div id={panelId} className="mt-3 border-t border-hairline pt-2.5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted transition-colors hover:text-ink-secondary"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={cx("h-3 w-3 transition-transform", expanded && "rotate-90")}
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
        Evidence
        <span className="font-normal normal-case tracking-normal text-ink-muted">
          {claims.length} claim{claims.length === 1 ? "" : "s"}
          {flagged > 0 && ` · ${flagged} flagged`}
        </span>
      </button>

      {expanded && (
        <div className="mt-2.5 space-y-2.5">
          {claims.map((claim) => (
            <article
              key={claim.claim_index}
              className="rounded-lg border border-hairline bg-surface-muted p-3"
            >
              <p className="text-xs leading-relaxed text-ink">{claim.claim_text}</p>

              <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px]">
                <span
                  className={cx(
                    "font-medium",
                    ENTAILMENT_TONES[claim.entailment_label ?? ""] ?? "text-ink-muted",
                  )}
                >
                  {ENTAILMENT_LABELS[claim.entailment_label ?? ""] ??
                    claim.entailment_label ??
                    "Unrated"}
                </span>
                {claim.claim_score !== null && (
                  <span className="tabular-nums text-ink-muted">
                    score {Math.round(claim.claim_score)}
                  </span>
                )}
              </div>

              <BiasCallout claim={claim} />

              {claim.evidence.length === 0 ? (
                <p className="mt-2 text-[11px] italic text-ink-muted">
                  No supporting evidence found for this statement.
                </p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {claim.evidence.map((e) => (
                    <li
                      key={e.citation_marker}
                      className="rounded-md border border-hairline bg-surface p-2"
                    >
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="text-[11px] font-medium text-ink">
                          [{e.citation_marker}] {e.document_filename}
                        </span>
                        <span className="tabular-nums text-[11px] text-ink-muted">
                          support {e.support_score?.toFixed(2) ?? "?"} · relevance{" "}
                          {e.relevance_score?.toFixed(2) ?? "?"}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-ink-muted">
                        {e.excerpt}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
