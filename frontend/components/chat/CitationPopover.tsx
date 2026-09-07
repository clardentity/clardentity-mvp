"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Evidence } from "@/lib/sse";
import { cx } from "@/components/ui/primitives";

/* Wording ported from the deleted EvidencePanel so a score reads the same
   way wherever it appears - the citation popover is now the only place any
   of this shows, but readers who saw the evidence panel before shouldn't
   find the same number described differently here. */

/** Every score is a percentage of factual evidence, worded the same way
 *  wherever it appears. "only" is the qualifier that carries the meaning: a
 *  claim at 0 has no factual evidence and one at 100 has it outright, but
 *  anything in between rests on *only* that much - which is the part a
 *  reader skimming a number tends to miss. So 0 and 100 read plainly and
 *  1-99 are qualified. */
function factualEvidence(fraction: number): string {
  const pct = Math.round(fraction * 100);
  const qualified = pct > 0 && pct < 100 ? " only" : "";
  return `${pct}% Factual Evidence${qualified}`;
}

/* The claim-level verdict, same five-tier vocabulary and wording the deleted
   EvidencePanel used - a claim can cite several sources, so this belongs to
   the claim the marker's evidence sits inside, not to that one source. The
   two harshest tiers are stated as appearances, not findings, for the same
   reason EvidencePanel's did: a score is evidence about how a claim reads
   against the sources at hand, not an accusation about the author's intent. */
const TIERS: Record<string, { label: string; meaning: string; text: string }> = {
  verifiable_fact: {
    label: "Verifiable Fact",
    meaning: "Directly confirmed by the sources cited here.",
    text: "text-band-high",
  },
  probable_fact: {
    label: "Probable Fact",
    meaning: "Strongly supported, though short of direct confirmation.",
    text: "text-band-moderate",
  },
  gray_area: {
    label: "Unverifiable",
    meaning: "Plausible, but these sources neither confirm nor refute it.",
    text: "text-band-mid",
  },
  distorted: {
    label: "Appears as distorted",
    meaning: "Rests on something real, but the framing overstates it.",
    text: "text-caution",
  },
  fabricated: {
    label: "Appears as fabricated / malicious",
    meaning: "Nothing found here backs this up. Worth checking yourself.",
    text: "text-band-low",
  },
  // Zero evidence is correct and expected here - it was never claimed to be
  // sourced - so this reads as neutral disclosure, not a failed check, and
  // deliberately does not share fabricated's alarm styling.
  opinion: {
    label: "Stated as an opinion",
    meaning: "Clardentity AI's own view, not a sourced fact.",
    text: "text-ink-secondary",
  },
};

function supportPhrase(e: Evidence): string {
  if (e.entailment_label === "full") return "Backs this directly";
  if (e.entailment_label === "partial") return "Partly backs this";
  if (e.entailment_label === "none") return "Doesn't back this";
  return "Bearing unclear";
}

const SUPPORT_BANDS: [number, string][] = [
  [0.76, "text-band-high"],
  [0.51, "text-band-moderate"],
  [0.26, "text-band-mid"],
  [0, "text-band-low"],
];
function supportTone(score: number | null): string {
  if (score === null) return "text-ink-muted";
  return SUPPORT_BANDS.find(([min]) => score >= min)?.[1] ?? "text-band-low";
}

function relevancePhrase(score: number | null): string | null {
  if (score === null) return null;
  if (score >= 0.75) return "closely on topic";
  if (score >= 0.5) return "related";
  return "loosely related";
}

function credibilityPhrase(score: number | null): string | null {
  if (score === null) return null;
  if (score >= 0.8) return "source looks reliable";
  if (score >= 0.6) return "source looks reasonable";
  return "source is questionable";
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function ExternalLinkIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="h-2.5 w-2.5 shrink-0"
    >
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6M10 14 21 3" />
    </svg>
  );
}

