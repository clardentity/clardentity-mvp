"""Claim tag parsing, including the opinion attribute.

<claim id="n" opinion="true"> is the only variant the tag ever takes beyond
the plain form - see prompt_builder._FORMATTING_RULES. The streaming
stripper's fallback path (ClaimTagStripper) is exercised here too, since it
was reasoned through rather than changed when the attribute was added.
"""

from app.services.claim_parser import ClaimTagStripper, extract_claims, strip_claim_tags


class TestExtractClaims:
    def test_plain_claim_is_not_flagged_as_opinion(self):
        claims = extract_claims('<claim id="1">Water boils at 100C.</claim>')
        assert claims[0].is_opinion is False

    def test_opinion_attribute_sets_the_flag(self):
        claims = extract_claims(
            '<claim id="1" opinion="true">Hybrid work wins in five years.</claim>'
        )
        assert claims[0].is_opinion is True
        assert claims[0].claim_text == "Hybrid work wins in five years."

    def test_mixed_claims_flag_independently(self):
        text = (
            '<claim id="1">Water boils at 100C.</claim>'
            '<claim id="2" opinion="true">Hybrid work is best.</claim>'
            '<claim id="3">Ice melts at 0C.</claim>'
        )
        claims = extract_claims(text)
        assert [c.is_opinion for c in claims] == [False, True, False]

    def test_opinion_claim_still_picks_up_citation_markers(self):
        # Not expected in practice (opinion claims are instructed to stay
        # uncited) but the parser itself shouldn't special-case markers away.
        claims = extract_claims('<claim id="1" opinion="true">Best because [2].</claim>')
        assert claims[0].citation_markers == [2]

    def test_unlabeled_fallback_defaults_to_not_opinion(self):
        claims = extract_claims("just plain text, no tags at all")
        assert claims[0].is_opinion is False


class TestStreamingStripperWithOpinionTag:
    def test_opinion_tag_streamed_in_one_chunk_is_fully_stripped(self):
        stripper = ClaimTagStripper()
        out = stripper.feed('<claim id="1" opinion="true">My view.</claim>') + stripper.finalize()
        assert out == "My view."

    def test_opinion_tag_streamed_character_by_character(self):
        # The realistic case: deltas split the tag anywhere, including mid
        # attribute - this is what the fallback-to-_ANY_TAG_RE path exists
        # for.
        stripper = ClaimTagStripper()
        full = '<claim id="1" opinion="true">My view.</claim>'
        out = "".join(stripper.feed(ch) for ch in full) + stripper.finalize()
        assert out == "My view."

    def test_non_streaming_strip_matches(self):
        assert strip_claim_tags('<claim id="1" opinion="true">My view.</claim>') == "My view."
