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


class TestDecisionReviewGuards:
    """The reviewer's judgement isn't testable here; its guards are, and each
    one encodes something worth refusing to show."""

    def _review(self, options, alternative="Do something else", why="because"):
        return {
            "applicable": True,
            "options": options,
            "alternative": alternative,
            "alternative_why": why,
        }

    async def test_needs_at_least_two_options_to_be_a_comparison(self, monkeypatch):
        from app.services import decision_review

        async def fake(**_):
            return self._review([{"label": "A", "sound": False, "bias": None, "why": "x"}])

        monkeypatch.setattr(decision_review, "generate_structured", fake)
        assert await decision_review.review_decisions("one thing") is None

    async def test_no_alternative_when_an_option_was_sound(self, monkeypatch):
        from app.services import decision_review

        async def fake(**_):
            return self._review(
                [
                    {"label": "A", "sound": True, "bias": None, "why": "fine"},
                    {"label": "B", "sound": False, "bias": None, "why": "not fine"},
                ]
            )

        monkeypatch.setattr(decision_review, "generate_structured", fake)
        result = await decision_review.review_decisions("a or b")
        # A rival to a sound option competes with the actual answer.
        assert result is not None
        assert result["alternative"] is None
        assert result["alternative_why"] is None

    async def test_alternative_survives_when_everything_is_flagged(self, monkeypatch):
        from app.services import decision_review

        async def fake(**_):
            return self._review(
                [
                    {"label": "A", "sound": False, "bias": None, "why": "no"},
                    {"label": "B", "sound": False, "bias": None, "why": "also no"},
                ]
            )

        monkeypatch.setattr(decision_review, "generate_structured", fake)
        result = await decision_review.review_decisions("a or b")
        assert result["alternative"] == "Do something else"

    async def test_invented_bias_labels_are_dropped(self, monkeypatch):
        from app.services import decision_review

        async def fake(**_):
            return self._review(
                [
                    {"label": "A", "sound": False, "bias": "Totally Made Up Bias", "why": "no"},
                    {"label": "B", "sound": False, "bias": "Wishful Thinking", "why": "no"},
                ]
            )

        monkeypatch.setattr(decision_review, "generate_structured", fake)
        result = await decision_review.review_decisions("a or b")
        assert result["options"][0]["bias_name"] is None
        assert result["options"][1]["bias_name"] is not None

    async def test_returns_none_when_not_applicable(self, monkeypatch):
        from app.services import decision_review

        async def fake(**_):
            return {"applicable": False, "options": [], "alternative": None, "alternative_why": None}

        monkeypatch.setattr(decision_review, "generate_structured", fake)
        assert await decision_review.review_decisions("should I move?") is None
