from pydantic import BaseModel


class TranscribeOut(BaseModel):
    transcript: str
    duration_seconds: float | None = None


class TTSRequest(BaseModel):
    text: str
    voice: str | None = None
