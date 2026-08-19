"use client";

import { useState } from "react";
import type { Evidence } from "@/lib/sse";

export function CitationPopover({
  marker,
  evidence,
}: {
  marker: number;
  evidence: Evidence | null;
}) {
  const [open, setOpen] = useState(false);

  if (!evidence) {
    return <sup className="mx-0.5 text-ink-muted">[{marker}]</sup>;
  }

  const isWeb = evidence.source_type === "web";
  const secondary = isWeb ? evidence.credibility_score : evidence.relevance_score;

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        aria-expanded={open}
        title={`Source: ${evidence.document_filename}`}
        className="mx-0.5 rounded border border-brand-border bg-brand-soft px-1 align-super text-[10px] font-semibold text-brand transition-colors hover:bg-brand hover:text-white"
      >
        {marker}
      </button>
      {open && (
        /* Anchored to the marker on a pointer device; clamped on a phone.
           
           A 16rem card centred on an inline marker hangs half off screen
           whenever that marker sits near an edge, which on a 375px screen is
           most of them - and max-width cannot fix that, because the overflow
           comes from the position rather than the size.
           
           `fixed` here resolves against the message bubble, not the viewport:
           ResponseFlip sets `perspective` on an ancestor, and any of
           transform/filter/perspective makes that element the containing
           block for fixed children. That is the behaviour we want - the card
           is bounded by the bubble, which is always on screen - but it is
           inherited rather than declared, so it is worth naming here before
           someone removes the flip card and wonders why citations started
           escaping. */
        <span className="fixed inset-x-4 bottom-28 z-30 rounded-lg border border-hairline bg-surface-raised p-2.5 text-left text-[11px] normal-case shadow-lg sm:absolute sm:inset-x-auto sm:bottom-full sm:left-1/2 sm:z-20 sm:mb-1.5 sm:w-64 sm:-translate-x-1/2">
          <span className="block font-medium text-ink">
            {evidence.document_filename}
          </span>
          <span className="mt-1 line-clamp-4 block leading-relaxed text-ink-secondary">
            {evidence.excerpt}
          </span>
          {/* Same rule as the evidence panel: a figure we never measured is
              not printed as "?". Web sources found before the answer exists
              carry no credibility judgement, and advertising that gap as a
              property of the source is what "relevance ?" was doing. */}
          <span className="mt-1.5 block tabular-nums text-ink-muted">
            support {evidence.support_score?.toFixed(2) ?? "?"}
            {secondary !== null && (
              <>
                {" · "}
                {isWeb ? "credibility" : "relevance"} {secondary.toFixed(2)}
              </>
            )}
          </span>
        </span>
      )}
    </span>
  );
}
