"use client";

import type { Claim } from "@/lib/sse";

/* The sources an answer rests on, gathered at its foot as cards - one per
 * document or page, however many claims cite it - so what the inline
 * markers point at can be seen in one place without opening each popover.
 * Web sources open in a new tab; documents are the user's own uploads and
 * are named. Nothing here is a verdict: the per-claim scores stay on the
 * markers, where they belong to a specific sentence. */

type Source = {
  key: string;
  title: string;
  url: string | null;
  host: string | null;
  kind: "document" | "web";
  cites: number;
};

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function collectSources(claims: Claim[]): Source[] {
  const byKey = new Map<string, Source>();
  for (const claim of claims) {
    // One count per claim per source, however many excerpts of it were used.
    const seenInClaim = new Set<string>();
    for (const e of claim.evidence) {
      const key = e.url ?? e.document_id ?? e.document_filename;
      if (!key || seenInClaim.has(key)) continue;
      seenInClaim.add(key);
      const existing = byKey.get(key);
      if (existing) {
        existing.cites += 1;
        continue;
      }
      byKey.set(key, {
        key,
        title: e.document_filename || e.url || "Source",
        url: e.source_type === "web" ? e.url : null,
        host: e.url ? hostOf(e.url) : null,
        kind: e.source_type,
        cites: 1,
      });
    }
  }
  return [...byKey.values()];
}

function DocIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-3.5 w-3.5 shrink-0">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="h-3.5 w-3.5 shrink-0">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  );
}

export function SourcesFooter({ claims }: { claims: Claim[] }) {
  const sources = collectSources(claims);
  if (sources.length === 0) return null;
  return (
    <div className="mt-3 border-t border-hairline pt-2.5">
      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        Sources
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {sources.map((s) => {
          const inner = (
            <>
              <span className={s.kind === "web" ? "text-brand" : "text-ink-muted"}>
                {s.kind === "web" ? <GlobeIcon /> : <DocIcon />}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-ink">{s.title}</span>
                <span className="block truncate text-[10px] text-ink-muted">
                  {s.host ?? "Your attachment"}
                  {" · "}
                  {s.cites === 1 ? "1 claim" : `${s.cites} claims`}
                </span>
              </span>
            </>
          );
          const cls =
            "flex max-w-full items-center gap-2 rounded-lg border border-hairline bg-surface-muted px-2.5 py-1.5 text-left sm:max-w-[16rem]";
          return (
            <li key={s.key} className="min-w-0 max-w-full">
              {s.url ? (
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className={`${cls} transition-colors hover:border-brand-border hover:bg-brand-soft`}
                >
                  {inner}
                </a>
              ) : (
                <div className={cls}>{inner}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
