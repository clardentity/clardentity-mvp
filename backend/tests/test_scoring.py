"""Claim and message scoring.

The regression these guard against is the one that keeps recurring here: a
label and the number printed beside it disagreeing, because one came from
arithmetic and the other from a model's opinion.
"""

import math

from app.services.confidence_scoring import (
    ScoredClaim,
    ScoredEvidence,
    ScoringWeights,
    build_scored_evidence,
    compute_claim_score,
    compute_message_score,
    rescore_after_reconciliation,
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
    def test_no_evidence_is_unverified_not_fabricated(self):
        # Nothing to check against is a different statement from "checked
        # and found groundless": the score is still 0 (the message band must
        # still say Needs Verification) but the tier says what happened.
        assert compute_claim_score([]) == (0.0, "unsupported")

    def test_checked_and_groundless_is_still_fabricated(self):
        score, tier = compute_claim_score([ev(0.0, 0.0)])
        assert score == 0.0 and tier == "fabricated"

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

    def test_opinion_flag_overrides_the_fabricated_tier_when_uncited(self):
        # A claim honestly framed as Clardentity AI's own view is not the
        # same thing as an unsupported claim that reads as fact - it gets its
        # own tier instead of "fabricated", at a fixed 0 score.
        assert compute_claim_score([], opinion=True) == (0.0, "opinion")

    def test_opinion_flag_wins_even_when_evidence_was_found_anyway(self):
        # chat.py skips web research for opinion claims, but the tier logic
        # doesn't trust that as its only guard: a claim the model explicitly
        # framed as its own view was never meant to be checked against
        # sources, so evidence arriving some other way still doesn't turn it
        # back into a scored factual claim.
        score, tier = compute_claim_score([ev(1.0, 1.0)], opinion=True)
        assert (score, tier) == (0.0, "opinion")


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


class TestReconciliationRescoring:
    """The second-level pass rules on the first pass's *support* judgement,
    and the score is re-derived from the evidence.

    The bug these guard against: clamping the score directly. A gray_area
    claim scores 41-80, so max(score, 81) is always exactly 81 and
    min(score, 40) is always exactly 40 - every reconciled claim landed on the
    same number, which looked measured and was a constant.
    """

    def _gray(self, support: float, relevance: float) -> ScoredEvidence:
        return ev(support, relevance)

    def test_understated_scores_vary_with_the_evidence(self):
        scores = {
            rescore_after_reconciliation([self._gray(s, r)], "understated")[0]
            for s, r in [(0.6, 0.35), (0.7, 0.5), (0.8, 0.62), (0.65, 0.9)]
        }
        assert len(scores) == 4, "every understated claim produced the same score"
        assert 81.0 not in scores or len(scores) > 1

    def test_spoofed_scores_vary_with_the_evidence(self):
        scores = {
            rescore_after_reconciliation([self._gray(s, r)], "spoofed")[0]
            for s, r in [(0.6, 0.35), (0.7, 0.5), (0.8, 0.62), (0.65, 0.9)]
        }
        assert len(scores) == 4, "every spoofed claim produced the same score"

    def test_understated_never_lowers_the_score(self):
        for s, r in [(0.6, 0.35), (0.75, 0.8), (0.9, 0.45)]:
            before, _ = compute_claim_score([self._gray(s, r)])
            after, _ = rescore_after_reconciliation([self._gray(s, r)], "understated")
            assert after >= before

    def test_spoofed_never_raises_the_score(self):
        for s, r in [(0.6, 0.35), (0.75, 0.8), (0.9, 0.45)]:
            before, _ = compute_claim_score([self._gray(s, r)])
            after, _ = rescore_after_reconciliation([self._gray(s, r)], "spoofed")
            assert after <= before

    def test_tier_still_agrees_with_the_displayed_number(self):
        # The UI prints Math.round(score), which rounds halves up.
        for pattern in ("understated", "spoofed"):
            for s, r in [(0.6, 0.35), (0.7, 0.5), (0.65, 0.9), (0.9, 0.45)]:
                score, tier = rescore_after_reconciliation([self._gray(s, r)], pattern)
                assert tier == veracity_tier(score)
                assert veracity_tier(float(math.floor(score + 0.5))) == tier

    def test_confirming_verdicts_and_empty_evidence_change_nothing(self):
        assert rescore_after_reconciliation([self._gray(0.7, 0.5)], "genuinely_developing") is None
        assert rescore_after_reconciliation([], "understated") is None


class TestUnmeasuredRelevance:
    """Web sources gathered before generation carry no credibility judgement -
    the supervisor only runs per claim, once there is something to check.

    Coercing that unknown to 0.0 capped every claim they supported at exactly
    70/100 and labelled it "Unverifiable", no matter how completely the sources
    backed it. Two government sources stating a constitutional fact verbatim
    read as unverifiable.
    """

    def test_unknown_relevance_does_not_cap_a_fully_supported_claim(self):
        score, tier = compute_claim_score([ev(1.0, None), ev(1.0, None)])
        assert score == 100.0
        assert tier == "verifiable_fact"

    def test_the_old_behaviour_is_what_produced_seventy(self):
        # Kept as the counter-example: a *measured* zero still scores 70.
        score, _ = compute_claim_score([ev(1.0, 0.0)])
        assert score == 70.0

    def test_unknown_relevance_renormalises_onto_support(self):
        for support in (0.0, 0.25, 0.6, 1.0):
            score, _ = compute_claim_score([ev(support, None)])
            assert score == support * 100

    def test_measured_relevance_is_unaffected(self):
        score, _ = compute_claim_score([ev(1.0, 0.8)])
        assert round(score) == 94

    def test_tier_still_agrees_with_the_score(self):
        for support in (0.0, 0.3, 0.55, 0.81, 1.0):
            score, tier = compute_claim_score([ev(support, None)])
            assert tier == veracity_tier(score)

    def test_message_rollup_ignores_unmeasured_relevance(self):
        # Averaging None as zero would drag the message score down the same way.
        claim = ScoredClaim(
            claim_index=1,
            claim_text="c",
            claim_score=100.0,
            entailment_label="verifiable_fact",
            distortion_flag=None,
            distortion_explanation=None,
            evidence=[ev(1.0, None)],
        )
        measured = ScoredClaim(**{**claim.__dict__, "evidence": [ev(1.0, 1.0)]})
        assert compute_message_score([claim]).score == compute_message_score([measured]).score


class TestSeededResearch:
    """A pre-answer search that arrived late seeds the per-claim research:
    the seed is judged first, without a new search, and each claim works on
    its own copies of the sources. Runs against the model-tool path (no
    search API) so nothing here touches the network."""

    async def test_seed_is_judged_before_any_search(self, monkeypatch):
        from app.services import web_research
        from app.services.web_research import WebSource, research_claim

        searched: list[str] = []

        async def fake_search(claim, guidance, max_uses=2):
            searched.append(claim)
            return []

        async def fake_supervise(claim, sources):
            return {
                "verdict": "accept",
                "sources": [{"url": s.url, "score": 0.9, "note": "on point"} for s in sources],
            }

        monkeypatch.setattr(web_research, "tavily_available", lambda: False)
        monkeypatch.setattr(web_research, "_search_round", fake_search)
        monkeypatch.setattr(web_research, "_supervise", fake_supervise)
        seed = [WebSource(url="https://a.example/1", title="A", excerpt="India became independent in 1947.")]
        result = await research_claim("India became independent in 1947.", seed=seed)
        assert result.succeeded
        assert searched == []
        assert result.sources[0].credibility_score == 0.9
        # The caller's seed objects were not written to.
        assert seed[0].credibility_score is None

    async def test_rejected_seed_falls_through_to_a_search(self, monkeypatch):
        from app.services import web_research
        from app.services.web_research import WebSource, research_claim

        searched: list[str] = []

        async def fake_search(claim, guidance, max_uses=2):
            searched.append(claim)
            return []

        async def fake_supervise(claim, sources):
            return {"verdict": "reject", "sources": [], "next_query": "try the archive"}

        monkeypatch.setattr(web_research, "tavily_available", lambda: False)
        monkeypatch.setattr(web_research, "_search_round", fake_search)
        monkeypatch.setattr(web_research, "_supervise", fake_supervise)
        seed = [WebSource(url="https://a.example/1", title="A", excerpt="unrelated")]
        result = await research_claim("Some claim.", seed=seed)
        assert not result.succeeded
        assert len(searched) == web_research.MAX_ROUNDS - 1


class TestTreeSearch:
    """With a search API, a round fires several queries at once and judges
    the merged results in one call - the branches of the search - rather
    than search, judge, search, judge in sequence."""

    def test_first_round_takes_two_angles_and_later_rounds_add_the_hint(self):
        from app.services.web_research import _round_queries

        claim = "Britain's postwar economic exhaustion made holding India untenable in 1947."
        first = _round_queries(claim, None, first=True)
        assert first[0] == (claim, "advanced")
        assert len(first) == 2 and first[1][1] == "basic"
        assert "exhaustion" in first[1][0] and "the" not in first[1][0].split()

        later = _round_queries(claim, "sterling balances 1947 India debt", first=False)
        assert later[1] == ("sterling balances 1947 India debt", "basic")
        assert len(later) == 3

    def test_merge_interleaves_dedupes_and_skips_judged(self):
        from app.services.web_research import WebSource, _merge_sources

        def src(u):
            return WebSource(url=u, title=u, excerpt="x")

        merged = _merge_sources(
            [[src("a"), src("b")], [src("b"), src("c"), src("d")]], skip={"d"}, cap=8
        )
        assert [s.url for s in merged] == ["a", "b", "c"]

    async def test_one_round_settles_a_claim_with_parallel_queries(self, monkeypatch):
        from app.services import web_research
        from app.services.web_research import WebSource, research_claim

        fired: list[tuple[str, str]] = []

        async def fake_tavily(query, *, depth="basic", max_results=5):
            fired.append((query, depth))
            return [WebSource(url=f"https://{depth}.example/{len(fired)}", title="T", excerpt="India 1947")]

        async def fake_supervise(claim, sources):
            return {
                "verdict": "accept",
                "sources": [{"url": s.url, "score": 0.8, "note": "ok"} for s in sources],
            }

        async def never_called(*a, **k):
            raise AssertionError("the model's search tool must not run when the API is available")

        monkeypatch.setattr(web_research, "tavily_available", lambda: True)
        monkeypatch.setattr(web_research, "_tavily_search", fake_tavily)
        monkeypatch.setattr(web_research, "_supervise", fake_supervise)
        monkeypatch.setattr(web_research, "_search_round", never_called)
        result = await research_claim("India became independent from Britain in August 1947.")
        assert result.succeeded and result.rounds_used == 1
        # Both angles fired in the one round, and both results were judged.
        assert len(fired) == 2 and {d for _, d in fired} == {"advanced", "basic"}
        assert len(result.sources) == 2

    async def test_a_revise_verdict_gets_a_second_round_on_the_narrowed_claim(self, monkeypatch):
        from app.services import web_research
        from app.services.web_research import WebSource, research_claim

        fired: list[str] = []
        calls = {"n": 0}

        async def fake_tavily(query, *, depth="basic", max_results=5):
            fired.append(query)
            return [WebSource(url=f"https://e.example/{len(fired)}", title="T", excerpt="x")]

        async def fake_supervise(claim, sources):
            calls["n"] += 1
            if calls["n"] == 1:
                return {"verdict": "revise", "revised_claim": "Narrower claim.", "next_query": "hint words", "sources": []}
            return {"verdict": "accept", "sources": [{"url": s.url, "score": 0.9} for s in sources]}

        monkeypatch.setattr(web_research, "tavily_available", lambda: True)
        monkeypatch.setattr(web_research, "_tavily_search", fake_tavily)
        monkeypatch.setattr(web_research, "_supervise", fake_supervise)
        result = await research_claim("Broad claim about something.")
        assert result.succeeded and result.rounds_used == 2
        assert result.revised_claim == "Narrower claim."
        assert "Narrower claim." in fired and "hint words" in fired
