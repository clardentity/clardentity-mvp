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

    def test_the_curriculum_question_the_instructions_suggest_survives(self):
        # Learning mode's board-and-year question contains both "and" and
        # "or" but is still one question; the conjunction guard must not
        # mistake the illustrative "CBSE Class 10 or A-level Year 12" for a
        # second stacked question.
        from app.services.guidance import _validate_context_question

        asked = "Which board and year is this for - like CBSE Class 10 or A-level Year 12?"
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


class TestClarifyingOptionsGuards:
    """The pre-answer "which did you mean" - clickable options for a
    missing, enumerable piece of information. Each guard encodes a way the
    pair is worse than not offering it."""

    def test_needs_both_a_question_and_options(self):
        from app.services.guidance import _validate_clarifying_options

        assert _validate_clarifying_options(None, ["A", "B"]) == (None, None)
        assert _validate_clarifying_options("What are you improving?", None) == (None, None)

    def test_a_statement_is_not_a_question(self):
        from app.services.guidance import _validate_clarifying_options

        assert _validate_clarifying_options("Tell me the skill.", ["A", "B"]) == (None, None)

    def test_fewer_than_two_options_is_not_a_choice(self):
        from app.services.guidance import _validate_clarifying_options

        assert _validate_clarifying_options("What are you improving?", ["A sport"]) == (None, None)
        assert _validate_clarifying_options("What are you improving?", []) == (None, None)

    def test_a_good_pair_passes_through(self):
        from app.services.guidance import _validate_clarifying_options

        q, opts = _validate_clarifying_options(
            "What are you trying to get better at?",
            ["A sport", "A musical instrument", "A language", "A work skill"],
        )
        assert q == "What are you trying to get better at?"
        assert opts == ["A sport", "A musical instrument", "A language", "A work skill"]

    def test_more_than_four_options_is_clipped(self):
        from app.services.guidance import _validate_clarifying_options

        _q, opts = _validate_clarifying_options(
            "Which one?", ["A", "B", "C", "D", "E", "F"]
        )
        assert opts == ["A", "B", "C", "D"]

    def test_duplicate_options_are_collapsed(self):
        from app.services.guidance import _validate_clarifying_options

        # Same option restated isn't a second choice - and the duplicate
        # alone would otherwise leave only one real option.
        q, opts = _validate_clarifying_options(
            "Which one?", ["A sport", "a sport", "A language"]
        )
        assert q is not None
        assert opts == ["A sport", "A language"]

    def test_placeholder_options_are_dropped(self):
        from app.services.guidance import _validate_clarifying_options

        q, opts = _validate_clarifying_options(
            "Which one?", ["A sport", "[your interest]", "A language"]
        )
        assert q is not None
        assert opts == ["A sport", "A language"]

    def test_not_a_list_is_rejected(self):
        from app.services.guidance import _validate_clarifying_options

        assert _validate_clarifying_options("Which one?", "A sport") == (None, None)

    async def test_setting_both_refined_and_clarifying_prefers_refined(self, monkeypatch):
        from app.services import guidance

        async def fake(**_):
            return {
                "suggested_mode": None,
                "mode_reason": None,
                "refined_question": "How do I get better at running specifically?",
                "refinement_reason": "Names the sport 'it' left out.",
                "clarifying_question": "What are you improving?",
                "clarifying_options": ["A sport", "A language"],
                "context_question": None,
            }

        monkeypatch.setattr(guidance, "generate_structured", fake)
        result = await guidance.propose_guidance("how do I get better at it", "knowing")
        assert result is not None
        assert result["refined_question"] == "How do I get better at running specifically?"
        assert result["clarifying_question"] is None
        assert result["clarifying_options"] is None

    async def test_clarifying_options_alone_is_enough_to_return_guidance(self, monkeypatch):
        from app.services import guidance

        async def fake(**_):
            return {
                "suggested_mode": None,
                "mode_reason": None,
                "refined_question": None,
                "refinement_reason": None,
                "clarifying_question": "What are you improving?",
                "clarifying_options": ["A sport", "A language"],
                "context_question": None,
            }

        monkeypatch.setattr(guidance, "generate_structured", fake)
        result = await guidance.propose_guidance("how do I get better at it", "knowing")
        assert result is not None
        assert result["clarifying_options"] == ["A sport", "A language"]


