import math
import uuid
from dataclasses import dataclass

from app.services.retrieval import RetrievedChunk
from app.services.verification_agent import EvidenceVerification


@dataclass
class ScoringWeights:
    """§9.3 weights and band cutoffs, overridable via /admin (§11.8/FR14).
    These field defaults match admin_settings_service.DEFAULTS exactly.
    """

    claim_score_weight: float = 0.6
    citation_coverage_weight: float = 0.25
    relevance_weight: float = 0.15
    distortion_penalty: float = 15
    likely_fact_cutoff: float = 90
    plausible_cutoff: float = 70

    @classmethod
    def from_settings(cls, raw: dict | None) -> "ScoringWeights":
        if not raw:
            return cls()
        defaults = cls()
        return cls(**{**defaults.__dict__, **raw})


@dataclass
class ScoredEvidence:
    citation_marker: int
    # None for a web source: there is no uploaded document behind it. The
    # filename field carries the page title in that case, so the display path
    # needs no branch, and `url` is what tells the two apart.
    document_id: uuid.UUID | None
    document_filename: str
    excerpt: str
    support_score: float
    # None when genuinely unmeasured, which is not the same as zero. Web
    # sources gathered before generation have no credibility judgement yet -
    # the supervisor only runs per claim, after there is something to check -
    # and coercing that unknown to 0.0 silently capped every claim it
    # supported at 70/100, "Unverifiable", however perfectly it was backed.
    relevance_score: float | None
    entailment_label: str
    source_type: str = "document"
    url: str | None = None
    credibility_score: float | None = None
    credibility_note: str | None = None


@dataclass
class ScoredClaim:
    claim_index: int
    claim_text: str
    claim_score: float
    entailment_label: str  # veracity tier - see VERACITY_TIERS below
    distortion_flag: str | None
    distortion_explanation: str | None
    evidence: list[ScoredEvidence]
    bias_category: str | None = None
    # Set only when a second-level blind reconciliation pass ran (gray_area
    # claims only - see verification_agent.reconcile_gray_area).
    reconciliation_note: str | None = None
    dynamic: bool = False


@dataclass
class MessageScore:
    score: float
    band: str
    distortion_penalty_applied: bool


def build_scored_evidence(
    markers: list[int],
    chunks: list[RetrievedChunk],
    verifications: list[EvidenceVerification],
    web_sources: list | None = None,
) -> list[ScoredEvidence]:
    """`markers` are the 1-indexed CONTEXT positions a claim cited. Markers
    1..len(chunks) index into `chunks`; anything above that continues into
    `web_sources`, matching how build_context_block numbered them.

    `verifications` are the Verification Agent's per-evidence results in the
    same order as `markers`.
    """
    web_sources = web_sources or []
    result = []
    for marker, verification in zip(markers, verifications):
        if not (0 < marker <= len(chunks) + len(web_sources)):
            continue

        def excerpt_for(full_text: str) -> str:
            """The sentence the verifier judged on, when it gave one.

            The fallback is the old behaviour - the first 300 characters of
            the source - which is a reasonable thing to show and a poor thing
            to call evidence, since where a chunk starts has nothing to do
            with the claim being checked.
            """
            return verification.quote or full_text[:300]

        if marker > len(chunks):
            source = web_sources[marker - len(chunks) - 1]
            result.append(
                ScoredEvidence(
                    citation_marker=marker,
                    document_id=None,
                    document_filename=source.title,
                    excerpt=excerpt_for(source.excerpt),
                    support_score=verification.support_score,
                    # A web source has no embedding-similarity score to report,
                    # so its relevance is the supervisor's credibility judgement
                    # - the number that actually governs whether it should have
                    # been cited at all.
                    # Not `or 0.0`: an unjudged source is unjudged.
                    relevance_score=source.credibility_score,
                    entailment_label=verification.entailment_label,
                    source_type="web",
                    url=source.url,
                    credibility_score=source.credibility_score,
                    credibility_note=source.credibility_note,
                )
            )
            continue

        rc = chunks[marker - 1]
        result.append(
            ScoredEvidence(
                citation_marker=marker,
                document_id=rc.document.id,
                document_filename=rc.document.filename,
                excerpt=excerpt_for(rc.chunk.content),
                support_score=verification.support_score,
                relevance_score=rc.score,
                entailment_label=verification.entailment_label,
            )
        )
    return result


