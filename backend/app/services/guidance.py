"""Three judgements about the question, made before the answer exists.

All are *about* the question rather than answers to it, which is why none of
them live in the answer generation: a model asked to answer and to critique
the asking does the second one in prose, at the top, before getting to the
point.

**Mode.** The user picks a mode and we never override it - that is the
product's promise. But a question that wants Decision asked in Knowing gets a
worse answer than it deserved, and the user has no way to know that. So this
says so, once, and leaves the switch to them.

**Phrasing.** The "did you mean" of a search engine: the same question with
the missing specifics filled in, offered when a vague ask is the reason the
answer had to hedge. Not a correction - the original is always still valid.

**Context.** "I want to divorce my wife" has no useful answer until you know
why. Neither does "should I quit my job". A person worth asking would ask what
is going on before saying anything; a model that skips that step produces
advice fitted to a situation it invented. So when the message is about the
user's own life and the reasons are absent, this asks for them, and the turn
stops there - the same pre-answer stop the mode nudge uses, for the same
reason: advice built on a guess has already been built by the time you find
out the guess was wrong.

This is not a safety refusal and must not read as one. It is the ordinary
opening move of anyone who has been asked for their opinion.

All three are frequently null, and should be. A suggestion that fires on every
turn is chrome, and gets ignored exactly as fast as it gets repetitive.
"""

import logging
import re

from app.models.conversation import COGNITIVE_MODES
from app.services.anthropic_client import generate_structured
from app.services.output_cleanup import clean_output

logger = logging.getLogger("clardentity.guidance")

_MAX_REASON_CHARS = 140
_MAX_QUESTION_CHARS = 220
# Twenty words of plain English. A "why" that needs more room than this has
# stopped being the question a person would ask and started being a form.
_MAX_CONTEXT_QUESTION_CHARS = 140

_CONJUNCTION = re.compile(r"\s+(?:and|or)\s+|;")
_INTERROGATIVE = re.compile(
    r"(?:why|what|how|when|where|who|which|do|did|does|have|has|are|is|was|were"
    r"|can|could|would|should|will)\b"
)

_MODE_SUMMARY = (
    "knowing: retrieve and state facts precisely, with sources.\n"
    "thinking: reason through a problem step by step to a conclusion.\n"
    "decision: compare options against criteria and recommend one.\n"
    "learning: teach a subject, pitched at the asker's level."
)

_INSTRUCTIONS = (
    "A user asked a question in a chosen cognitive mode. Judge three things "
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
    "3) context_question: when the message is about the user's own life - a "
    "decision they are weighing, an action they intend to take, a situation "
    "they are in - and the reasons or circumstances behind it are absent, ask "
    "for them. Do not answer a question whose answer depends entirely on facts "
    "you would have to invent.\n"
    "   'I want to divorce my wife' is the clearest case: there is no useful "
    "response until you know why. So are 'should I quit my job', 'I am "
    "thinking of moving abroad', 'I want to cut my father out of my life'.\n"
    "   Ask ONE open question - the one a person who actually cared would ask "
    "first, usually some form of what is going on or why. Address them as "
    "'you', in their own words where you can. At most 20 words.\n"
    "   Exactly one question. Never join two with 'and' or 'or' - 'what is "
    "going on, and what have you tried' is two questions and reads as an "
    "interrogation. Ask the first one only.\n"
    "   It must not offer options, open with "
    "sympathy or a diagnosis, or imply they should reconsider. You are asking "
    "what their situation is, not arguing with it, and not refusing to help. "
    "Do not mention being an AI or being unable to advise.\n"
    "   Return null when: the question is factual, technical, or a task to "
    "carry out; the user already gave their reasons, even briefly; or they "
    "have clearly already thought it through and asking would only stall "
    "them.\n"
    "   Return null for ordinary goals with no weight to them - 'I want to "
    "learn Spanish', 'I want to get fitter'. Nothing turns on why, and the "
    "practical details (time, budget, current level) are asked for after the "
    "answer by a different mechanism that can offer options. This one is for "
    "consequential and hard to reverse things: relationships, family, health, "
    "money at risk, leaving something behind.\n"
    "   Null is the common case - most messages are not this.\n\n"
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
        "context_question": {
            "type": ["string", "null"],
            "description": (
                "One open question asking for the circumstances behind a "
                "personal decision, or null when the message does not need it."
            ),
        },
    },
    "required": [
        "suggested_mode",
        "mode_reason",
        "refined_question",
        "refinement_reason",
        "context_question",
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


def _validate_context_question(text: str | None) -> str | None:
    """Drop anything that is not one plain open question.

    The guards are cheap and the failure modes are not: a stacked question
    ("why do you want this, and what have you tried?") reads as an intake
    form, and an opening apology or a refusal turns a human reflex into the
    thing users hate most about chatbots. Anything malformed degrades to no
    question, which just means the answer proceeds as it always did.
    """
    if not text:
        return None
    if "?" not in text:
        return None
    # More than one question mark is more than one question.
    if text.count("?") > 1:
        return None
    # ...and so is one question mark with two questions under it. "What is
    # driving your decision to quit, and what outcome are you hoping for?"
    # punctuates as a single question and lands as an interrogation.
    #
    # Keep the first half rather than dropping the whole thing. The smaller
    # model that makes this judgement stacks a second clause often enough that
    # discarding those cost most of the real hits - and the first clause is
    # reliably the question worth asking, because the model leads with it.
    parts = _CONJUNCTION.split(text)
    if len(parts) > 1 and sum(1 for c in parts if _INTERROGATIVE.match(c.strip().lower())) > 1:
        head = parts[0].strip().rstrip(" ,;:-")
        if len(head) < 15 or not _INTERROGATIVE.match(head.lower()):
            return None
        text = f"{head}?"
    if "[" in text or "{" in text:
        return None
    lowered = text.lower()
    refusals = ("i can't", "i cannot", "as an ai", "i'm not able", "i am not able",
                "i'm sorry", "i am sorry", "seek professional", "consult a")
    if any(phrase in lowered for phrase in refusals):
        return None
    return text


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

    context_question = _validate_context_question(
        _clip(parsed.get("context_question"), _MAX_CONTEXT_QUESTION_CHARS)
    )

    result = {
        "context_question": context_question,
        "suggested_mode": suggested,
        "mode_reason": _clip(parsed.get("mode_reason"), _MAX_REASON_CHARS) if suggested else None,
        "refined_question": refined,
        "refinement_reason": (
            _clip(parsed.get("refinement_reason"), _MAX_REASON_CHARS) if refined else None
        ),
    }

    if (
        not result["suggested_mode"]
        and not result["refined_question"]
        and not result["context_question"]
    ):
        return None
    return result
