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
    document_id: uuid.UUID
    document_filename: str
    excerpt: str
    support_score: float
    relevance_score: float
    entailment_label: str


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
    markers: list[int], chunks: list[RetrievedChunk], verifications: list[EvidenceVerification]
) -> list[ScoredEvidence]:
    """`markers` are the 1-indexed CONTEXT positions a claim cited, `chunks`
    is the full retrieved-chunk list they index into, `verifications` are
    the Verification Agent's per-evidence results in the same order.
    """
    result = []
    for marker, verification in zip(markers, verifications):
        if not (0 < marker <= len(chunks)):
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
    return score, best.entailment_label


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
