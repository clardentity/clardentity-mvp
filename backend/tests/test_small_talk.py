"""A greeting gets a greeting back (services/small_talk).

A tester, 2026-10-20: "when I say Hi it shall reply me with greeting,
instead it just gives me 4 options to select one". "hi" went through the
whole machine - the gate check found it vague and asked which of four
things to make, and an answer came written up as a one-line gist with
claims to check. These pin the narrow detector, the prompt it switches on,
and a whole turn in the demo and in the app: no question back, no research,
no gist, nothing checked.
"""

import pytest

from app.services.prompt_builder import MODE_INSTRUCTIONS, SMALL_TALK_RULES, build_system_instructions
from app.services.small_talk import is_small_talk

from tests.test_guest_demo import TestADemoAnswerIsTheProductsAnswer, _frames
from tests.test_healthcare import API, _account, _cleanup, client


class TestWhatCountsAsSmallTalk:
    @pytest.mark.parametrize("message", [
        "Hi", "hi!", "Hiii", "Hello there", "hey", "Good morning", "namaste",
        "Thanks!", "thank you so much", "ok thanks", "bye", "see you later",
        "How are you?", "who are you", "What can you do?", "hi clardentity",
        "Hi, how are you doing today?",
    ])
    def test_a_greeting_thanks_or_question_about_clardentity(self, message):
        assert is_small_talk(message)

    @pytest.mark.parametrize("message", [
        "hi, can you help me write a poem",
        "Hello, should I take the job in Dubai?",
        "who are you voting for",
        "thanks, now make it shorter",
        "there", "and", "",
        "great idea but what about the cost",
        # An answer to one of Clardentity's own questions is never a greeting.
        "(Clardentity asked: What would you like to make?) hi",
    ])
    def test_a_request_with_a_greeting_in_front_is_a_request(self, message):
        assert not is_small_talk(message)


def _flat(*args, **kwargs) -> str:
    return "\n\n".join(b["text"] for b in build_system_instructions(*args, **kwargs))


class TestTheSmallTalkPrompt:
    def test_it_asks_for_a_short_warm_reply_with_no_gist(self):
        prompt = _flat("creative", None, None, None, small_talk=True)
        assert SMALL_TALK_RULES in prompt
        assert "<crux>" in SMALL_TALK_RULES and "no" in SMALL_TALK_RULES.lower()

    def test_the_frameworks_stay_out_of_a_hello(self):
        """Thought coach and Decision-making carry long frameworks for working
        a problem through; with them in the prompt "hi" came back as a
        framework."""
        for mode in ("thinking", "decision"):
            assert len(_flat(mode, None, None, None, small_talk=True)) < len(_flat(mode, None, None, None))

    def test_an_ordinary_turn_has_no_small_talk_rules(self):
        assert SMALL_TALK_RULES not in _flat("creative", None, None, None)


class TestCoCreativeSaysWhatItMade:
    """Same tester: "I selected a presentation, it gave me content only for
    slides - if only content it should say presentation content", and had to
    hunt for where Slide 1 and Slide 2 began."""

    def test_it_calls_written_slides_slide_content(self):
        text = MODE_INSTRUCTIONS["creative"]
        assert "slide content" in text

    def test_every_slide_opens_with_a_bold_label_and_a_blank_line_between(self):
        text = MODE_INSTRUCTIONS["creative"]
        assert "**Slide 1 - " in text
        assert "blank line" in text


class _Fakes:
    """Every call a turn might make, recorded, so a test can say which ran."""

    def __init__(self):
        self.called: list[str] = []
        self.model: str | None = None
        self.instructions = ""

    def record(self, name):
        async def fake(*args, **kwargs):
            self.called.append(name)
            if name == "guidance":
                return {
                    "context_question": None, "suggested_mode": None, "mode_reason": None,
                    "refined_question": None, "refinement_reason": None,
                    "clarifying_question": "What would you like help creating?",
                    "clarifying_options": ["A story", "A poem", "A presentation", "An image"],
                }
            return None
        return fake

    def generation(self, reply):
        async def generate(*, instructions, input_text, model=None, **kwargs):
            self.called.append("generation")
            self.model = model
            self.instructions = "\n".join(b["text"] for b in instructions)
            yield {"type": "delta", "text": reply}
            yield {"type": "done", "full_text": reply}
        return generate


