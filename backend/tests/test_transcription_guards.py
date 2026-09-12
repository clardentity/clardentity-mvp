"""The two things a raw speech-to-text result can't be trusted on, and how
transcribe_audio reports them instead of passing them through."""

from types import SimpleNamespace

import pytest

from app.services import openai_client
from app.services.openai_client import _looks_like_silence, transcribe_audio


class TestLooksLikeSilence:
    def test_empty_is_silence(self):
        assert _looks_like_silence("", None)
        assert _looks_like_silence("   ", [])

    @pytest.mark.parametrize(
        "phrase",
        ["Thank you for watching.", "Thanks for watching!", "Thank you so much for watching", "Bye."],
    )
    def test_whispers_stock_sign_offs_are_silence(self, phrase):
        # The exact artifact reported from the field: an empty clip came back
        # as "Thank you for watching" and was dropped into the composer.
        assert _looks_like_silence(phrase, None)

    def test_real_speech_is_not_silence(self):
        assert not _looks_like_silence("What is the boiling point of water?", None)

    def test_all_segments_confident_of_no_speech_is_silence(self):
        segments = [SimpleNamespace(no_speech_prob=0.91), SimpleNamespace(no_speech_prob=0.77)]
        assert _looks_like_silence("some noise transcribed as words", segments)

    def test_one_confident_speech_segment_is_enough(self):
        segments = [SimpleNamespace(no_speech_prob=0.91), SimpleNamespace(no_speech_prob=0.05)]
        assert not _looks_like_silence("some words", segments)


class TestTranscribeAudioReportsRatherThanGuesses:
    async def test_silence_yields_empty_transcript_and_flag(self, monkeypatch):
        async def fake_call(_fn, **_kwargs):
            return SimpleNamespace(
                text="Thank you for watching",
                duration=1.2,
                language="english",
                segments=[SimpleNamespace(no_speech_prob=0.95)],
            )

        monkeypatch.setattr(openai_client, "_resilient_call", fake_call)
        out = await transcribe_audio(b"...", "recording.webm")
        assert out["heard_speech"] is False
        assert out["transcript"] == ""

    async def test_detected_language_is_passed_through(self, monkeypatch):
        async def fake_call(_fn, **_kwargs):
            return SimpleNamespace(
                text="पानी का क्वथनांक क्या है",
                duration=3.0,
                language="hindi",
                segments=[SimpleNamespace(no_speech_prob=0.02)],
            )

        monkeypatch.setattr(openai_client, "_resilient_call", fake_call)
        out = await transcribe_audio(b"...", "recording.webm")
        assert out["heard_speech"] is True
        assert out["language"] == "hindi"
        assert out["transcript"].startswith("पानी")
