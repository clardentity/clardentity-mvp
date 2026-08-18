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


class TestContextQuestionGuards:
    """The "why" asked before answering.

    The judgement itself is the model's; these are the guards around it. Each
    one encodes a way the question is worse than no question at all.
    """

    def test_a_statement_is_not_a_question(self):
        from app.services.guidance import _validate_context_question

        assert _validate_context_question("Tell me why you want this.") is None

    def test_a_stacked_question_is_trimmed_to_the_first(self):
        from app.services.guidance import _validate_context_question

        # Used to return None. Measured against the live model, the small
        # model that makes this judgement appends a second clause often
        # enough that dropping the whole thing cost most of the real hits,
        # and the clause it leads with is the one worth asking.
        stacked = "Why do you want to divorce her, and what have you tried?"
        assert _validate_context_question(stacked) == "Why do you want to divorce her?"

    def test_a_stacked_question_with_no_usable_head_is_dropped(self):
        from app.services.guidance import _validate_context_question

        assert _validate_context_question("Why, and what have you tried?") is None

    def test_one_open_question_passes(self):
        from app.services.guidance import _validate_context_question

        asked = "What has been going on between you two?"
        assert _validate_context_question(asked) == asked

    def test_refusals_are_dropped(self):
        from app.services.guidance import _validate_context_question

        # A "why" that opens by declining is the chatbot reflex this feature
        # exists to replace, not an instance of it.
        for text in (
            "I'm sorry to hear that. What happened?",
            "I can't advise on this, but why do you feel that way?",
            "As an AI, may I ask what prompted this?",
            "Have you considered you should consult a lawyer?",
        ):
            assert _validate_context_question(text) is None

    def test_placeholders_are_dropped(self):
        from app.services.guidance import _validate_context_question

        assert _validate_context_question("Why do you want to leave [person]?") is None

    async def test_a_context_question_alone_is_enough_to_return_guidance(self, monkeypatch):
        from app.services import guidance

        async def fake(**_):
            return {
                "suggested_mode": None,
                "mode_reason": None,
                "refined_question": None,
                "refinement_reason": None,
                "context_question": "What has been going on between you two?",
            }

        monkeypatch.setattr(guidance, "generate_structured", fake)
        result = await guidance.propose_guidance("I want to divorce my wife", "decision")
        assert result is not None
        assert result["context_question"] == "What has been going on between you two?"

    async def test_nothing_to_say_still_returns_none(self, monkeypatch):
        from app.services import guidance

        async def fake(**_):
            return {
                "suggested_mode": None,
                "mode_reason": None,
                "refined_question": None,
                "refinement_reason": None,
                "context_question": None,
            }

        monkeypatch.setattr(guidance, "generate_structured", fake)
        assert await guidance.propose_guidance("what is the capital of France", "knowing") is None