export function CitationPopover({
  marker,
  evidence,
  claimScore,
  entailmentLabel,
}: {
  marker: number;
  evidence: Evidence | null;
  /** The owning claim's overall score (0-100) and tier - a verdict on the
   *  claim as a whole, shown alongside this one source's own detail. */
  claimScore?: number | null;
  entailmentLabel?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  /* Measured, not guessed - and portaled to <body>, not just measured.
     Three attempts got this wrong before landing here:
       1. Static Tailwind classes bounding it against the message bubble via
          `absolute`, then against the marker's own wrapper - both broke,
          because which element a CSS position value resolves against
          depends on positioning scheme and ancestor styles in ways that are
          easy to get backwards, and getting it backwards either clips an
          edge or collapses the box to a sliver.
       2. `position: fixed` with top/left computed against
          `window.innerWidth/innerHeight`, on the reasoning that `fixed`
          means viewport-relative. It doesn't, not here: this component
          renders inside ResponseFlip, which sets `perspective` on an
          ancestor for its 3D flip-card effect, and `perspective` (like
          `transform`/`filter`) makes that ancestor the containing block for
          `position: fixed` descendants too, not just `absolute` ones. The
          math was computing viewport coordinates and applying them in the
          flip card's own coordinate space, landing dozens of pixels off in
          both axes - consistently, not at the edges, which is what made it
          look like a clamping bug rather than a wrong-coordinate-space one.
     Rendering through a portal to `document.body` sidesteps the whole
     category: the popover is no longer a descendant of anything that could
     redefine its containing block, so `fixed` + viewport measurements
     finally mean what they say. */
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const btn = buttonRef.current;
    const pop = popoverRef.current;
    if (!btn || !pop) return;
    const margin = 8;
    const btnRect = btn.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();

    let left = btnRect.left;
    left = Math.min(left, window.innerWidth - popRect.width - margin);
    left = Math.max(left, margin);

    // Prefer above the marker; flip below only if there's no room above,
    // rather than letting it run off the top of the screen.
    let top = btnRect.top - popRect.height - margin;
    if (top < margin) top = btnRect.bottom + margin;
    top = Math.min(top, window.innerHeight - popRect.height - margin);
    top = Math.max(top, margin);

    setPos({ top, left });
  }, [open]);

  if (!evidence) {
    return <sup className="mx-0.5 text-ink-muted">[{marker}]</sup>;
  }

  const tier = entailmentLabel ? TIERS[entailmentLabel] : undefined;
  const isWeb = evidence.source_type === "web" && Boolean(evidence.url);
  const secondary = isWeb ? evidence.credibility_score : evidence.relevance_score;
  const facts = [
    supportPhrase(evidence),
    isWeb ? credibilityPhrase(evidence.credibility_score) : relevancePhrase(evidence.relevance_score),
  ].filter((f): f is string => Boolean(f));

  return (
    <span className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        aria-expanded={open}
        title={`Source: ${evidence.document_filename}`}
        className="mx-0.5 rounded border border-brand-border bg-brand-soft px-1 align-super text-[10px] font-semibold text-brand transition-colors hover:bg-brand hover:text-white"
      >
        {marker}
      </button>
      {open &&
        createPortal(
          // `span`, not `div`/`blockquote`/`p`: harmless now that this is
          // portaled out to <body> rather than nested in the answer's own
          // <p>, but left as-is since it already works and there's no
          // reason to touch it again. `block`/`flex` utility classes get
          // the same visual layout a div/p would.
          <span
            ref={popoverRef}
            // Rendered at a fixed, viewport-relative position computed
            // above. Off-screen and hidden until `pos` is known, so
            // there's no flash at the wrong spot. Portaling to <body> is
            // load-bearing, not tidiness - see the effect above for why
            // `position: fixed` doesn't mean "viewport-relative" for a
            // descendant of ResponseFlip's perspective ancestor.
            style={
              pos
                ? { position: "fixed", top: pos.top, left: pos.left, visibility: "visible" }
                : { position: "fixed", top: -9999, left: -9999, visibility: "hidden" }
            }
            className="z-30 block w-64 max-w-[calc(100vw-1rem)] rounded-lg border border-hairline bg-surface-raised p-2.5 text-left text-[11px] normal-case shadow-lg"
          >
            {isWeb ? (
              <a
                href={evidence.url!}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex items-center gap-1 font-medium text-brand hover:underline"
              >
                {evidence.document_filename}
                <ExternalLinkIcon />
              </a>
            ) : (
              <span className="block font-medium text-ink">{evidence.document_filename}</span>
            )}
            {isWeb && <span className="ml-1.5 text-ink-muted">{hostOf(evidence.url!)}</span>}

            {tier && (
              <span className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5">
                <span className={cx("font-semibold", tier.text)}>{tier.label}</span>
                {claimScore !== null &&
                  claimScore !== undefined &&
                  entailmentLabel !== "opinion" && (
                    <span className="tabular-nums text-ink-muted">
                      {factualEvidence(claimScore / 100)}
                    </span>
                  )}
                <span className="block basis-full text-ink-muted">{tier.meaning}</span>
              </span>
            )}

            {evidence.excerpt && (
              <span className="mt-1.5 line-clamp-4 block border-l-2 border-hairline pl-2 leading-relaxed text-ink-secondary">
                {evidence.excerpt}
              </span>
            )}

            <span className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 text-ink-muted">
              <span className={cx("font-semibold tabular-nums", supportTone(evidence.support_score))}>
                {evidence.support_score !== null
                  ? `${factualEvidence(evidence.support_score)} to support this`
                  : "Not yet measured"}
              </span>
              {facts.length > 0 && <span>{facts.join(" · ")}</span>}
              {/* Only shown when it was actually measured - a bare "credibility
                  ?" advertised a gap in the pipeline as if it were a property
                  of the source. */}
              {secondary !== null && (
                <span className="tabular-nums">
                  ({isWeb ? "credibility" : "relevance"} {Math.round(secondary * 100)}%)
                </span>
              )}
            </span>

            {evidence.credibility_note && (
              <span className="mt-1 block italic leading-relaxed text-ink-muted">
                {evidence.credibility_note}
              </span>
            )}
          </span>,
          document.body,
        )}
    </span>
  );
}