REPLY = "Hi! Good to see you. What would you like to make today - a story, a pitch, a picture?"


class TestTheDemoGreetsBack:
    # The demo suite's fakes and client, borrowed rather than inherited (a
    # subclass would run every demo test a second time).
    ANSWER = TestADemoAnswerIsTheProductsAnswer.ANSWER
    _fake_pipeline = TestADemoAnswerIsTheProductsAnswer._fake_pipeline
    _ask = TestADemoAnswerIsTheProductsAnswer._ask
    _available = TestADemoAnswerIsTheProductsAnswer._available

    async def test_hi_is_answered_not_asked_about(self, monkeypatch):
        from app.api import guest as guest_api
        from app.core.config import settings

        await self._available()
        self._fake_pipeline(monkeypatch)
        fakes = _Fakes()
        for name, attr in (("guidance", "propose_guidance"), ("plan", "plan_searches"),
                           ("image", "wanted_image"), ("classify", "classify_decision"),
                           ("review", "review_decisions")):
            monkeypatch.setattr(guest_api, attr, fakes.record(name))
        monkeypatch.setattr(guest_api, "stream_generation", fakes.generation(REPLY))

        res = await self._ask(mode="creative", message="Hi")
        assert res.status_code == 200, res.text
        events = _frames(res.text)
        names = [e for e, _ in events]
        assert "clarifying_options" not in names and "context_question" not in names
        assert fakes.called == ["generation"], fakes.called
        assert fakes.model == settings.anthropic_rapid_model
        assert SMALL_TALK_RULES in fakes.instructions
        final = dict(events)["final"]
        assert final["claims"] == []
        assert not final["message"].get("crux_text")
        assert final["message"]["content"].startswith("Hi! Good to see you.")

    async def test_a_request_after_hi_goes_the_normal_way(self, monkeypatch):
        from app.api import guest as guest_api

        await self._available()
        self._fake_pipeline(monkeypatch)
        fakes = _Fakes()
        monkeypatch.setattr(guest_api, "propose_guidance", fakes.record("guidance"))
        res = await self._ask(mode="creative", message="hi, write me a poem about rain")
        assert "guidance" in fakes.called
        assert "clarifying_options" in [e for e, _ in _frames(res.text)]


class TestTheAppGreetsBack:
    async def test_hi_in_decision_making_is_a_greeting_not_a_decision(self, monkeypatch):
        from app.api import chat as chat_api
        from app.core.config import settings
        from app.models import Message
        from app.db.session import AsyncSessionLocal
        from sqlalchemy import select

        headers, user_id, kept, _ = await _account("XP")
        fakes = _Fakes()
        for name, attr in (("guidance", "propose_guidance"), ("plan", "plan_searches"),
                           ("image", "wanted_image"), ("classify", "classify_decision"),
                           ("review", "review_decisions"), ("chunks", "retrieve_chunks")):
            monkeypatch.setattr(chat_api, attr, fakes.record(name))

        async def title(question, gist, fallback):
            return "Hello"

        async def nothing(*a, **k):
            return None

        monkeypatch.setattr(chat_api, "name_conversation", title)
        monkeypatch.setattr(chat_api, "capture_stated_facts", nothing)
        monkeypatch.setattr(chat_api, "stream_generation", fakes.generation(REPLY))
        try:
            async with client() as c:
                res = await c.post(
                    f"{API}/chat/{kept}/messages",
                    json={"content": "hello there!", "mode": "decision"},
                    headers=headers,
                )
            body = res.text
            assert res.status_code == 200, body
            assert "clarifying_options" not in body and "context_question" not in body
            assert "event: review" not in body
            assert "guidance" not in fakes.called and "review" not in fakes.called
            assert "plan" not in fakes.called and "classify" not in fakes.called
            assert fakes.model == settings.anthropic_rapid_model
            assert SMALL_TALK_RULES in fakes.instructions
            async with AsyncSessionLocal() as db:
                answer = (await db.execute(
                    select(Message).where(Message.conversation_id == kept, Message.role == "assistant")
                )).scalar_one()
            assert answer.crux_text is None
            assert answer.content.startswith("Hi! Good to see you.")
            assert answer.confidence_band is None
        finally:
            await _cleanup(user_id)
