"""Classify what kind of decision a turn is about, so bias screening can be
scoped to the domain that actually applies.

This does NOT touch cognitive-mode selection. §7.2 is explicit that the four
modes are chosen by the user with no auto-detection or fallback; this only
picks a *reference domain* used to (a) shortlist the biases the Verification
Agent screens against and (b) let Decision mode warn about the biases that
typically distort that kind of choice. A wrong or absent classification
degrades to the unscoped vocabulary - it never changes the user's mode.
"""

from dataclasses import dataclass

from app.services import taxonomy
from app.services.openai_client import generate_text

_INSTRUCTIONS = (
    "Classify the kind of real-world decision a user's message is about.\n\n"
    "Reply with ONLY the exact id of the single best-matching category from the list "
    "below, and nothing else. If the message is not about making a decision, or no "
    "category clearly fits, reply exactly: none\n\n"
    "CATEGORIES:\n"
)


@dataclass(frozen=True)
class DecisionClassification:
    decision_category_id: str | None
    bias_category_id: str | None

    @property
    def category(self) -> taxonomy.DecisionCategory | None:
        return taxonomy.get_decision_category(self.decision_category_id)


NO_DECISION = DecisionClassification(None, None)


def _build_instructions() -> str:
    lines = []
    for c in taxonomy.decision_categories():
        examples = "; ".join(e["label"] for e in c.examples)
        lines.append(f"- {c.id}: {c.name} (e.g. {examples})")
    return _INSTRUCTIONS + "\n".join(lines)


async def classify_decision(message: str) -> DecisionClassification:
    """Never raises - an unusable answer means "no domain", which simply
    leaves bias screening unscoped.
    """
    try:
        raw = await generate_text(
            instructions=_build_instructions(), input_text=message.strip()[:2000]
        )
    except Exception:
        return NO_DECISION

    answer = (raw or "").strip().strip("`\"' .").lower()
    category = taxonomy.get_decision_category(answer)
    if category is None:
        return NO_DECISION

    bias_category = taxonomy.bias_category_for_decision(category.id)
    return DecisionClassification(
        decision_category_id=category.id,
        bias_category_id=bias_category.id if bias_category else None,
    )


def build_bias_guidance(classification: DecisionClassification, limit: int = 8) -> str | None:
    """Prompt fragment naming the biases that most commonly distort this kind
    of decision, so Decision mode can surface them before the user commits.
    """
    category = taxonomy.get_category(classification.bias_category_id)
    if category is None:
        return None

    relevant = [
        b
        for b in (taxonomy.get_bias(bid) for bid in category.bias_ids)
        if b is not None and b.defined
    ][:limit]
    if not relevant:
        return None

    lines = "\n".join(f"- {b.name}: {b.definition}" for b in relevant)
    return (
        f"This looks like a decision in the domain of {category.name} "
        f"({category.scenario})\n"
        "Decisions of this kind are commonly distorted by the cognitive biases below. "
        "Where one of them plausibly bears on the user's situation, name it explicitly "
        "and explain how it might be affecting the choice - as a brief 'Bias watch' "
        "section after your recommendation. Do not force it: mention only the biases "
        "that genuinely apply.\n"
        f"{lines}"
    )
