"""Judging the options the user brought, not the ones we would have picked.

Decision mode already lays out tradeoffs and recommends. This is a different
job: when someone arrives with three candidate decisions already in hand and
asks which is best, the useful answer often isn't "the second one" - it's
"all three share an assumption you haven't examined."

So each option the user supplied is judged on its own, and named against the
bias catalogue when its reasoning is the problem rather than its content. If
every option is compromised, one is proposed that isn't, with the shared
fault spelled out - because telling someone all their choices are biased and
stopping there is a criticism, not help.

Runs only in decision mode, and returns null for the common case where the
user posed a question rather than a menu. A reviewer that finds fault every
time is one people stop reading.
"""

import logging

from app.services import taxonomy
from app.services.anthropic_client import generate_structured
from app.services.output_cleanup import clean_output

logger = logging.getLogger("clardentity.decision_review")

MAX_OPTIONS = 6
MAX_SUGGESTIONS = 5
_MAX_TEXT = 240
_SHORTLIST = 50

_INSTRUCTIONS = (
    "A user in decision mode may have listed specific options they are choosing "
    "between. Judge the options THEY supplied.\n\n"
    "First: did they actually present two or more concrete candidate decisions to "
    "evaluate? A question like 'should I move to Berlin' is one option against an "
    "unstated status quo - that is NOT a menu, and applicable must be false. Set "
    "applicable true only when there are two or more distinct, stated options.\n\n"
    "For each option, in the order given:\n"
    "- label: the option in the user's own words, shortened to a few words.\n"
    "- sound: true if the option is a reasonable candidate on its face; false if "
    "the reasoning behind it is distorted, the option rests on a false premise, or "
    "it is framed in a way that would mislead whoever acts on it.\n"
    "- bias: when sound is false AND the fault is a reasoning pattern, name it "
    "using EXACTLY one label from the VOCABULARY below, copied verbatim. When the "
    "fault is factual rather than cognitive, or the option is sound, return null.\n"
    "- why: one plain sentence a person can check, addressed to them. Say what is "
    "wrong with the option, not what category it belongs to.\n\n"
    "Then, ONLY if every option is unsound: propose one alternative they did not "
    "list which avoids the fault they all share. `alternative` is the option "
    "itself, stated as an action; `alternative_why` names the shared fault and "
    "says how this avoids it. If any option was sound, both must be null - the "
    "sound option is the answer, and inventing a rival to it is noise.\n\n"
    "Separately, and ALWAYS - whether or not they listed options - give "
    "`suggestions`: three to five decisions for this question, of which "
    "EXACTLY ONE is sound and the rest are not. This is a teaching set, not a "
    "menu: the point is to show what the right call looks like next to the "
    "wrong calls people actually make here.\n"
    "- The sound one (`sound` true, `bias` null) is the decision you would "
    "genuinely recommend. There is exactly one.\n"
    "- Each unsound one (`sound` false) is a decision a reasonable person "
    "might well reach for and should not take, distorted by a specific "
    "reasoning error - name it with EXACTLY one label from the VOCABULARY "
    "below, copied verbatim.\n"
    "- Make the unsound ones genuinely tempting and specific to this question. "
    "A strawman nobody would choose teaches nothing, and neither does a "
    "decision that is merely worse - it has to be wrong for a nameable "
    "reason.\n"
    "- `why` for a sound decision says why it holds up. `why` for an unsound "
    "one says what makes it wrong, in a sentence they can check. Never write "
    "the `why` so that an unsound decision reads as advice.\n\n"
    "Be willing to find nothing wrong. Options are frequently fine. Plain text "
    "only: no markdown, no em dashes."
)

