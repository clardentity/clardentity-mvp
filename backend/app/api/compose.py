"""Help with the message before it is sent: inline completion.

As the user types, the composer asks for the next few words and shows them
in grey ahead of the caret; Shift takes them, typing on ignores them. The
smallest model, a handful of tokens, a request only after a pause in
typing - so it is cheap enough to run on every pause and fast enough to
land before the next word would have been typed anyway. Spelling is
handled in the browser without a model (lib/autocorrect); this is the
part that needs one: knowing what the sentence is about to say.
"""

import logging

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.rate_limit import check_rate_limit
from app.models import User
from app.services.anthropic_client import cached, generate_text

logger = logging.getLogger("clardentity.compose")

router = APIRouter(prefix="/compose", tags=["compose"])

_INSTRUCTIONS = (
    "Someone is typing a message to an assistant and has paused mid-sentence. "
    "Predict how their sentence continues, in their own voice, spelling "
    "conventions and language.\n"
    "Reply with the whole message as it will read: everything they have typed, "
    "character for character (do not correct or reword any of it), followed "
    "immediately by the next few words - at most 12 new words, finishing the "
    "current sentence. A cut-off last word is finished, not repeated: 'we need "
    "the docu' -> 'we need the documents for the visa'; 'what do we need to' -> "
    "'what do we need to bring for the meeting?'.\n"
    "You are completing their message, not answering it: never reply to them, "
    "never explain, never add a second sentence. If the message already reads "
    "as complete or you cannot tell what comes next, reply with nothing at all."
)

_MAX_COMPLETION_CHARS = 120


class CompleteRequest(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class CompleteOut(BaseModel):
    completion: str


_ENDS_SENTENCE = (".", "?", "!")
_MAX_COMPLETION_WORDS = 14


def _tidy(raw: str, text: str) -> str:
    """The new part only. The model returns the whole sentence, typed part
    included, so the continuation is whatever follows the typed text - which
    settles on its own whether a space belongs in front ('docu' -> 'ments',
    'to' -> ' bring'). A reply that does not begin with what was typed (the
    model 'fixed' it, or answered instead of completing) is dropped: putting
    someone's words back differently is not a suggestion."""
    full = raw.replace("\r", "").split("\n")[0].strip().strip('"')
    if not full:
        return ""
    typed = text.rstrip("\n")
    if not full.lower().startswith(typed.lower().rstrip()):
        return ""
    rest = full[len(typed.rstrip()):]
    if typed.endswith(" ") and rest.startswith(" "):
        rest = rest.lstrip(" ")
    if not rest.strip():
        return ""
    if len(rest.split()) > _MAX_COMPLETION_WORDS:
        return ""
    return rest[:_MAX_COMPLETION_CHARS]


@router.post("/complete", response_model=CompleteOut)
async def complete(
    payload: CompleteRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
) -> CompleteOut:
    """Empty completion, never an error, whenever nothing sensible can be
    offered - the composer treats empty as 'no suggestion'."""
    await check_rate_limit(f"compose:complete:{current_user.id}", max_requests=240, window_seconds=300)
    text = payload.text
    # A finished sentence needs no finishing - and asking anyway got answers.
    if len(text.split()) < 3 or text.rstrip().endswith(_ENDS_SENTENCE):
        return CompleteOut(completion="")
    try:
        raw = await generate_text(
            instructions=cached(_INSTRUCTIONS),
            input_text=text,
            model=settings.anthropic_rapid_model,
            fast=True,
        )
    except Exception:  # noqa: BLE001 - a suggestion is a nicety
        logger.debug("completion failed", exc_info=True)
        return CompleteOut(completion="")
    return CompleteOut(completion=_tidy(raw, text))
