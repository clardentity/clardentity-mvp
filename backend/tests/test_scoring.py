"""Claim and message scoring.

The regression these guard against is the one that keeps recurring here: a
label and the number printed beside it disagreeing, because one came from
arithmetic and the other from a model's opinion.
"""

from app.services.confidence_scoring import (
    ScoredClaim,
    ScoredEvidence,
    ScoringWeights,
    build_scored_evidence,
    compute_claim_score,
    compute_message_score,
    veracity_tier,
)
from app.services.verification_agent import EvidenceVerification


def ev(support: float, relevance: float, marker: int = 1) -> ScoredEvidence:
    return ScoredEvidence(
        citation_marker=marker,
        document_id=None,
        document_filename="doc.pdf",
        excerpt="x",
        support_score=support,
        relevance_score=relevance,
        entailment_label="full",
    )


class TestVeracityTiers:
    def test_boundaries_match_the_framework_table(self):
        assert veracity_tier(100) == "verifiable_fact"
        assert veracity_tier(99) == "probable_fact"
        assert veracity_tier(81) == "probable_fact"
        assert veracity_tier(80) == "gray_area"
        assert veracity_tier(41) == "gray_area"
        assert veracity_tier(40) == "distorted"
        assert veracity_tier(21) == "distorted"
        assert veracity_tier(20) == "fabricated"
        assert veracity_tier(0) == "fabricated"

    def test_bands_on_the_rounded_score_so_label_matches_display(self):
        # The UI prints round(score). A raw 99.6 displays as 100, and a tier
        # taken from the raw value would print "Probable Fact" beside "100".
        assert veracity_tier(99.6) == "verifiable_fact"
        assert veracity_tier(80.5) == "probable_fact"
        assert veracity_tier(40.5) == "gray_area"
        assert veracity_tier(20.5) == "distorted"

    def test_never_returns_none_for_out_of_range(self):
        assert veracity_tier(-5) == "fabricated"
        assert veracity_tier(1000) == "verifiable_fact"


class TestClaimScore:
    def test_no_evidence_scores_zero(self):
        assert compute_claim_score([]) == (0.0, "fabricated")

    def test_uses_the_single_best_evidence_not_an_average(self):
        # One strong source and one useless one must not average out; the
        # panel tells the reader the score came from the best source.
        score, _ = compute_claim_score([ev(1.0, 1.0), ev(0.0, 0.0, marker=2)])
        assert score == 100.0

    def test_weighting_is_seventy_thirty(self):
        score, _ = compute_claim_score([ev(1.0, 0.0)])
        assert round(score) == 70
        score, _ = compute_claim_score([ev(0.0, 1.0)])
        assert round(score) == 30

    def test_distortion_caps_at_the_top_of_distorted(self):
        clean, clean_tier = compute_claim_score([ev(1.0, 1.0)])
        capped, capped_tier = compute_claim_score([ev(1.0, 1.0)], distorted=True)
        assert clean == 100.0 and clean_tier == "verifiable_fact"
        assert capped == 40.0 and capped_tier == "distorted"

    def test_distortion_never_raises_a_low_score(self):
        # The cap is a ceiling, not an assignment.
        score, tier = compute_claim_score([ev(0.1, 0.1)], distorted=True)
        assert score < 40.0 and tier == "fabricated"

    def test_tier_always_agrees_with_its_own_score(self):
        for support in (0.0, 0.13, 0.37, 0.5, 0.62, 0.81, 0.99, 1.0):
            for relevance in (0.0, 0.44, 0.78, 1.0):
                for distorted in (False, True):
                    score, tier = compute_claim_score([ev(support, relevance)], distorted)
                    assert tier == veracity_tier(score)


class TestEvidenceAssembly:
    def test_verifier_quote_becomes_the_excerpt(self):
        from types import SimpleNamespace as N

        chunk = N(chunk=N(id=1, content="A" * 500), document=N(id=2, filename="d.pdf"), score=0.8)
        [built] = build_scored_evidence(
            [1], [chunk], [EvidenceVerification("full", 0.9, "The deciding sentence.")]
        )
        assert built.excerpt == "The deciding sentence."

    def test_falls_back_to_a_prefix_when_no_quote(self):
        from types import SimpleNamespace as N

        chunk = N(chunk=N(id=1, content="A" * 500), document=N(id=2, filename="d.pdf"), score=0.8)
        [built] = build_scored_evidence([1], [chunk], [EvidenceVerification("full", 0.9, None)])
        assert len(built.excerpt) == 300

    def test_markers_outside_the_context_are_dropped(self):
        # A hallucinated [7] against three sources must not index into
        # anything or raise.
        assert build_scored_evidence([7], [], [EvidenceVerification("full", 1.0)]) == []


class TestMessageScore:
    def test_no_claims_is_needs_verification(self):
        result = compute_message_score([])
        assert result.band == "Needs Verification"
        assert result.score == 0.0

    def _claim(self, score: float, flagged: bool = False, cited: bool = True) -> ScoredClaim:
        return ScoredClaim(
            claim_index=1,
            claim_text="c",
            claim_score=score,
            entailment_label=veracity_tier(score),
            distortion_flag="anchoring_bias" if flagged else None,
            distortion_explanation=None,
            evidence=[ev(1.0, 1.0)] if cited else [],
        )

    def test_well_cited_claims_reach_likely_fact(self):
        result = compute_message_score([self._claim(100), self._claim(100)])
        assert result.band == "Likely Fact"

    def test_distortion_penalty_downgrades_a_perfect_message(self):
        clean = compute_message_score([self._claim(100)])
        dirty = compute_message_score([self._claim(100, flagged=True)])
        assert clean.band == "Likely Fact"
        # Never presents as fully trustworthy once the reasoning is flagged.
        assert dirty.band != "Likely Fact"
        assert dirty.distortion_penalty_applied is True
        assert dirty.score == clean.score - ScoringWeights().distortion_penalty

    def test_uncited_claims_drag_coverage_down(self):
        cited = compute_message_score([self._claim(100), self._claim(100)])
        half = compute_message_score([self._claim(100), self._claim(0, cited=False)])
        assert half.score < cited.score

    def test_score_never_negative(self):
        result = compute_message_score([self._claim(0, flagged=True, cited=False)])
        assert result.score >= 0.0
