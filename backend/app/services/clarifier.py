"""One question the answer needs answered, with options you can click.

Two design decisions, both learned the hard way.

**It is a separate call.** The clarifier used to be an <ask> block the answer
generation appended to its own prose, parsed back out with a regex. That gave
one generation two jobs, and it did both: it asked in the block *and* in the
prose ("Quick check: can you say...", "If you want, I can build you a plan").
The interface renders one as buttons and the other as flat text, so the user
got the same question twice, the worse version first. Asking a model not to do
that is an instruction it can drop. Not asking it to ask at all is structural.

**The shape is enforced by the API, not by the prompt.** A json_schema
response can't come back as prose, half-JSON, or JSON in a code fence, so
there is no fence-stripping, no brace-hunting, and no silent fall back to "no
question" when the parse fails - three things the regex version did.

It runs concurrently with the rest of the post-answer analysis, so its cost is
absorbed rather than added.
"""

import logging

from app.services.anthropic_client import generate_structured
from app.services.output_cleanup import clean_output

logger = logging.getLogger("clardentity.clarifier")

MAX_OPTIONS = 4
_MAX_QUESTION_CHARS = 160
_MAX_OPTION_CHARS = 80

_INSTRUCTIONS = (
    "An answer has just been written for a user. Decide whether one short "
    "question back to them would materially improve what comes next.\n\n"
    "Set needed=true only when something genuinely unstated would change the "
    "advice: a missing goal, timeframe, constraint or level, or two plausible "
    "readings of the request. Set needed=false when the answer already stands "
    "on its own, when the user already told you the missing piece, or when a "
    "question would only be there to look thorough. Most turns are false.\n\n"
    "When true, write one question and two to four options. Each option is a "
    "short concrete answer the user could pick - 'Travel conversation', not "
    "'Your goal'. Options must be distinct from each other and must not "
    "restate the question. Plain text only: no markdown, no em dashes."
)

_SCHEMA = {
    "type": "object",
    "properties": {
        "needed": {
            "type": "boolean",
            "description": "Whether a clarifying question would materially improve the next answer.",
        },
        "question": {
            "type": ["string", "null"],
            "description": "The question, or null when needed is false.",
        },
        "options": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Two to four concrete answers the user can pick. Empty when needed is false.",
        },
    },
    "required": ["needed", "question", "options"],
    "additionalProperties": False,
}


async def propose_clarifier(user_message: str, answer: str) -> dict | None:
    """`{"question": str, "options": [str, ...]}`, or None when nothing is worth asking.

    Never raises: a missing clarifying question is a smaller loss than a
    failed turn, so any error here degrades to "no question".
    """
    try:
        result = await generate_structured(
            instructions=_INSTRUCTIONS,
            input_text=f"USER ASKED:\n{user_message}\n\nANSWER GIVEN:\n{answer[:4000]}",
            schema=_SCHEMA,
            schema_name="clarifier",
        )
    except Exception:  # noqa: BLE001 - degrade to no question
        logger.exception("clarifier proposal failed")
        return None

    if not result.get("needed"):
        return None

    question = clean_output(str(result.get("question") or ""))[:_MAX_QUESTION_CHARS]
    if not question:
        return None

    options: list[str] = []
    for raw in result.get("options") or []:
        option = clean_output(str(raw or ""))[:_MAX_OPTION_CHARS]
        # Duplicates come back more often than you'd think, and two identical
        # buttons is a worse experience than one.
        if option and option not in options:
            options.append(option)
        if len(options) == MAX_OPTIONS:
            break

    # A single option isn't a question, it's a suggestion - and a suggestion
    # dressed as a choice is worse than no choice. The schema can guarantee
    # the array exists; only this can guarantee it's a real choice.
    if len(options) < 2:
        return None

    return {"question": question, "options": options}
