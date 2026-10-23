import io

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.rate_limit import check_rate_limit
from app.db.session import get_db
from app.models import User
from app.schemas.audio import TranscribeOut, TTSRequest
from app.services.admin_settings_service import get_setting
from app.services.openai_client import generate_speech, transcribe_audio

router = APIRouter(prefix="/audio", tags=["audio"])

# Exactly what OpenAI's speech-to-text takes, because every file is sent
# there as-is: there is no converter on this server, and a format accepted
# here and refused there fails as an opaque provider error instead of a
# message the recorder can show.
ALLOWED_AUDIO_EXTENSIONS = {
    "flac", "m4a", "mp3", "mp4", "mpeg", "mpga", "oga", "ogg", "wav", "webm",
}

# What phones record natively that the provider doesn't take. Named so the
# refusal says what to do rather than only what is allowed: iOS voice memos
# are .caf or .aac, older Android recorders .3gp or .amr - each can be
# re-saved, or recorded in the app (which sends webm or m4a).
_PHONE_FORMATS_NOT_ACCEPTED = {"aac", "caf", "3gp", "3gpp", "amr"}

# OpenAI's own ceiling for one transcription. Checked here so an oversized
# file is a clear 413 rather than a provider error after a full upload to it.
MAX_AUDIO_BYTES = 25 * 1024 * 1024


def check_audio_type(filename: str | None) -> None:
    extension = (filename or "").rsplit(".", 1)[-1].lower()
    if extension in ALLOWED_AUDIO_EXTENSIONS:
        return
    allowed = ", ".join(sorted(ALLOWED_AUDIO_EXTENSIONS))
    if extension in _PHONE_FORMATS_NOT_ACCEPTED:
        detail = (
            f".{extension} recordings can't be transcribed yet. Record in the app, "
            f"or convert the file to one of: {allowed}"
        )
    else:
        detail = f"Unsupported audio type. Allowed: {allowed}"
    raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail=detail)


async def read_audio(file: UploadFile) -> bytes:
    """The upload's bytes, or a 413 without ever holding more than the limit."""
    too_large = HTTPException(
        status_code=status.HTTP_413_CONTENT_TOO_LARGE,
        detail=f"Recording is too large to transcribe (limit {MAX_AUDIO_BYTES // (1024 * 1024)} MB)",
    )
    # The multipart parser has already spooled the upload to disk by now, so
    # its size is known without reading it into memory: refuse before reading.
    if file.size is not None and file.size > MAX_AUDIO_BYTES:
        raise too_large
    # And for a part that arrived without a size, read no further than one
    # byte past the limit - that is enough to know.
    contents = await file.read(MAX_AUDIO_BYTES + 1)
    if len(contents) > MAX_AUDIO_BYTES:
        raise too_large
    return contents


@router.post("/transcribe", response_model=TranscribeOut)
async def transcribe(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
) -> TranscribeOut:
    await check_rate_limit(f"audio:transcribe:{current_user.id}", max_requests=20, window_seconds=60)

    check_audio_type(file.filename)
    contents = await read_audio(file)
    result = await transcribe_audio(contents, file.filename or "audio.webm")
    return TranscribeOut(
        transcript=result["transcript"],
        duration_seconds=result["duration_seconds"],
        language=result.get("language"),
        heard_speech=result.get("heard_speech", True),
    )


@router.post("/tts")
async def tts(
    payload: TTSRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> StreamingResponse:
    await check_rate_limit(f"audio:tts:{current_user.id}", max_requests=20, window_seconds=60)

    flags = await get_setting(db, "feature_flags") or {}
    if not flags.get("tts_enabled", True):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="TTS is disabled by admin settings")

    if not payload.text.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="text must not be empty")

    audio_bytes = await generate_speech(payload.text, voice=payload.voice)
    return StreamingResponse(io.BytesIO(audio_bytes), media_type="audio/mpeg")
