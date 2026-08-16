"use client";

import type { Claim, Evidence } from "@/lib/sse";
import { cx } from "@/components/ui/primitives";
import { cleanMessageText } from "@/lib/text";

/* Veracity tiers, from the claim's numeric score:
     0-20 fabricated · 21-40 distorted · 41-80 gray_area
     81-99 probable_fact · 100 verifiable_fact
   The label and the number next to it come from the same place, so a claim
   can't read "Verifiable Fact" beside a score of 41. The older labels
   (full/moderate/partial/none/unsupported) are kept so claims scored before
   the tier system shipped still render something.

   The tier names come from the client's scoring framework and are kept as it
   words them, minus internal parentheticals like "(Gray Area)" that name the
   slab rather than describe the claim. Renaming them properly would change
   what the score says, not just how it reads - so instead each tier carries a
   plain-language line underneath, which is what stops "Fabricated /
   Malicious" landing as an accusation against a claim that is merely
   uncited. */
const TIERS: Record<string, { label: string; meaning: string; text: string; rail: string }> = {
  verifiable_fact: {
    label: "Verifiable Fact",
    meaning: "Directly confirmed by the sources cited here.",
    text: "text-band-high",
    rail: "border-band-high-border",
  },
  probable_fact: {
    label: "Probable Fact",
    meaning: "Strongly supported, though short of direct confirmation.",
    text: "text-band-moderate",
    rail: "border-band-high-border",
  },
  gray_area: {
    label: "Unverifiable",
    meaning: "Plausible, but these sources neither confirm nor refute it.",
    text: "text-band-mid",
    rail: "border-band-mid-border",
  },
  distorted: {
    label: "Distorted",
    meaning: "Rests on something real, but the framing overstates it.",
    text: "text-caution",
    rail: "border-caution-border",
  },
  fabricated: {
    // The framework's own name for the 0-20 slab. Left verbatim rather than
    // softened to "Unsupported": it is the client's taxonomy, and quietly
    // renaming the harshest tier is a change to what the score *says*, not
    // to how it is worded. The meaning line below is what stops it reading
    // as an accusation against a claim that is merely uncited.
    label: "Fabricated / Malicious",
    meaning: "Nothing found here backs this up. Worth checking yourself.",
    text: "text-band-low",
    rail: "border-band-low-border",
  },
  // Pre-framework rows.
  full: { label: "Fully supported", meaning: "", text: "text-band-high", rail: "border-band-high-border" },
  moderate: { label: "Moderately supported", meaning: "", text: "text-band-moderate", rail: "border-band-high-border" },
  partial: { label: "Partially supported", meaning: "", text: "text-band-mid", rail: "border-band-mid-border" },
  none: { label: "Unsupported", meaning: "", text: "text-band-low", rail: "border-band-low-border" },
  unsupported: { label: "Unsupported", meaning: "", text: "text-band-low", rail: "border-band-low-border" },
};

const FALLBACK_TIER = {
  label: "Unrated",
  meaning: "",
  text: "text-ink-muted",
  rail: "border-hairline",
};

function tierOf(label: string | null) {
  return TIERS[label ?? ""] ?? FALLBACK_TIER;
}

/* The panel used to print "support 0.72 · relevance 0.55 · credibility 0.81"
   and leave the reader to work out what any of it meant, or what it added up
   to. Each number becomes the sentence it stands for; the figure itself stays
   available in the tooltip for anyone who wants it. */
function supportPhrase(e: Evidence): string {
  if (e.entailment_label === "full") return "Backs this directly";
  if (e.entailment_label === "partial") return "Partly backs this";
  if (e.entailment_label === "none") return "Doesn't back this";
  return "Bearing unclear";
}

/* The support score, in its band's colour. Same four steps the claim tiers
   use, so a 0.9 here and a 90 up on the claim read as the same kind of good.
   Shown as a figure and not only as a phrase: the number is the thing the
   scoring pipeline actually produced, and hiding it in a tooltip meant the
   panel asserted a judgement while keeping its own working out of sight. */
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

/** Mirrors compute_claim_score on the server: the score comes from whichever
 *  single source backs the claim best, not from all of them averaged. Saying
 *  which one turns the number from a verdict into something checkable. */
