"""The parts of answering that the app and the landing demo share.

They used to answer through different code, and the demo came out as a
different product - no gist, no verdict box, no claim checking. The answer
is one pipeline now (services/answer_pipeline); what is pinned here is the
pure part of it that decides things: which pre-answer question stops a turn,
and which model writes the answer.
"""

import json

from app.services.answer_pipeline import gate_event, generation_model_for
from app.services.guidance import MAX_CONTEXT_ROUNDS

EVERYTHING = {
    "refined_question": "Did you mean a wordmark?",
    "refinement_reason": "Ambiguous.",
    "clarifying_question": "Which style?",
    "clarifying_options": ["Flat", "Hand-drawn"],
    "context_question": "What is it for?",
    "suggested_mode": "knowing",
    "mode_reason": "Factual.",
}


def _gate(guidance=EVERYTHING, **flags):
    base = dict(
        refined_confirmed=False,
        clarifying_confirmed=False,
        context_acknowledged=False,
        context_rounds=0,
        mode_confirmed=False,
        answered_a_gate=False,
        making_image=False,
        max_context_rounds=MAX_CONTEXT_ROUNDS,
    )
    base.update(flags)
    event = gate_event(guidance, **base)
    return event["event"] if event else None


class TestTheGatesStopInTheirOrder:
    def test_wording_then_options_then_why_then_companion(self):
        assert _gate() == "refined_question"
        assert _gate(refined_confirmed=True) == "clarifying_options"
        assert _gate(refined_confirmed=True, clarifying_confirmed=True) == "context_question"
        assert (
            _gate(refined_confirmed=True, clarifying_confirmed=True, context_acknowledged=True)
            == "mode_suggestion"
        )

    def test_gates_do_not_take_turns(self):
        # Once a rewording or an option has been answered, only the companion
        # may still follow - never the other kinds of question in turn.
        assert _gate(answered_a_gate=True) == "mode_suggestion"
        assert _gate(answered_a_gate=True, mode_confirmed=True) is None

    def test_the_why_follows_up_after_a_context_answer(self):
        """2026-10-19: a tester found the decision companion answering
        "after just two questions or so", before the whole context was in.
        The marker of an answered round closed every later question, so only
        one was ever asked. After a context answer the next one may come."""
        only_why = {"context_question": "What would a good outcome look like for you?"}
        for answered in range(1, MAX_CONTEXT_ROUNDS):
            assert _gate(only_why, answered_a_gate=True, context_rounds=answered) == "context_question"
        # Rewording and options stay closed while it does.
        assert _gate(EVERYTHING, answered_a_gate=True, context_rounds=1) == "context_question"

    def test_the_why_stops_asking_at_the_round_cap(self):
        assert MAX_CONTEXT_ROUNDS == 3
        only_why = {"context_question": "Why?"}
        assert _gate(only_why, context_rounds=MAX_CONTEXT_ROUNDS - 1) == "context_question"
        assert _gate(only_why, answered_a_gate=True, context_rounds=MAX_CONTEXT_ROUNDS) is None
        # "Answer without this" ends it at any round.
        assert _gate(only_why, answered_a_gate=True, context_rounds=1, context_acknowledged=True) is None

    def test_a_picture_goes_round_every_gate(self):
        assert _gate(making_image=True) is None

    def test_nothing_to_say_stops_nothing(self):
        assert _gate(None) is None
        assert _gate({}) is None

    def test_the_event_carries_what_the_card_shows(self):
        event = gate_event(
            {"clarifying_question": "Which?", "clarifying_options": ["A", "B"]},
            refined_confirmed=False, clarifying_confirmed=False, context_acknowledged=False,
            context_rounds=0, mode_confirmed=False, answered_a_gate=False,
            making_image=False, max_context_rounds=2,
        )
        assert json.loads(event["data"]) == {"question": "Which?", "options": ["A", "B"]}


class TestWhichModelWrites:
    def test_an_admin_override_wins(self):
        assert generation_model_for("thinking", {"openai_model": "pinned"}) == "pinned"

    def test_quick_answers_use_the_smallest(self):
        from app.core.config import settings

        assert generation_model_for("rapid", {}) == settings.anthropic_rapid_model

    def test_the_verification_modes_use_the_fast_one(self):
        from app.core.config import settings

        assert generation_model_for("knowing", {}) == settings.anthropic_fast_model

    def test_the_reasoning_modes_get_the_flagship(self):
        # None is the client's default, which is the flagship.
        assert generation_model_for("thinking", {}) is None


class TestAnEmptyContextIsNotALicenceToSkipChecking:
    """With nothing retrieved, the context block used to read "(no relevant
    workspace documents found)". About one answer in three the model then
    tagged every claim as opinion - which switches verification and research
    off for the whole answer - and opened with a disclaimer claim about
    having no documents, read by visitors who have never had a workspace."""

    def test_the_note_says_facts_stay_facts_and_not_to_mention_it(self):
        from app.services.prompt_builder import EMPTY_CONTEXT_NOTE, build_context_block

        note = build_context_block([], [])
        assert note == EMPTY_CONTEXT_NOTE
        assert "workspace documents" not in note
        assert "checked against outside sources" in note
        assert "Do not mention" in note


class TestOnlyCoCreativeNamesItsModels:
    def test_learning_no_longer_has_the_picker(self):
        from app.services import model_catalog

        assert model_catalog.allows_picking("creative")
        assert not model_catalog.allows_picking("learning")
        assert not model_catalog.allows_picking("knowing")
