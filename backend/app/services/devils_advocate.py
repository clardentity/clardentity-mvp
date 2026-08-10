"""The same answer with the guardrails off.

The bias taxonomy is used here as an *anti-prompt*. Everywhere else in the
pipeline it is a filter - the verification agent screens the answer for
distortions and the confidence score is penalised when it finds one. This
module runs the filter backwards: it asks for the version that leans into the
distortions instead of avoiding them, so the two can be read side by side.

Why that is worth generating at all: a debiased answer, on its own, gives you
no sense of what it cost you. Hedges and counter-considerations read as
waffle until you can see the confident version that omits them - and then it
is obvious which parts of the real answer are load-bearing caution and which
are padding. The comparison is the product; neither half is.

Generated only when asked for, and cached on the message afterwards. It is a
full second generation and most answers are never compared.
"""

from app.services.openai_client import generate_text
from app.services.taxonomy import describe_bias

_INSTRUCTIONS = (
    "You are producing a deliberately one-sided rewrite of an answer, for a "
    "side-by-side comparison that shows a reader what careful phrasing was "
    "protecting them from. This is a teaching device, not advice.\n\n"
    "Rewrite the answer to be as persuasive as possible for the position it "
    "already leans toward:\n"
    "- State things with flat confidence. Remove hedges, caveats and "
    "uncertainty language.\n"
    "- Drop the counter-arguments, trade-offs and 'on the other hand' material.\n"
    "- Lead with whatever is most striking rather than most representative.\n"
    "- Keep the same subject, the same broad conclusion and roughly the same "
    "length. Do not invent new facts, statistics or sources, and do not add "
    "citation markers that were not in the original.\n\n"
    "Strip any <claim> tags - this version is not scored.\n"
    "Respond with ONLY the rewritten answer."
)


def _bias_note(flags: list[tuple[str | None, str | None]]) -> str:
    """Name the specific distortions found in the real answer, so the rewrite
    exaggerates *those* rather than drifting into generic overconfidence."""
    named = []
    for flag, category in flags:
        described = describe_bias(flag, category)
        name = described.get("bias_name")
        if name and name not in named:
            named.append(name)
    if not named:
        return ""
    return (
        "\n\nThe screening flagged these tendencies in the original. Lean into "
        "them rather than correcting for them: " + ", ".join(named) + "."
    )


async def generate_counterfactual(
    answer_text: str,
    flagged: list[tuple[str | None, str | None]] | None = None,
) -> str:
    instructions = _INSTRUCTIONS + _bias_note(flagged or [])
    result = await generate_text(
        instructions=instructions, input_text=f"ANSWER:\n{answer_text}"
    )
    return result.strip()