_SCHEMA = {
    "type": "object",
    "properties": {
        "applicable": {
            "type": "boolean",
            "description": "True only when the user listed two or more concrete options.",
        },
        "options": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "label": {"type": "string"},
                    "sound": {"type": "boolean"},
                    "bias": {"type": ["string", "null"]},
                    "why": {"type": "string"},
                },
                "required": ["label", "sound", "bias", "why"],
                "additionalProperties": False,
            },
        },
        "alternative": {"type": ["string", "null"]},
        "alternative_why": {"type": ["string", "null"]},
        "suggestions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "decision": {"type": "string"},
                    "why": {"type": "string"},
                    "sound": {
                        "type": "boolean",
                        "description": "True for the one decision that holds up; false for the rest.",
                    },
                    "bias": {
                        "type": ["string", "null"],
                        "description": "Vocabulary label when sound is false; null when sound.",
                    },
                },
                "required": ["decision", "why", "sound", "bias"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["applicable", "options", "alternative", "alternative_why", "suggestions"],
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


MIN_SUGGESTIONS = 3


def _build_suggestions(raw_items: object) -> list[dict]:
    """One sound decision beside the wrong calls people actually make.

    The set only teaches if its shape is guaranteed, so the shape is enforced
    here rather than hoped for from the prompt. Two failures matter and both
    are silent:

    - No sound decision, or several. A reader who cannot tell which one is the
      recommendation is left with a list of things to maybe do, some of which
      are traps. Rather than show that, the whole set is dropped.
    - An unsound decision with no named reason. "Do not do this" without a
      reason is an assertion, and it is indistinguishable from advice once it
      is sitting in a list of decisions.

    Anything the model names that is not in the catalogue is dropped the same
    way the claim verifier drops an invented bias - and because a nameless
    unsound entry cannot be shown, that entry goes with it.
    """
    if not isinstance(raw_items, list):
        return []

    built: list[dict] = []
    for raw in raw_items[:MAX_SUGGESTIONS]:
        if not isinstance(raw, dict):
            continue
        decision, why = _text(raw.get("decision"), 160), _text(raw.get("why"))
        if not decision or not why:
            continue
        sound = bool(raw.get("sound"))
        bias = None if sound else taxonomy.resolve_bias(raw.get("bias"))
        if not sound and bias is None:
            continue
        built.append(
            {
                "decision": decision,
                "why": why,
                "sound": sound,
                "bias_name": bias.name if bias else None,
                "bias_definition": bias.definition if bias else None,
            }
        )

    sound_count = sum(1 for item in built if item["sound"])
    if sound_count != 1 or len(built) < MIN_SUGGESTIONS:
        return []

    # The recommendation leads. It is the only one the reader should act on,
    # and burying it among the traps is the one ordering that cannot be right.
    built.sort(key=lambda item: not item["sound"])
    return built


async def review_decisions(question: str, bias_category_id: str | None = None) -> dict | None:
    """Returns the review stored on the message, or None when there was no
    menu of options to review. Never raises."""
    try:
        parsed = await generate_structured(
            instructions=_build_instructions(bias_category_id),
            input_text=f"THEIR MESSAGE:\n{question}",
            schema=_SCHEMA,
            schema_name="decision_review",
            fast=True,
        )
    except Exception:
        logger.warning("decision review failed", exc_info=True)
        return None

    suggestions = _build_suggestions(parsed.get("suggestions"))

    def _only_suggestions() -> dict | None:
        # `applicable` governs the verdicts on *their* options. Suggestions
        # stand on their own, so a question with no menu still gets them -
        # which is what decision mode shows in place of an evidence panel.
        if not suggestions:
            return None
        return {
            "options": [],
            "alternative": None,
            "alternative_why": None,
            "suggestions": suggestions,
        }

    if not parsed.get("applicable"):
        return _only_suggestions()

    options = []
    for raw in (parsed.get("options") or [])[:MAX_OPTIONS]:
        label = _text(raw.get("label"), 120)
        why = _text(raw.get("why"))
        if not label or not why:
            continue
        sound = bool(raw.get("sound"))
        # Anything the model names that isn't in the catalogue is dropped, so
        # an invented bias never reaches the reader - same rule the claim
        # verifier follows.
        bias = None if sound else taxonomy.resolve_bias(raw.get("bias"))
        options.append(
            {
                "label": label,
                "sound": sound,
                "bias_name": bias.name if bias else None,
                "bias_definition": bias.definition if bias else None,
                "why": why,
            }
        )

    # Two options is the minimum that makes this a comparison. Fewer means
    # there were no verdicts worth showing, but suggestions may still stand.
    if len(options) < 2:
        return _only_suggestions()

    alternative = _text(parsed.get("alternative"))
    alternative_why = _text(parsed.get("alternative_why"))
    # The alternative is only for the case where nothing they brought works.
    # Offered alongside a sound option it competes with the actual answer.
    if any(o["sound"] for o in options):
        alternative = alternative_why = None

    return {
        "options": options,
        "alternative": alternative,
        "alternative_why": alternative_why if alternative else None,
        "suggestions": suggestions,
    }
