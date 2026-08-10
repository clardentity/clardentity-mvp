"""One question the answer needs answered, with options you can click.

The previous version asked for a free-text section headed "Before I go
further:". It worked, in the sense that the model asked - but the questions
arrived as prose at the bottom of a wall of prose, which is exactly where a
reader who has just got their answer stops reading. And answering one meant
retyping the context by hand.

A structured block instead: one question, a handful of concrete options. The
UI can then render it as something you click, and clicking sends the answer as
your next message. The options matter more than the question does - "what's
your timeframe?" is work, four timeframes to pick from is a decision.
"""

import json
import re

_BLOCK = re.compile(r"<ask>\s*(\{.*?\})\s*</ask>", re.S | re.I)

MAX_OPTIONS = 4
_MAX_QUESTION_CHARS = 160
_MAX_OPTION_CHARS = 80

INSTRUCTIONS = (
    "Ask before assuming. If the request is ambiguous in a way that would "
    "materially change your answer - a missing timeframe, an unstated goal or "
    "constraint, two plausible readings of the question - answer as far as you "
    "reasonably can, then append ONE question block in exactly this form, at "
    "the very end, outside every <claim> tag:\n"
    '<ask>{"question": "...", "options": ["...", "...", "..."]}</ask>\n'
    f"Two to {MAX_OPTIONS} options, each a short concrete answer the user can "
    "pick, not a category. Ask only what actually changes the answer. Never "
    "add the block to seem thorough, never use it to avoid answering, and "
    "never ask something the user already told you. Most turns should not "
    "have one."
)


def extract_clarifier(text: str) -> tuple[str, dict | None]:
    """Pull the <ask> block out of a draft.

    Returns the text without it, and the parsed question, so the block never
    reaches the transcript as raw markup even when it's malformed.
    """
    match = _BLOCK.search(text or "")
    if not match:
        return text, None

    stripped = (text[: match.start()] + text[match.end() :]).strip()

    try:
        payload = json.loads(match.group(1))
    except json.JSONDecodeError:
        return stripped, None
    if not isinstance(payload, dict):
        return stripped, None

    question = str(payload.get("question") or "").strip()[:_MAX_QUESTION_CHARS]
    raw_options = payload.get("options")
    if not question or not isinstance(raw_options, list):
        return stripped, None

    options: list[str] = []
    for option in raw_options:
        cleaned = str(option or "").strip()[:_MAX_OPTION_CHARS]
        # Duplicates come back more often than you'd think, and two identical
        # buttons is a worse experience than one.
        if cleaned and cleaned not in options:
            options.append(cleaned)
        if len(options) == MAX_OPTIONS:
            break

    # A single option isn't a question, it's a suggestion - and a suggestion
    # dressed as a choice is worse than no choice.
    if len(options) < 2:
        return stripped, None

    return stripped, {"question": question, "options": options}