# Claim-level veracity tiers, per the "Output/Answer Veracity Scoring
# Framework" (client spec, 2026-08-12) - ascending (lower_bound, tier id).
#
# The framework's own table gives 100 as a standalone row ("Verifiable Fact"),
# distinct from 81-99 ("Probable Fact"). Reached against the *rounded*
# display score rather than the raw float: our claim_score is a continuous
# 0.7*support + 0.3*relevance blend, so a raw 99.6 is realistically as good
# as it gets and would otherwise sit forever on the wrong side of a boundary
# the reader can't see - the UI already rounds for display, and the label has
# to agree with the number it's printed next to.
VERACITY_TIERS: tuple[tuple[float, str], ...] = (
    (100.0, "verifiable_fact"),  # 100        - absolute consensus, primary sources, zero omissions
    (81.0, "probable_fact"),  # 81-99      - strongly supported, short of primary confirmation
    (41.0, "gray_area"),  # 41-80      - speculative/uncorroborated, not disproven either
    (21.0, "distorted"),  # 21-40      - a real seed of truth, weaponised via omission/hyperbole
    (0.0, "fabricated"),  # 0-20       - no factual grounding, or built to deceive
)

# Human-readable labels, for anything that renders the tier server-side
# (export, admin views) without duplicating this table.
VERACITY_TIER_LABELS: dict[str, str] = {
    "verifiable_fact": "Verifiable Fact",
    "probable_fact": "Probable Fact",
    "gray_area": "Unverifiable (Gray Area)",
    "distorted": "Appears distorted / misinformed",
    "fabricated": "Appears fabricated / malicious",
}

# A claim whose reasoning was flagged for cognitive distortion cannot read as
# an established fact, however well its citations score - the framework
# reserves 81-100 for content that is *not* "weaponised via hyperbole, severe
# omissions, or chronological displacement", which is exactly what a flagged
# distortion means we found. Capped at the top of "distorted" (40) rather than
# dropped straight to "fabricated" (0-20): a biased framing of a true event is
# a different, lesser claim than "text generated to deceive", and the
# framework treats those as two separate tiers for a reason.
_DISTORTION_CAP = 40.0


def veracity_tier(score: float) -> str:
    """0 fabricated, 21-40 distorted, 41-80 gray_area, 81-99 probable_fact,
    100 verifiable_fact - boundaries checked against the rounded score so the
    label always agrees with the number printed beside it.

    Rounds half *up*, deliberately not via round(). Python rounds halves to
    even (round(80.5) == 80) and JavaScript's Math.round - which is what the
    UI prints the score with - rounds them up (80.5 -> 81). Using round() here
    meant a claim scoring exactly 80.5 was labelled from 80 and displayed as
    81: "Unverifiable" printed beside 81, which is the precise disagreement
    between label and number this function exists to prevent.
    """
    rounded = math.floor(score + 0.5)
    for lower, tier in VERACITY_TIERS:
        if rounded >= lower:
            return tier
    return "fabricated"


# What the second-level blind pass implies about the first pass's *support*
# judgement, rather than about the score directly.
#
# Clamping the score itself was the earlier approach and it produced fake
# precision: a gray_area claim scores 41-80, so max(score, 81) is always
# exactly 81 and min(score, 40) is always exactly 40. Every reconciled claim
# came out on the same number, which looked computed and was a constant.
#
# Re-deriving from the evidence instead keeps the score a real measurement.
# "understated" means the verifier marked support down over informal phrasing
# the second pass saw through, so support is restored; "spoofed" means the
# source's premise looks manufactured, so its support cannot be trusted at
# all. Relevance is untouched by either verdict - how on-topic a source is
# doesn't change because of how the claim was worded.
_RECONCILED_SUPPORT: dict[str, float] = {
    "understated": 1.0,
    "spoofed": 0.15,
}


