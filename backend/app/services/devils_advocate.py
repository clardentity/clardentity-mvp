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
    "The comparison only teaches anything if the two versions are visibly "
    "different. A rewrite that keeps the original's structure and swaps a few "
    "words is a failure: the reader sees two near-identical columns and "
    "concludes the screening does nothing. Rewrite from scratch, in the voice "
    "of someone selling the conclusion.\n\n"
    "Do all of these:\n"
    "- Open with an assertion, not context. The first sentence should be the "
    "strongest claim in the piece, stated as settled fact.\n"
    "- Delete every hedge, qualifier and probability word - 'may', 'often', "
    "'typically', 'suggests', 'in some cases', 'subject to'. If a sentence "
    "only exists to qualify another, cut it entirely.\n"
    "- Cut the counter-arguments, trade-offs and 'on the other hand' material "
    "completely rather than shortening them.\n"
    "- Drop the attributions and the quoted source language. Where the "
    "original says a source describes something, just say it is so.\n"
    "- Use shorter, blunter sentences than the original, and be noticeably "
    "shorter overall - roughly half to two thirds the length. Confidence is "
    "brief; the caveats were most of the word count.\n"
    "- Address the reader directly and tell them what to do.\n\n"
    "Constraints: keep the same subject and the same broad conclusion. Do not "
    "invent new facts, statistics, studies or sources - the difference must "
    "come from certainty and omission, not fabrication. Do not add citation "
    "markers, and do not carry over any [n] markers from the original.\n\n"
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
