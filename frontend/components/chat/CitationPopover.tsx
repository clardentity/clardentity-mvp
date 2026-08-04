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
        <span className="absolute bottom-full left-1/2 z-20 mb-1.5 w-64 -translate-x-1/2 rounded-lg border border-hairline bg-surface p-2.5 text-left text-[11px] normal-case shadow-lg">
          <span className="block font-medium text-ink">
            {evidence.document_filename}
          </span>
          <span className="mt-1 line-clamp-4 block leading-relaxed text-ink-secondary">
            {evidence.excerpt}
          </span>
          <span className="mt-1.5 block tabular-nums text-ink-muted">
            support {evidence.support_score?.toFixed(2) ?? "?"} · relevance{" "}
            {evidence.relevance_score?.toFixed(2) ?? "?"}
          </span>
        </span>
      )}
    </span>
  );
}
