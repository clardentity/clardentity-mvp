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
    relevance_score: float
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
    entailment_label: str  # full/partial/none/unsupported
    distortion_flag: str | None
    distortion_explanation: str | None
    evidence: list[ScoredEvidence]
    bias_category: str | None = None


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

        if marker > len(chunks):
            source = web_sources[marker - len(chunks) - 1]
            result.append(
                ScoredEvidence(
                    citation_marker=marker,
                    document_id=None,
                    document_filename=source.title,
                    excerpt=source.excerpt[:300],
                    support_score=verification.support_score,
                    # A web source has no embedding-similarity score to report,
                    # so its relevance is the supervisor's credibility judgement
                    # - the number that actually governs whether it should have
                    # been cited at all.
                    relevance_score=source.credibility_score or 0.0,
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
                excerpt=rc.chunk.content[:300],
                support_score=verification.support_score,
                relevance_score=rc.score,
                entailment_label=verification.entailment_label,
            )
        )
    return result


# Support bands, in ascending order of (lower_bound, label).
#
# Derived from the score rather than taken from the verification agent's own
# word for it. Those two used to be able to disagree - a claim could read
# "Fully supported" next to a score of 41, because the label came from the
# model's judgement of entailment and the number came from arithmetic over
# support and relevance. Whichever a reader believed, the other one was
# lying to them.
SUPPORT_BANDS: tuple[tuple[float, str], ...] = (
    (76.0, "full"),
    (51.0, "moderate"),
    (26.0, "partial"),
    (0.0, "unsupported"),
)


def support_band(score: float) -> str:
    """0-25 unsupported, 26-50 partial, 51-75 moderate, 76-100 full."""
    for lower, label in SUPPORT_BANDS:
        if score >= lower:
            return label
    return "unsupported"


def compute_claim_score(evidence: list[ScoredEvidence]) -> tuple[float, str]:
    """§9.2: claim_score = 100 * (0.7*support + 0.3*relevance) of whichever
    evidence item best supports the claim. No evidence -> 0 / Unsupported.
    (The 0.7/0.3 per-claim split isn't listed as admin-configurable in the
    spec - only the message-level weights below are.)
    """
    if not evidence:
        return 0.0, "unsupported"

    best = max(evidence, key=lambda e: 0.7 * e.support_score + 0.3 * e.relevance_score)
    score = 100 * (0.7 * best.support_score + 0.3 * best.relevance_score)
    return score, support_band(score)


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

    all_relevances = [e.relevance_score for c in claims for e in c.evidence]
    mean_relevance = sum(all_relevances) / len(all_relevances) if all_relevances else 0.0

    score = (
        weights.claim_score_weight * mean_claim_score
        + weights.citation_coverage_weight * (100 * citation_coverage)
        + weights.relevance_weight * (100 * mean_relevance)
    )

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
