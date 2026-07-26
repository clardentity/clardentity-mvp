"use client";

import { useState } from "react";
import type { Claim } from "@/lib/sse";

const ENTAILMENT_LABELS: Record<string, string> = {
  full: "Fully supported",
  partial: "Partially supported",
  none: "Not supported",
  unsupported: "Unsupported",
};

export function EvidencePanel({
  claims,
  band,
  panelId,
}: {
  claims: Claim[];
  band: string | null;
  panelId?: string;
}) {
  const [expanded, setExpanded] = useState(band === "Needs Verification");

  if (claims.length === 0) return null;

  return (
    <div id={panelId} className="mt-2 border-t border-slate-200 pt-2 dark:border-slate-700">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
      >
        Evidence {expanded ? "▲" : "▼"}
      </button>

      {expanded && (
        <div className="mt-2 space-y-3">
          {claims.map((claim) => (
            <div
              key={claim.claim_index}
              className="rounded-lg bg-slate-50 p-2 dark:bg-slate-950/50"
            >
              <p className="text-xs text-slate-700 dark:text-slate-300">{claim.claim_text}</p>

              <div className="mt-1 flex items-center gap-2 text-[10px]">
                <span className="font-medium text-slate-500 dark:text-slate-400">
                  {ENTAILMENT_LABELS[claim.entailment_label ?? ""] ?? claim.entailment_label}
                </span>
                {claim.claim_score !== null && (
                  <span className="text-slate-400">
                    score {Math.round(claim.claim_score)}
                  </span>
                )}
              </div>

              {claim.distortion_flag && (
                <div className="mt-1 rounded bg-amber-50 px-2 py-1 text-[10px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                  ⚠ {claim.distortion_flag.replace("_", " ")}
                  {claim.distortion_explanation ? `: ${claim.distortion_explanation}` : ""}
                </div>
              )}

              {claim.evidence.length === 0 ? (
                <p className="mt-1 text-[10px] italic text-slate-400">
                  No supporting evidence found for this statement.
                </p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {claim.evidence.map((e) => (
                    <li
                      key={e.citation_marker}
                      className="text-[10px] text-slate-500 dark:text-slate-400"
                    >
                      <span className="font-medium text-slate-600 dark:text-slate-300">
                        [{e.citation_marker}] {e.document_filename}
                      </span>
                      {" — support "}
                      {e.support_score !== null ? e.support_score.toFixed(2) : "?"}
                      {" / relevance "}
                      {e.relevance_score !== null ? e.relevance_score.toFixed(2) : "?"}
                      <p className="line-clamp-2 text-slate-400">{e.excerpt}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
