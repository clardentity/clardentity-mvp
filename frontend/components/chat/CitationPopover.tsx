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
    return <sup className="mx-0.5 text-slate-400">[{marker}]</sup>;
  }

  return (
    <span className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="mx-0.5 rounded bg-brand/10 px-1 align-super text-[10px] font-semibold text-brand hover:bg-brand/20"
      >
        {marker}
      </button>
      {open && (
        <span className="absolute bottom-full left-1/2 z-20 mb-1 w-56 -translate-x-1/2 rounded-lg border border-slate-200 bg-white p-2 text-left text-[11px] normal-case text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200">
          <span className="block font-medium">{evidence.document_filename}</span>
          <span className="mt-1 line-clamp-3 block text-slate-500 dark:text-slate-400">
            {evidence.excerpt}
          </span>
          <span className="mt-1 block text-slate-400">
            support {evidence.support_score?.toFixed(2) ?? "?"} · relevance{" "}
            {evidence.relevance_score?.toFixed(2) ?? "?"}
          </span>
        </span>
      )}
    </span>
  );
}
