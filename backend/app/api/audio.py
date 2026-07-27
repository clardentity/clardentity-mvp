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

ALLOWED_AUDIO_EXTENSIONS = {"webm", "mp3", "wav", "m4a", "ogg", "mp4", "mpeg", "mpga"}


@router.post("/transcribe", response_model=TranscribeOut)
async def transcribe(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
) -> TranscribeOut:
    await check_rate_limit(f"audio:transcribe:{current_user.id}", max_requests=20, window_seconds=60)

    extension = (file.filename or "").rsplit(".", 1)[-1].lower()
    if extension not in ALLOWED_AUDIO_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported audio type. Allowed: " + ", ".join(sorted(ALLOWED_AUDIO_EXTENSIONS)),
        )

    contents = await file.read()
    result = await transcribe_audio(contents, file.filename or "audio.webm")
    return TranscribeOut(transcript=result["transcript"], duration_seconds=result["duration_seconds"])


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
