from pydantic import BaseModel


class TranscribeOut(BaseModel):
    transcript: str
    duration_seconds: float | None = None
    # Detected language name as the model reports it ("english", "malayalam").
    language: str | None = None
    # False when the clip most likely held no speech - the transcript is then
    # empty rather than a stock phrase the model invents for silence.
    heard_speech: bool = True


class TTSRequest(BaseModel):
    text: str
    voice: str | None = None
