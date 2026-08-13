"""Live call: ephemeral credentials for the browser's WebRTC session.

The browser talks to OpenAI's realtime endpoint directly - audio has to go
peer-to-peer or the latency makes it a walkie-talkie - which means something
has to authenticate from the client. That something is never our API key. This
endpoint mints a short-lived client secret scoped to a single session, so the
worst case for a leaked token is somebody else's minutes on one call, not our
account.

The call is deliberately outside the claim-scoring pipeline. Retrieval,
verification and per-claim scoring take seconds, which is fine behind a
streaming answer and fatal between conversational turns. What the caller gets
instead is the companion's voice and judgement without the citations - so the
instructions below tell it to be explicit about uncertainty rather than
implying a rigour the call is not doing.
"""

import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.rate_limit import check_rate_limit
from app.models import User
from app.services.prompt_builder import IDENTITY

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/realtime", tags=["realtime"])

_CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets"

_CALL_INSTRUCTIONS = (
    f"{IDENTITY}\n\n"
    "You are on a live voice call with the user. This is speech, not writing:\n"
    "- Keep turns short. Two or three sentences, then let them back in. Nobody "
    "wants a paragraph read aloud at them.\n"
    "- Talk the way people talk - contractions, plain words, no headings, no "
    "bullet points, no numbered lists, no markdown. None of that survives being "
    "spoken.\n"
    "- Never read out URLs, citation markers or file names.\n"
    "- On this call you are answering from your own knowledge, without checking "
    "the user's documents or searching the web. So when something is uncertain, "
    "outside what you know, or the sort of claim that deserves a source, say so "
    "plainly and suggest they ask in the chat where you can cite it. Do not "
    "invent specifics - numbers, dates, quotes, studies - to sound fluent.\n"
    "- If they interrupt you, stop and listen."
)


@router.post("/session", status_code=status.HTTP_201_CREATED)
async def create_realtime_session(current_user: User = Depends(get_current_user)) -> dict:
    """A single-use client secret for one call.

    Rate limited per user rather than per IP: this is the expensive endpoint in
    the app, and the thing worth limiting is one account opening calls in a
    loop, not an office sharing an address.
    """
    await check_rate_limit(
        f"realtime:session:{current_user.id}", max_requests=20, window_seconds=3600
    )

    payload = {
        "session": {
            "type": "realtime",
            "model": settings.openai_realtime_model,
            "instructions": _CALL_INSTRUCTIONS,
            "output_modalities": ["audio"],
            "audio": {
                "input": {
                    # Semantic VAD decides the user has finished a *thought*
                    # rather than merely gone quiet, which is the difference
                    # between being interrupted mid-sentence and being heard.
                    "turn_detection": {"type": "semantic_vad"},
                },
                "output": {"voice": settings.openai_realtime_voice},
            },
        }
    }

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(
                _CLIENT_SECRETS_URL,
                headers={
                    "Authorization": f"Bearer {settings.openai_api_key}",
                    "Content-Type": "application/json",
                    # Lets OpenAI attribute abuse to one account without us
                    # handing over an email address.
                    "OpenAI-Safety-Identifier": str(current_user.id),
                },
                json=payload,
            )
    except Exception:
        logger.exception("realtime session request failed")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not start the call. Try again in a moment.",
        ) from None

    if response.status_code >= 400:
        # The upstream body can name the model and the account; it goes to our
        # logs, never to the caller.
        logger.warning(
            "realtime session rejected",
            extra={"status": response.status_code, "body": response.text[:400]},
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not start the call. Try again in a moment.",
        )

    data = response.json()
    # Response shape has moved around across revisions of this API; accept the
    # documented `value` and the older top-level `client_secret.value`.
    secret = data.get("value") or (data.get("client_secret") or {}).get("value")
    if not secret:
        logger.error("realtime session returned no client secret", extra={"keys": list(data)})
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not start the call. Try again in a moment.",
        )

    # Only the ephemeral secret and what the browser needs to dial. The model
    # name is deliberately not returned - the client has no use for it, and the
    # identity rules say we do not publish it.
    return {"client_secret": secret, "expires_at": data.get("expires_at")}
