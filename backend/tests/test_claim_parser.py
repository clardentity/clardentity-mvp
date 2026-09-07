"""Claim tag parsing, including the opinion attribute.

<claim id="n" opinion="true"> is the only variant the tag ever takes beyond
the plain form - see prompt_builder._FORMATTING_RULES. The streaming
stripper's fallback path (ClaimTagStripper) is exercised here too, since it
was reasoned through rather than changed when the attribute was added.
"""

from app.services.claim_parser import (
    ClaimTagStripper,
    extract_claims,
    extract_crux,
    strip_claim_tags,
)


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


class TestExtractClaimsRecovery:
    """extract_claims used to be a block-matching regex: one unclosed tag
    anywhere meant zero matches, and the whole response collapsed into a
    single unlabeled claim. It now scans open tags and infers each claim's
    boundary, so a malformed claim only ever costs its own exact edge."""

    def test_unclosed_tag_recovers_up_to_next_open_tag(self):
        text = '<claim id="1">First.<claim id="2">Second.</claim>'
        claims = extract_claims(text)
        assert len(claims) == 2
        assert claims[0].claim_index == 1
        assert claims[0].claim_text == "First."
        assert claims[1].claim_index == 2
        assert claims[1].claim_text == "Second."

    def test_unclosed_final_tag_recovers_to_end_of_text(self):
        text = '<claim id="1">First.</claim><claim id="2">Second, unclosed.'
        claims = extract_claims(text)
        assert len(claims) == 2
        assert claims[1].claim_text == "Second, unclosed."

    def test_mismatched_duplicate_ids_are_preserved_verbatim(self):
        text = '<claim id="1">A.</claim><claim id="1">B.</claim>'
        claims = extract_claims(text)
        assert [c.claim_index for c in claims] == [1, 1]
        assert [c.claim_text for c in claims] == ["A.", "B."]

    def test_mixed_wellformed_and_malformed_blocks_in_one_response(self):
        text = (
            '<claim id="1">First, closed.</claim>'
            '<claim id="2">Second, unclosed.'
            '<claim id="3">Third, closed.</claim>'
        )
        claims = extract_claims(text)
        assert len(claims) == 3
        assert claims[0].claim_text == "First, closed."
        assert claims[1].claim_text == "Second, unclosed."
        assert claims[2].claim_text == "Third, closed."

    def test_unusual_whitespace_around_tags_still_parses(self):
        text = '<claim id="1">\n  Padded text.  \n</claim>'
        claims = extract_claims(text)
        assert claims[0].claim_text == "Padded text."

    def test_zero_open_tags_still_falls_back_to_single_blob(self):
        claims = extract_claims("just plain text, no tags at all")
        assert len(claims) == 1
        assert claims[0].claim_index == 1
        assert claims[0].is_opinion is False


class TestExtractCrux:
    def test_pulls_leading_block_and_strips_it(self):
        text = '<crux>Hybrid work wins.</crux><claim id="1">Detail.</claim>'
        crux, rest = extract_crux(text)
        assert crux == "Hybrid work wins."
        assert rest == '<claim id="1">Detail.</claim>'

    def test_returns_none_when_absent(self):
        text = '<claim id="1">Detail.</claim>'
        crux, rest = extract_crux(text)
        assert crux is None
        assert rest == text

    def test_ignores_crux_shaped_text_not_at_start(self):
        text = '<claim id="1">Detail.</claim><crux>Not really a crux.</crux>'
        crux, rest = extract_crux(text)
        assert crux is None
        assert rest == text

    def test_leaves_claim_tags_untouched(self):
        text = '<crux>Bottom line.</crux><claim id="1">A.</claim><claim id="2">B.</claim>'
        _crux, rest = extract_crux(text)
        assert extract_claims(rest) == extract_claims(
            '<claim id="1">A.</claim><claim id="2">B.</claim>'
        )


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