def rescore_after_reconciliation(
    evidence: list[ScoredEvidence], pattern: str
) -> tuple[float, str] | None:
    """Recompute a gray_area claim once the blind pass has ruled on it.

    Returns None when the verdict implies no change ("genuinely_developing"
    confirms the tier rather than correcting it), or when there is no evidence
    to recompute from.
    """
    support = _RECONCILED_SUPPORT.get(pattern)
    if support is None or not evidence:
        return None

    best = max(evidence, key=_weight)
    if best.relevance_score is None:
        score = 100 * support
    else:
        score = 100 * (0.7 * support + 0.3 * best.relevance_score)
    return score, veracity_tier(score)


def _weight(e: ScoredEvidence) -> float:
    """Ranking key. Unmeasured relevance contributes nothing to the ranking
    but doesn't drag the item below one that scored a real zero."""
    return 0.7 * e.support_score + 0.3 * (e.relevance_score or 0.0)


def score_of(e: ScoredEvidence) -> float:
    """0-100 for one piece of evidence.

    When relevance is unmeasured the score is renormalised onto support
    alone rather than treating the gap as a zero. Scoring what you did not
    measure as the worst possible value is not caution, it is a wrong number
    with a confident label on it.
    """
    if e.relevance_score is None:
        return 100 * e.support_score
    return 100 * (0.7 * e.support_score + 0.3 * e.relevance_score)


def compute_claim_score(
    evidence: list[ScoredEvidence], distorted: bool = False
) -> tuple[float, str]:
    """claim_score = 100 * (0.7*support + 0.3*relevance) of whichever
    evidence item best supports the claim, renormalised to support alone when
    relevance was never measured. No evidence -> 0 (fabricated tier - see the
    module docstring note in chat.py's caller about what that does and doesn't
    imply). The 0.7/0.3 per-claim split isn't admin-configurable, unlike the
    message-level weights below.

    `distorted` is whether the verification agent flagged this claim's
    reasoning for cognitive bias - when true, the score is capped so the tier
    can never read higher than "distorted", regardless of how well-cited it is.
    """
    if not evidence:
        score = 0.0
    else:
        score = score_of(max(evidence, key=_weight))

    if distorted:
        score = min(score, _DISTORTION_CAP)

    return score, veracity_tier(score)


def compute_message_score(
    claims: list[ScoredClaim], weights: ScoringWeights | None = None
) -> MessageScore:
    """§9.3: message-level rollup + distortion penalty/band cap."""
    if weights is None:
        weights = ScoringWeights()

    if not claims:
        return MessageScore(score=0.0, band="Needs Verification", distortion_penalty_applied=False)

    total = len(claims)
    cited = sum(1 for c in claims if c.evidence)
    citation_coverage = cited / total
    mean_claim_score = sum(c.claim_score for c in claims) / total

    all_relevances = [
        e.relevance_score
        for c in claims
        for e in c.evidence
        if e.relevance_score is not None
    ]
    score = (
        weights.claim_score_weight * mean_claim_score
        + weights.citation_coverage_weight * (100 * citation_coverage)
    )

    if all_relevances:
        mean_relevance = sum(all_relevances) / len(all_relevances)
        score += weights.relevance_weight * (100 * mean_relevance)
    else:
        # Nothing measured relevance at all - every source was a pre-generation
        # web result, which carries no credibility judgement. Its weight is
        # redistributed across the components that *were* measured rather than
        # silently contributing zero, which capped such a message at 85 however
        # well every claim in it was supported. Same principle as the per-claim
        # renormalisation above: score what you measured.
        measured = weights.claim_score_weight + weights.citation_coverage_weight
        if measured > 0:
            score *= (measured + weights.relevance_weight) / measured

    distortion_applied = any(c.distortion_flag for c in claims)
    if distortion_applied:
        score = max(0.0, score - weights.distortion_penalty)

    if score >= weights.likely_fact_cutoff:
        band = "Likely Fact"
    elif score >= weights.plausible_cutoff:
        band = "Plausible"
    else:
        band = "Needs Verification"

    # A response that reasons via wishful/magical thinking should never
    # present as fully trustworthy, regardless of how well-cited it is.
    if distortion_applied and band == "Likely Fact":
        band = "Plausible"

    return MessageScore(score=score, band=band, distortion_penalty_applied=distortion_applied)