function strongest(evidence: Evidence[]): Evidence | null {
  if (evidence.length === 0) return null;
  const weight = (e: Evidence) => 0.7 * (e.support_score ?? 0) + 0.3 * (e.relevance_score ?? 0);
  return evidence.reduce((best, e) => (weight(e) > weight(best) ? e : best));
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

function EvidenceRow({ e }: { e: Evidence }) {
  const isWeb = e.source_type === "web" && e.url;
  const secondary = isWeb ? e.credibility_score : e.relevance_score;
  const facts = [
    supportPhrase(e),
    isWeb ? credibilityPhrase(e.credibility_score) : relevancePhrase(e.relevance_score),
  ].filter(Boolean);

  return (
    <li className="space-y-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="shrink-0 rounded bg-surface-hover px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-ink-secondary">
          {e.citation_marker}
        </span>
        {isWeb ? (
          // A link, because a web citation you can't open is not a citation -
          // it's a claim about a citation.
          <a
            href={e.url!}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
          >
            {e.document_filename}
            <ExternalLinkIcon />
          </a>
        ) : (
          <span className="text-xs font-medium text-ink">{e.document_filename}</span>
        )}
        {isWeb && <span className="text-[11px] text-ink-muted">{hostOf(e.url!)}</span>}
      </div>

      {/* The sentence the verifier actually judged on, not wherever the
          retrieved chunk happened to begin. */}
      {e.excerpt && (
        <blockquote className="border-l-2 border-hairline pl-2 text-xs leading-relaxed text-ink-secondary sm:pl-2.5">
          {e.excerpt}
        </blockquote>
      )}

      <p className="flex flex-wrap items-baseline gap-x-1.5 text-[11px] text-ink-muted">
        <span className={cx("font-semibold tabular-nums", supportTone(e.support_score))}>
          {e.support_score !== null ? e.support_score.toFixed(2) : "?"}
        </span>
        <span>{facts.join(" · ")}</span>
        {/* Only shown when it was actually measured. A bare "credibility ?"
            advertised a gap in our own pipeline as if it were a property of
            the source - web results found before the answer exists have not
            been judged yet, because there was nothing to judge them against.
            The claim score no longer counts that gap as a zero either. */}
        {secondary !== null && (
          <span className="tabular-nums">
            ({isWeb ? "credibility" : "relevance"} {secondary.toFixed(2)})
          </span>
        )}
      </p>

      {e.credibility_note && (
        <p className="text-[11px] italic leading-relaxed text-ink-muted">{e.credibility_note}</p>
      )}
    </li>
  );
}

function ClaimBlock({ claim }: { claim: Claim }) {
  const tier = tierOf(claim.entailment_label);
  const best = strongest(claim.evidence);
  const count = claim.evidence.length;

  return (
    // Rail indent halves on a phone. Three nested levels each with their own
    // padding left the quote running in ~240px of a 375px screen; this buys
    // back the difference where it is scarcest.
    <article className={cx("border-l-2 pl-2 sm:pl-3", tier.rail)}>
      <p className="text-[13px] leading-relaxed text-ink">{cleanMessageText(claim.claim_text)}</p>

      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className={cx("text-xs font-semibold", tier.text)}>{tier.label}</span>
        {claim.claim_score !== null && (
          <span className="text-xs tabular-nums text-ink-muted">
            {Math.round(claim.claim_score)}/100
          </span>
        )}
      </div>

      {tier.meaning && (
        <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{tier.meaning}</p>
      )}

      {/* Where the number came from. The server scores a claim off its single
          best source rather than an average, so naming that source is the
          difference between a verdict and a thing you can go and check. */}
      <p className="mt-1 text-[11px] leading-relaxed text-ink-muted">
        {best === null
          ? "Nothing was found to check this against."
          : count === 1
            ? `Scored on source ${best.citation_marker}.`
            : `Scored on source ${best.citation_marker}, the strongest of ${count} checked.`}
        {/* The bias itself is no longer named to the reader - a taxonomy label
            like "Anchoring Bias" is our vocabulary, not theirs. The cap it
            causes still has to be accounted for, or the tier silently
            contradicts the evidence above it. */}
        {claim.distortion_flag && " Capped: the wording claims more than the sources carry."}
      </p>

      {claim.reconciliation_note && (
        // A second, independent pass looked at this claim again without
        // seeing the first verdict.
        <p className="mt-1.5 text-[11px] leading-relaxed text-ink-muted">
          <span className="font-medium text-ink-secondary">Second look: </span>
          {claim.reconciliation_note}
          {claim.dynamic && (
            <span className="italic"> May be reassessed as more information emerges.</span>
          )}
        </p>
      )}

      {count > 0 && (
        <ul className="mt-2.5 space-y-2.5">
          {claim.evidence.map((e) => (
            <EvidenceRow key={e.citation_marker} e={e} />
          ))}
        </ul>
      )}
    </article>
  );
}

export function EvidencePanel({
  claims,
  band,
  panelId,
  expanded,
  onToggle,
}: {
  claims: Claim[];
  band: string | null;
  panelId?: string;
  /** Owned by the message so the confidence badge can open this panel; it is
   *  the natural thing to click when you want to know why a score is low. */
  expanded: boolean;
  onToggle: () => void;
}) {
  if (claims.length === 0) return null;

  const needsVerification = band === "Needs Verification";

  return (
    <div id={panelId} className="mt-2.5">
      {/* One quiet line, the whole width clickable. Collapsed it reads as a
          footnote; it still says how many claims there are, so the size of
          what is behind the click is never a surprise. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="group -mx-1 flex w-[calc(100%+0.5rem)] items-center gap-1.5 rounded-md px-1 py-1 text-left text-xs text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink-secondary"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={cx("h-3 w-3 shrink-0 transition-transform", expanded && "rotate-90")}
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
        {/* Wraps rather than truncates. At 320px this row is about ten pixels
            short of fitting alongside "worth checking", and `truncate` spent
            those pixels on the claim count - "Evidence 10 cla..." - which is
            the one part of the line the comment above says has to survive. */}
        <span className="min-w-0">
          {expanded ? "Hide evidence" : "Evidence"}
          <span className="ml-1.5 text-ink-muted">
            {claims.length} claim{claims.length === 1 ? "" : "s"}
          </span>
        </span>
        {/* A weak answer shouldn't need the panel opened to be recognised as
            one, so the reason to look is stated on the closed row. */}
        {!expanded && needsVerification && (
          <span className="ml-auto shrink-0 text-[11px] font-medium text-band-low">
            worth checking
          </span>
        )}
      </button>

      {expanded && (
        <div className="mt-3 space-y-4 border-t border-hairline pt-3">
          <p className="text-[11px] leading-relaxed text-ink-muted">
            Each statement in the answer is checked separately against the sources
            it cites, then scored on how well the best of them backs it up.
          </p>
          {claims.map((claim) => (
            <ClaimBlock key={claim.claim_index} claim={claim} />
          ))}
        </div>
      )}
    </div>
  );
}
