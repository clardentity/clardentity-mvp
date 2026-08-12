"use client";

import type { Claim } from "@/lib/sse";
import { cx } from "@/components/ui/primitives";
import { cleanMessageText } from "@/lib/text";

/* Veracity tiers, from the claim's numeric score:
     0-20 fabricated · 21-40 distorted · 41-80 gray_area
     81-99 probable_fact · 100 verifiable_fact
   The label and the number next to it now come from the same place, so a
   claim can't read "Verifiable Fact" beside a score of 41. The four older
   labels (full/moderate/partial/none/unsupported) are kept so claims scored
   before this tier system shipped still render something. */
const ENTAILMENT_LABELS: Record<string, string> = {
  verifiable_fact: "Verifiable Fact",
  probable_fact: "Probable Fact",
  gray_area: "Unverifiable (Gray Area)",
  distorted: "Distorted / Misinformed",
  fabricated: "Fabricated / Malicious",
  full: "Fully supported",
  moderate: "Moderately supported",
  partial: "Partially supported",
  none: "Unsupported",
  unsupported: "Unsupported",
};

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

const ENTAILMENT_TONES: Record<string, string> = {
  verifiable_fact: "text-band-high",
  probable_fact: "text-band-moderate",
  gray_area: "text-band-mid",
  distorted: "text-caution",
  fabricated: "text-band-low",
  full: "text-band-high",
  moderate: "text-band-moderate",
  partial: "text-band-mid",
  none: "text-band-low",
  unsupported: "text-band-low",
};

/** A detected cognitive bias, named from the taxonomy rather than shown as a
 *  raw flag. The definition travels with the claim from the API so the reader
 *  can tell what the label means without leaving the message - which is the
 *  whole reason there is no longer a browsable library to link out to. */
function BiasCallout({ claim }: { claim: Claim }) {
  if (!claim.distortion_flag) return null;

  const name = claim.bias_name ?? claim.distortion_flag.replace(/_/g, " ");

  return (
    <div className="mt-2 rounded-lg border border-caution-border bg-caution-bg p-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-caution">
          Possible bias
        </span>
        <span className="text-xs font-semibold text-caution opacity-90">{name}</span>
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

  const flagged = claims.filter((c) => c.distortion_flag).length;
  const needsVerification = band === "Needs Verification";

  return (
    <div id={panelId} className="mt-2.5">
      {/* One quiet line, the whole width clickable. Collapsed it reads as a
          footnote; the summary still says how many claims there are and
          whether any were flagged, so nothing that would change your mind
          about trusting the answer is hidden behind the click. */}
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
        <span className="truncate">
          {expanded ? "Hide evidence" : "Evidence"}
          <span className="ml-1.5 text-ink-muted">
            {claims.length} claim{claims.length === 1 ? "" : "s"}
            {flagged > 0 && ` · ${flagged} flagged`}
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
        <div className="mt-2.5 space-y-2.5 border-t border-hairline pt-2.5">
          {claims.map((claim) => (
            <article
              key={claim.claim_index}
              className="rounded-lg border border-hairline bg-surface-muted p-3"
            >
              <p className="text-xs leading-relaxed text-ink">{cleanMessageText(claim.claim_text)}</p>

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
                    {Math.round(claim.claim_score)}/100
                  </span>
                )}
              </div>

              {claim.reconciliation_note && (
                // A second, independent pass looked at this claim again
                // without seeing the first verdict - shown as a footnote
                // rather than folded into the tier label, since it's
                // context for the reader, not a different score.
                <p className="mt-1.5 text-[11px] leading-relaxed text-ink-muted">
                  <span className="font-medium text-ink-secondary">Second look: </span>
                  {claim.reconciliation_note}
                  {claim.dynamic && (
                    <span className="ml-1 italic">
                      May be reassessed as more information becomes available.
                    </span>
                  )}
                </p>
              )}

              <BiasCallout claim={claim} />

              {claim.evidence.length === 0 ? (
                <p className="mt-2 text-[11px] italic text-ink-muted">
                  No supporting evidence found for this statement.
                </p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {claim.evidence.map((e) => {
                    const isWeb = e.source_type === "web" && e.url;
                    return (
                      <li
                        key={e.citation_marker}
                        className="rounded-md border border-hairline bg-surface p-2"
                      >
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          {isWeb ? (
                            // A link, because a web citation you can't open is
                            // not a citation - it's a claim about a citation.
                            <a
                              href={e.url!}
                              target="_blank"
                              rel="noopener noreferrer nofollow"
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-brand hover:underline"
                            >
                              [{e.citation_marker}] {e.document_filename}
                              <ExternalLinkIcon />
                            </a>
                          ) : (
                            <span className="text-[11px] font-medium text-ink">
                              [{e.citation_marker}] {e.document_filename}
                            </span>
                          )}
                          <span className="tabular-nums text-[11px] text-ink-muted">
                            support {e.support_score?.toFixed(2) ?? "?"}
                            {isWeb ? " · credibility " : " · relevance "}
                            {(isWeb ? e.credibility_score : e.relevance_score)?.toFixed(2) ??
                              "?"}
                          </span>
                        </div>
                        {isWeb && (
                          <p className="mt-0.5 truncate text-[10px] text-ink-muted">
                            {hostOf(e.url!)}
                          </p>
                        )}
                        <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-ink-muted">
                          {e.excerpt}
                        </p>
                        {e.credibility_note && (
                          // Why the supervisor scored it that way. A number on
                          // its own is just another thing to take on trust.
                          <p className="mt-1 text-[10px] italic leading-relaxed text-ink-muted">
                            {e.credibility_note}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