class TestDecisionSuggestionSet:
    """One sound decision beside the wrong calls.

    These guards exist because the failure is silent and the content is
    dangerous: a list of decisions where the reader cannot tell which one is
    the recommendation is a list of things to maybe do, some of which are
    traps.
    """

    def _item(self, decision, sound, bias=None, why="because"):
        return {"decision": decision, "why": why, "sound": sound, "bias": bias}

    def test_a_valid_set_is_kept_and_the_sound_one_leads(self):
        from app.services.decision_review import _build_suggestions

        out = _build_suggestions(
            [
                self._item("Wait a week", False, "Wishful Thinking"),
                self._item("Ask for the numbers first", True),
                self._item("Go with your gut", False, "Wishful Thinking"),
            ]
        )
        assert len(out) == 3
        assert out[0]["sound"] is True, "the recommendation must lead"
        assert out[0]["decision"] == "Ask for the numbers first"
        assert sum(1 for i in out if i["sound"]) == 1

    def test_no_sound_decision_drops_the_whole_set(self):
        from app.services.decision_review import _build_suggestions

        out = _build_suggestions(
            [
                self._item("A", False, "Wishful Thinking"),
                self._item("B", False, "Wishful Thinking"),
                self._item("C", False, "Wishful Thinking"),
            ]
        )
        assert out == []

    def test_two_sound_decisions_drop_the_whole_set(self):
        from app.services.decision_review import _build_suggestions

        out = _build_suggestions(
            [
                self._item("A", True),
                self._item("B", True),
                self._item("C", False, "Wishful Thinking"),
            ]
        )
        assert out == []

    def test_fewer_than_three_is_not_a_teaching_set(self):
        from app.services.decision_review import _build_suggestions

        out = _build_suggestions(
            [self._item("A", True), self._item("B", False, "Wishful Thinking")]
        )
        assert out == []

    def test_an_unsound_decision_with_an_invented_bias_is_removed(self):
        from app.services.decision_review import _build_suggestions

        # Dropping it takes the set below three, which drops the set - correct:
        # "do not do this" with no reason is indistinguishable from advice.
        out = _build_suggestions(
            [
                self._item("A", True),
                self._item("B", False, "Totally Made Up Bias"),
                self._item("C", False, "Wishful Thinking"),
            ]
        )
        assert out == []

    def test_it_never_exceeds_the_cap(self):
        from app.services.decision_review import MAX_SUGGESTIONS, _build_suggestions

        items = [self._item("sound", True)] + [
            self._item(f"bad {n}", False, "Wishful Thinking") for n in range(9)
        ]
        assert len(_build_suggestions(items)) == MAX_SUGGESTIONS

    def test_junk_input_is_empty_not_an_exception(self):
        from app.services.decision_review import _build_suggestions

        for bad in (None, "suggestions", {}, [None, 42, "x"]):
            assert _build_suggestions(bad) == []


class TestGuidanceSeesTheConversation:
    """The gates judge a follow-up against the whole thread, not the newest
    line alone - the "asked me the region and my fitness level again" report."""

    async def test_history_is_in_the_prompt_oldest_first_and_clipped(self, monkeypatch):
        from app.services import guidance

        seen: dict = {}

        async def fake(**kwargs):
            seen.update(kwargs)
            return {
                "suggested_mode": None,
                "mode_reason": None,
                "refined_question": None,
                "refinement_reason": None,
                "context_question": None,
            }

        monkeypatch.setattr(guidance, "generate_structured", fake)
        history = [
            ("user", "Planning a 4-day trek in the Himalayas for five of us, moderate fitness."),
            ("assistant", "Here are three options for October..." + "x" * 2000),
        ]
        await guidance.propose_guidance(
            "I can't make those dates - the first weekend of November instead?",
            "decision",
            history,
        )
        text = seen["input_text"]
        assert "CONVERSATION SO FAR" in text
        assert text.index("Himalayas") < text.index("three options")
        assert text.index("three options") < text.index("first weekend of November")
        # Long turns are clipped, not dropped.
        assert "x" * 2000 not in text and "…" in text
        # The rule itself is stated to the model.
        assert "never re-ask" in seen["instructions"][0]["text"].lower() or any(
            "never re-ask" in str(part).lower() for part in seen["instructions"]
        )

    async def test_no_history_means_no_block(self, monkeypatch):
        from app.services import guidance

        seen: dict = {}

        async def fake(**kwargs):
            seen.update(kwargs)
            return {"suggested_mode": None, "mode_reason": None, "refined_question": None,
                    "refinement_reason": None, "context_question": None}

        monkeypatch.setattr(guidance, "generate_structured", fake)
        await guidance.propose_guidance("what is the capital of France", "knowing")
        assert "CONVERSATION SO FAR" not in seen["input_text"]


class TestTyposAreNotAmbiguity:
    """The rule behind the 'it asks several questions' feedback: fast,
    misspelled typing must be read for its obvious meaning, not queried."""

    def test_the_brief_says_so(self):
        from app.services.guidance import _INSTRUCTIONS

        assert "not ambiguity" in _INSTRUCTIONS
        assert "reasonable assumption" in _INSTRUCTIONS


class TestSearchPlanner:
    """Which questions the quick answer searches for, and what a plan looks
    like when the model can't be reached."""

    def test_live_data_questions_are_recognised(self):
        from app.services.search_planner import needs_live_data

        for q in (
            "Will it rain tomorrow in Payyannur",
            "what is the price of the Kuari Pass trek with Indiahikes",
            "latest news on the Kerala budget",
            "who is the current chief minister of Kerala",
            "is the Kochi metro open now",
        ):
            assert needs_live_data(q), q
        for q in ("Why did India get independence?", "explain compound interest", "should I quit my job"):
            assert not needs_live_data(q), q

    async def test_a_failed_plan_is_the_question_itself(self, monkeypatch):
        from app.services import search_planner

        async def boom(**_):
            raise RuntimeError("no model")

        monkeypatch.setattr(search_planner, "generate_structured", boom)
        plan = await search_planner.plan_searches([], "Will it rain tomorrow in Payyannur")
        assert plan.retrieval_query == "Will it rain tomorrow in Payyannur"
        assert plan.queries == ["Will it rain tomorrow in Payyannur"]

    async def test_plan_is_deduplicated_and_capped(self, monkeypatch):
        from app.services import search_planner

        async def fake(**_):
            return {
                "retrieval_query": "Kuari Pass trek operators and prices",
                "queries": ['"Indiahikes Kuari Pass fee"', "indiahikes kuari pass fee", "MadTrek Kuari Pass price", "Uttara Hikes Kuari Pass price", "Trek The Himalayas Kuari Pass price", "one too many"],
            }

        monkeypatch.setattr(search_planner, "generate_structured", fake)
        plan = await search_planner.plan_searches([], "compare Kuari Pass trek prices")
        assert plan.queries[0] == "Indiahikes Kuari Pass fee"
        assert len(plan.queries) == search_planner.MAX_QUERIES
