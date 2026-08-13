"""Two nudges the answer can offer without interrupting itself.

Both are suggestions *about* the question rather than answers to it, which is
why neither lives in the answer generation: a model asked to answer and to
critique the asking does the second one in prose, at the top, before getting
to the point.

**Mode.** The user picks a mode and we never override it - that is the
product's promise. But a question that wants Decision asked in Knowing gets a
worse answer than it deserved, and the user has no way to know that. So this
says so, once, and leaves the switch to them.

**Phrasing.** The "did you mean" of a search engine: the same question with
the missing specifics filled in, offered when a vague ask is the reason the
answer had to hedge. Not a correction - the original is always still valid.

Both are frequently null, and should be. A suggestion that fires on every turn
is chrome, and gets ignored exactly as fast as it gets repetitive.
"""

import logging

from app.models.conversation import COGNITIVE_MODES
from app.services.openai_client import generate_structured
from app.services.output_cleanup import clean_output

logger = logging.getLogger("clardentity.guidance")

_MAX_REASON_CHARS = 140
_MAX_QUESTION_CHARS = 220

_MODE_SUMMARY = (
    "knowing: retrieve and state facts precisely, with sources.\n"
    "thinking: reason through a problem step by step to a conclusion.\n"
    "decision: compare options against criteria and recommend one.\n"
    "learning: teach a subject, pitched at the asker's level."
)

_INSTRUCTIONS = (
    "A user asked a question in a chosen cognitive mode. Judge two things "
    "about the question - not about the answer.\n\n"
    f"THE MODES:\n{_MODE_SUMMARY}\n\n"
    "1) suggested_mode: if a different mode genuinely fits the question "
    "better, name it. Only when the mismatch is real and would change the "
    "shape of a good answer - someone weighing options in knowing mode, or "
    "asking to be taught in decision mode. If the chosen mode is reasonable, "
    "return null. Most of the time it is reasonable. Never suggest the mode "
    "they already chose.\n\n"
    "2) refined_question: only when the question is so vague that answering it "
    "well required guessing - a missing subject, or no way to tell what a good "
    "answer looks like. Rewrite it in the user's own voice and first person, "
    "keeping their intent exactly.\n"
    "   Hard limits: one sentence, at most 25 words. It has to fit on a line "
    "the user can read at a glance and click - a rewrite longer than the "
    "original is a worse question, not a sharper one.\n"
    "   Do NOT invent specifics the user never implied. Do not insert "
    "placeholders like [your skill] or [X]. If the missing detail is something "
    "only they could supply, leave refined_question null - a clarifying "
    "question handles that case, not this one.\n"
    "   Return null when the question already names its subject and scope, "
    "which is most of the time. Never rewrite merely to add formality, "
    "structure, or extra requirements the user did not ask for.\n\n"
    "Reasons are one short clause each, addressed to the user, explaining what "
    "they would gain. Plain text only: no markdown, no em dashes."
)

_SCHEMA = {
    "type": "object",
    "properties": {
        "suggested_mode": {
            "type": ["string", "null"],
            "enum": [*COGNITIVE_MODES, None],
            "description": "A mode that fits better, or null.",
        },
        "mode_reason": {
            "type": ["string", "null"],
            "description": "One clause on what that mode would do differently, or null.",
        },
        "refined_question": {
            "type": ["string", "null"],
            "description": "A sharper version of the user's question, or null.",
        },
        "refinement_reason": {
            "type": ["string", "null"],
            "description": "One clause on what the original left open, or null.",
        },
    },
    "required": [
        "suggested_mode",
        "mode_reason",
        "refined_question",
        "refinement_reason",
    ],
    "additionalProperties": False,
}


def _clip(value: object, limit: int) -> str | None:
    """Trim to a word boundary, never mid-word.

    A hard slice produced suggestions ending "...and work-life b", which is
    worse than no suggestion: the refined question is meant to be read at a
    glance and clicked, and half a word says the feature is broken.
    """
    if not isinstance(value, str):
        return None
    cleaned = clean_output(value).strip()
    if not cleaned:
        return None
    if len(cleaned) <= limit:
        return cleaned
    head = cleaned[:limit].rsplit(" ", 1)[0].rstrip(" ,;:-")
    return f"{head}…" if head else None


def _reject_placeholders(text: str | None) -> str | None:
    """Drop rewrites that ask the user to fill in a blank.

    "I want to get better at [specific skill]" is not a sharper question, it
    is the same question with brackets. That case belongs to the clarifier,
    which can offer options.
    """
    if text and ("[" in text or "{" in text or "<" in text):
        return None
    return text


async def propose_guidance(question: str, mode: str) -> dict | None:
    """Returns the guidance object stored on the message, or None.

    Never raises: this is an optional flourish on a turn that has already
    succeeded, and a failure here must not cost the user their answer.
    """
    try:
        parsed = await generate_structured(
            instructions=_INSTRUCTIONS,
            input_text=f"CHOSEN MODE: {mode}\n\nQUESTION:\n{question}",
            schema=_SCHEMA,
            schema_name="turn_guidance",
            fast=True,
        )
    except Exception:
        logger.warning("guidance call failed", exc_info=True)
        return None

    suggested = parsed.get("suggested_mode")
    # Guard the two ways this suggestion is worse than nothing: a mode outside
    # the four, and the one the user is already in.
    if suggested not in COGNITIVE_MODES or suggested == mode:
        suggested = None

    refined = _reject_placeholders(_clip(parsed.get("refined_question"), _MAX_QUESTION_CHARS))
    # A "refinement" identical to the question is noise wearing a suggestion's
    # clothes.
    if refined and refined.strip().lower() == question.strip().lower():
        refined = None
    # A rewrite that had to be truncated was too long to be useful, and one
    # far longer than the original is a different question wearing the
    # original's intent.
    if refined and (refined.endswith("…") or len(refined) > len(question) * 3 + 40):
        refined = None

    result = {
        "suggested_mode": suggested,
        "mode_reason": _clip(parsed.get("mode_reason"), _MAX_REASON_CHARS) if suggested else None,
        "refined_question": refined,
        "refinement_reason": (
            _clip(parsed.get("refinement_reason"), _MAX_REASON_CHARS) if refined else None
        ),
    }

    if not result["suggested_mode"] and not result["refined_question"]:
        return None
    return result
