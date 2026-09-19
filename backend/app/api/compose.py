"""Help with the message before it is sent.

The composer already corrects spelling as you type, in the browser, with
no model. Grammar and phrasing are a different job - "me and him goes there
tomorrow" is spelled perfectly - and the only thing that does that job well
is a language model. So this is one explicit action, not a keystroke
listener: the user presses the wand and the smallest model returns their
draft with the grammar fixed and the phrasing tidied, meaning and length
kept. Nothing is sent anywhere unless they press it.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.rate_limit import check_rate_limit
from app.models import User
from app.services.anthropic_client import cached, generate_text, is_provider_unavailable_error
from app.services.output_cleanup import replace_dashes

logger = logging.getLogger("clardentity.compose")

router = APIRouter(prefix="/compose", tags=["compose"])

_INSTRUCTIONS = (
    "You tidy a message someone is about to send in a chat. Return the same "
    "message with spelling, grammar and punctuation corrected and awkward "
    "phrasing smoothed - the way a careful friend would fix it before sending.\n"
    "Rules: keep the meaning, the facts, the names and the tone exactly; keep "
    "it about the same length - never add content, never answer the message, "
    "never turn a question into a statement; keep the person's own voice "
    "(casual stays casual); keep any URLs, emails, numbers and code verbatim; "
    "keep line breaks. If nothing needs changing, return the text unchanged. "
    "Reply with the corrected message only - no quotes, no preamble, no notes."
)


class PolishRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class PolishOut(BaseModel):
    text: str
    changed: bool


@router.post("/polish", response_model=PolishOut)
async def polish(
    payload: PolishRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
) -> PolishOut:
    await check_rate_limit(f"compose:polish:{current_user.id}", max_requests=30, window_seconds=300)
    original = payload.text.strip()
    try:
        raw = await generate_text(
            instructions=cached(_INSTRUCTIONS),
            input_text=original,
            model=settings.anthropic_rapid_model,
            fast=True,
        )
    except Exception as exc:  # noqa: BLE001 - never surfaces a vendor message
        logger.warning("polish failed", exc_info=True)
        detail = (
            "You've reached today's limit for responses. Please try again in a little while."
            if is_provider_unavailable_error(exc)
            else "Couldn't tidy that just now. Your message is unchanged."
        )
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail) from exc
    text = replace_dashes(raw.strip().strip('"')) or original
    # A rewrite that doubled in length or shrank to a fragment did not follow
    # the brief; the draft is safer than the "fix".
    if not 0.5 <= len(text) / max(len(original), 1) <= 1.8:
        text = original
    return PolishOut(text=text, changed=text != original)
