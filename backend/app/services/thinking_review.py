"""What Thinking mode shows instead of evidence.

Claims and citations are the wrong instrument here. A reasoning chain isn't
true or false because a document says so - it is sound or unsound because of
how it moves from one step to the next, and scoring it against retrieved
sources reports an absence that was never a fault.

So this contrasts the two: the way of thinking that actually holds for this
question, and the way it most easily goes wrong. The failure modes are named
against the bias catalogue, because "you'll be tempted to weight the first
number you saw" is more useful with "Anchoring Bias" attached to it - it gives
the reader something to recognise next time.

Deliberately about the *question*, not about our answer. The reader can use it
to check the reasoning they were given, including against us.
"""

import logging

from app.services import taxonomy
from app.services.openai_client import generate_structured
from app.services.output_cleanup import clean_output

logger = logging.getLogger("clardentity.thinking_review")

MAX_ENTRIES = 4
_MAX_TEXT = 220
_SHORTLIST = 50

_INSTRUCTIONS = (
    "A user asked a question in thinking mode, where the value is in how the "
    "problem is reasoned through rather than in a cited fact.\n\n"
    "Produce two short lists about THIS question.\n\n"
    "sound: two to four ways of reasoning that actually hold for it. Each is an "
    "`approach` - a way of thinking, phrased as a short instruction - and a "
    "`why` saying what it protects against or reveals. Be specific to the "
    "question; 'think carefully' is not an approach.\n\n"
    "biased: two to four ways this particular question is most easily reasoned "
    "about badly. Each is an `approach` describing the tempting-but-wrong move, "
    "a `bias` naming it with EXACTLY one label copied verbatim from the "
    "VOCABULARY below (or null if no catalogue entry fits), and a `why` saying "
    "what it leads you to conclude wrongly.\n\n"
    "These are about the question itself, not about any answer given to it. "
    "Plain text only: no markdown, no em dashes."
)

_ENTRY = {
    "type": "object",
    "properties": {
        "approach": {"type": "string"},
        "why": {"type": "string"},
    },
    "required": ["approach", "why"],
    "additionalProperties": False,
}

_BIASED_ENTRY = {
    "type": "object",
    "properties": {
        "approach": {"type": "string"},
        "bias": {"type": ["string", "null"]},
        "why": {"type": "string"},
    },
    "required": ["approach", "bias", "why"],
    "additionalProperties": False,
}

_SCHEMA = {
    "type": "object",
    "properties": {
        "sound": {"type": "array", "items": _ENTRY},
        "biased": {"type": "array", "items": _BIASED_ENTRY},
    },
    "required": ["sound", "biased"],
    "additionalProperties": False,
}


def _text(value: object, limit: int = _MAX_TEXT) -> str | None:
    if not isinstance(value, str):
        return None
    cleaned = clean_output(value).strip()
    return cleaned[:limit] or None


def _build_instructions(bias_category_id: str | None) -> str:
    shortlist = taxonomy.screenable_biases(bias_category_id)[:_SHORTLIST]
    lines = [f"- {b.name}: {b.definition}" for b in shortlist]
    for d in taxonomy.SRS_DISTORTIONS.values():
        lines.append(f"- {d['name']}: {d['definition']}")
    return f"{_INSTRUCTIONS}\n\nVOCABULARY:\n" + "\n".join(lines)


async def review_thinking(question: str, bias_category_id: str | None = None) -> dict | None:
    """{"sound": [...], "biased": [...]} or None. Never raises."""
    try:
        parsed = await generate_structured(
            instructions=_build_instructions(bias_category_id),
            input_text=f"THEIR QUESTION:\n{question}",
            schema=_SCHEMA,
            schema_name="thinking_review",
            fast=True,
        )
    except Exception:
        logger.warning("thinking review failed", exc_info=True)
        return None

    sound = []
    for raw in (parsed.get("sound") or [])[:MAX_ENTRIES]:
        approach, why = _text(raw.get("approach")), _text(raw.get("why"))
        if approach and why:
            sound.append({"approach": approach, "why": why})

    biased = []
    for raw in (parsed.get("biased") or [])[:MAX_ENTRIES]:
        approach, why = _text(raw.get("approach")), _text(raw.get("why"))
        if not (approach and why):
            continue
        # Anything outside the catalogue is dropped rather than shown, same
        # rule the claim verifier follows - an invented bias name reads as
        # authoritative and isn't.
        bias = taxonomy.resolve_bias(raw.get("bias"))
        biased.append(
            {
                "approach": approach,
                "bias_name": bias.name if bias else None,
                "bias_definition": bias.definition if bias else None,
                "why": why,
            }
        )

    # A contrast needs both halves. One column alone is either a lecture or an
    # accusation, and the panel replaces the evidence panel, so a thin version
    # of it leaves the mode with nothing.
    if not sound or not biased:
        return None

    return {"sound": sound, "biased": biased}
