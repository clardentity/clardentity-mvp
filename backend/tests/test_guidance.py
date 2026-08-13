"""The two per-turn nudges.

The model's judgement isn't testable here; what is testable is the set of
guards that stop a bad suggestion reaching the UI, and every one of these
encodes something the live model actually produced.
"""

from app.services.guidance import _clip, _reject_placeholders


class TestClip:
    def test_short_text_is_untouched(self):
        assert _clip("A sharper question.", 220) == "A sharper question."

    def test_long_text_cuts_at_a_word_boundary(self):
        # The live model produced "...salary, cost of living, work-life b".
        # Half a word reads as a broken feature.
        clipped = _clip("word " * 100, 40)
        assert clipped is not None
        assert not clipped.rstrip("…").endswith("wor")
        assert clipped.endswith("…")

    def test_non_strings_and_blanks_become_none(self):
        assert _clip(None, 10) is None
        assert _clip(42, 10) is None
        assert _clip("   ", 10) is None

    def test_dashes_are_normalised(self):
        assert "—" not in (_clip("a—b", 50) or "")


class TestPlaceholderRejection:
    def test_bracketed_blanks_are_rejected(self):
        # "I want to get better at [specific skill]" is the same question with
        # brackets - that case belongs to the clarifier, which offers options.
        assert _reject_placeholders("Get better at [specific skill]") is None
        assert _reject_placeholders("Compare {option A} and {option B}") is None
        assert _reject_placeholders("Explain <topic>") is None

    def test_ordinary_questions_pass(self):
        text = "How do I structure a weekly Spanish practice routine?"
        assert _reject_placeholders(text) == text

    def test_none_passes_through(self):
        assert _reject_placeholders(None) is None
