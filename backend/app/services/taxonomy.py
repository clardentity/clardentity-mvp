"""Cognitive-bias and decision taxonomies.

Source of truth is `app/data/biases.json` / `app/data/decisions.json`, generated
from the taxonomy PDFs in docs/. Loaded once at import and treated as
read-only reference data.

The two source bias documents overlap but neither contains the other, so the
catalogue is their union: every entry has a name and (usually) a category,
but only entries with `defined=True` carry a definition/example we can show a
user. Screening deliberately draws only from the defined subset - flagging a
bias we cannot explain would undercut the whole point of the product.
"""

import json
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

_DATA_DIR = Path(__file__).resolve().parent.parent / "data"

# §9.4 mandates screening for these two reasoning distortions specifically.
# They are not cognitive biases in the catalogue sense (neither appears in the
# source documents), but they share the same detection slot and the same
# confidence penalty, so they live in one vocabulary with the biases.
WISHFUL_THINKING = "wishful_thinking"
MAGICAL_THINKING = "magical_thinking"

SRS_DISTORTIONS: dict[str, dict[str, str]] = {
    WISHFUL_THINKING: {
        "id": WISHFUL_THINKING,
        "name": "Wishful Thinking",
        "definition": (
            "Asserting a conclusion as established fact when the available evidence "
            "only weakly supports it, or does not support it at all."
        ),
        "example": (
            "Stating that a project will ship on time because the team is motivated, "
            "with no schedule or velocity data behind the claim."
        ),
    },
    MAGICAL_THINKING: {
        "id": MAGICAL_THINKING,
        "name": "Magical Thinking",
        "definition": (
            "Asserting a causal link between two things that the evidence shows only "
            "co-occurring, with no mechanism connecting them."
        ),
        "example": (
            "Concluding that a new logo caused a sales increase because both happened "
            "in the same quarter."
        ),
    },
}


@dataclass(frozen=True)
class Bias:
    id: str
    name: str
    definition: str
    example: str
    categories: tuple[str, ...]
    variants: tuple[str, ...]
    defined: bool
    number: int | None = None

    @property
    def is_srs_distortion(self) -> bool:
        return self.id in SRS_DISTORTIONS


@dataclass(frozen=True)
class BiasCategory:
    id: str
    index: int
    name: str
    scenario: str
    bias_ids: tuple[str, ...] = field(default=())


@dataclass(frozen=True)
class DecisionCategory:
    id: str
    name: str
    examples: tuple[dict[str, str], ...]


@dataclass(frozen=True)
class RoleQualifier:
    """A facet of a role. `exclusive` qualifiers admit exactly one value
    (a sibling is a brother or a sister, not both); the rest may take several
    (an employee can work across more than one sector over time).
    """

    id: str
    label: str
    exclusive: bool
    options: tuple[str, ...]


@dataclass(frozen=True)
class Role:
    id: str
    index: int
    label: str
    description: str
    group: str
    qualifiers: tuple[RoleQualifier, ...]


def _load(name: str) -> dict:
    with open(_DATA_DIR / name, encoding="utf-8") as f:
        return json.load(f)


@lru_cache(maxsize=1)
def _bias_data() -> tuple[dict[str, Bias], tuple[BiasCategory, ...]]:
    raw = _load("biases.json")

    biases: dict[str, Bias] = {}
    for b in raw["biases"]:
        biases[b["id"]] = Bias(
            id=b["id"],
            name=b["name"],
            definition=b.get("definition", ""),
            example=b.get("example", ""),
            categories=tuple(b.get("categories", ())),
            variants=tuple(b.get("variants", ())),
            defined=bool(b.get("defined")),
            number=b.get("number"),
        )

    for d in SRS_DISTORTIONS.values():
        biases[d["id"]] = Bias(
            id=d["id"],
            name=d["name"],
            definition=d["definition"],
            example=d["example"],
            categories=(),
            variants=(),
            defined=True,
        )

    categories = tuple(
        BiasCategory(
            id=c["id"],
            index=c["index"],
            name=c["name"],
            scenario=c["scenario"],
            bias_ids=tuple(m["bias_id"] for m in c["members"]),
        )
        for c in sorted(raw["categories"], key=lambda c: c["index"])
    )
    return biases, categories


@lru_cache(maxsize=1)
def _decision_data() -> tuple[tuple[DecisionCategory, ...], tuple[str, ...]]:
    raw = _load("decisions.json")
    cats = tuple(
        DecisionCategory(id=c["id"], name=c["name"], examples=tuple(c["examples"]))
        for c in raw["categories"]
    )
    return cats, tuple(raw["types"])


@lru_cache(maxsize=1)
def _role_data() -> tuple[Role, ...]:
    raw = _load("roles.json")
    return tuple(
        Role(
            id=r["id"],
            index=r["index"],
            label=r["label"],
            description=r["description"],
            group=r["group"],
            qualifiers=tuple(
                RoleQualifier(
                    id=q["id"],
                    label=q["label"],
                    exclusive=bool(q["exclusive"]),
                    options=tuple(q["options"]),
                )
                for q in r.get("qualifiers", [])
            ),
        )
        for r in sorted(raw["roles"], key=lambda r: r["index"])
    )


# ------------------------------------------------------------------- roles --
def all_roles() -> list[Role]:
    return list(_role_data())


def get_role(role_id: str | None) -> Role | None:
    if not role_id:
        return None
    return next((r for r in _role_data() if r.id == role_id), None)


def role_vocabulary() -> str:
    """The role list as prompt text, for inferring which roles a user occupies."""
    lines = []
    for r in _role_data():
        line = f"- {r.id}: {r.description}"
        for q in r.qualifiers:
            kind = "pick exactly one" if q.exclusive else "pick any that apply"
            line += f"\n    · {q.id} ({kind}): {', '.join(q.options)}"
        lines.append(line)
    return "\n".join(lines)


def validate_role_selection(role_id: str, qualifiers: dict[str, list[str]]) -> dict[str, list[str]]:
    """Drop anything outside the taxonomy and enforce exclusivity.

    Inference is an LLM call, so its output is treated as untrusted: unknown
    roles and invented qualifier values never reach the stored profile, and an
    exclusive qualifier is trimmed to its first valid value rather than
    silently storing a contradiction like "brother and sister".
    """
    role = get_role(role_id)
    if role is None:
        return {}

    cleaned: dict[str, list[str]] = {}
    by_id = {q.id: q for q in role.qualifiers}
    for qid, values in (qualifiers or {}).items():
        q = by_id.get(qid)
        if q is None or not isinstance(values, list):
            continue
        valid = [v for v in values if v in q.options]
        if not valid:
            continue
        cleaned[qid] = valid[:1] if q.exclusive else valid
    return cleaned


# ------------------------------------------------------------------ biases --
def all_biases() -> list[Bias]:
    return list(_bias_data()[0].values())


def bias_categories() -> list[BiasCategory]:
    return list(_bias_data()[1])


def get_bias(bias_id: str | None) -> Bias | None:
    if not bias_id:
        return None
    return _bias_data()[0].get(bias_id)


def get_category(category_id: str | None) -> BiasCategory | None:
    if not category_id:
        return None
    return next((c for c in _bias_data()[1] if c.id == category_id), None)


# A parenthetical is a second name for the same bias ("Von Restorff Effect
# (Isolation Effect)") rather than a context qualifier ("Confirmation Bias
# (Medical)") when it reads like a bias name in its own right.
_ALIAS_NOUNS = (
    "effect", "bias", "fallacy", "syndrome", "law", "paradox",
    "heuristic", "illusion", "hypothesis", "phenomenon",
)


def _alias_keys(name: str) -> list[str]:
    """Lookup keys for one display name.

    Several catalogue entries carry two accepted names in a single string,
    either slash-separated ("Sunk Cost Fallacy / Escalation of Commitment") or
    parenthesised ("Barnum Effect (Forer Effect)"). A model asked to name a
    bias typically answers with just one of them, so each is indexed.
    """
    keys: list[str] = []
    for part in [name, *name.split("/")]:
        p = part.strip().lower()
        if not p:
            continue
        keys.append(p)
        head = p.split("(")[0].strip()
        if head:
            keys.append(head)
        for inner in re.findall(r"\(([^)]*)\)", p):
            inner = inner.strip()
            if inner and any(n in inner for n in _ALIAS_NOUNS):
                keys.append(inner)
    return keys


@lru_cache(maxsize=1)
def _name_index() -> dict[str, str]:
    """Lowercased name/alias/variant -> bias id, for resolving model output."""
    index: dict[str, str] = {}
    for b in _bias_data()[0].values():
        index.setdefault(b.id, b.id)
        for key in _alias_keys(b.name):
            index.setdefault(key, b.id)
        for v in b.variants:
            for key in _alias_keys(v):
                index.setdefault(key, b.id)
    return index


def resolve_bias(value: str | None) -> Bias | None:
    """Map a model-returned label (id, display name, or variant) to a Bias.

    Returns None for anything outside the vocabulary so an invented label is
    dropped rather than persisted.
    """
    if not value:
        return None
    key = value.strip().lower()
    bias_id = _name_index().get(key)
    if bias_id is None:
        # tolerate a trailing qualifier, e.g. "Anchoring Bias (pricing)"
        head = key.split("(")[0].strip()
        bias_id = _name_index().get(head)
    return get_bias(bias_id)


def describe_bias(bias_id: str | None, category_id: str | None = None) -> dict[str, str | None]:
    """Display fields for a detected bias, for the API layer.

    Returns nulls for an unknown id so a stale row (e.g. one written before a
    catalogue change) degrades to "no bias shown" rather than breaking the
    response.
    """
    bias = get_bias(bias_id)
    if bias is None:
        return {
            "bias_name": None,
            "bias_definition": None,
            "bias_category": None,
            "bias_category_name": None,
        }
    resolved_category = category_id or (bias.categories[0] if bias.categories else None)
    category = get_category(resolved_category)
    return {
        "bias_name": bias.name,
        "bias_definition": bias.definition or None,
        "bias_category": category.id if category else None,
        "bias_category_name": category.name if category else None,
    }


def screenable_biases(category_id: str | None = None) -> list[Bias]:
    """The vocabulary offered to the verification agent.

    Only biases we can explain, so every flag can be justified in the UI. When
    a decision domain is known the matching category is listed first, since
    those are the biases most likely to apply.
    """
    biases, _ = _bias_data()
    defined = [b for b in biases.values() if b.defined and not b.is_srs_distortion]

    cat = get_category(category_id)
    if cat is None:
        return sorted(defined, key=lambda b: b.name)

    in_cat = {bid for bid in cat.bias_ids}
    scoped = [b for b in defined if b.id in in_cat]
    rest = [b for b in defined if b.id not in in_cat]
    return sorted(scoped, key=lambda b: b.name) + sorted(rest, key=lambda b: b.name)


def search_biases(query: str, category_id: str | None = None) -> list[Bias]:
    q = query.strip().lower()
    results = all_biases()
    if category_id:
        cat = get_category(category_id)
        allowed = set(cat.bias_ids) if cat else set()
        results = [b for b in results if b.id in allowed]
    if q:
        results = [
            b
            for b in results
            if q in b.name.lower()
            or q in b.definition.lower()
            or any(q in v.lower() for v in b.variants)
        ]
    return sorted(results, key=lambda b: b.name)


# --------------------------------------------------------------- decisions --
def decision_categories() -> list[DecisionCategory]:
    return list(_decision_data()[0])


def decision_types() -> list[str]:
    return list(_decision_data()[1])


def get_decision_category(category_id: str | None) -> DecisionCategory | None:
    if not category_id:
        return None
    return next((c for c in _decision_data()[0] if c.id == category_id), None)


# A decision domain and a bias domain are different taxonomies from different
# source documents; this maps one onto the other so classifying a decision can
# surface the biases that typically distort it.
DECISION_TO_BIAS_CATEGORY: dict[str, str] = {
    "financial_and_purchasing_decisions": "shopping_spending_and_money_management",
    "career_and_professional_decisions": "workplace_decisions_projects_and_productivity",
    "relationship_and_social_decisions": "dating_romantic_relationships_and_intimacy",
    "health_and_lifestyle_decisions": "assessing_risk_health_and_personal_safety",
    "educational_and_skill_development": "self_evaluation_learning_and_skill_mastery",
    "moral_and_ethical_decisions": "group_dynamics_politics_and_team_belonging",
    "crisis_and_emergency_decisions": "assessing_risk_health_and_personal_safety",
    "leisure_and_daily_routine_decisions": "strategy_problem_solving_and_innovation",
}


def bias_category_for_decision(decision_category_id: str | None) -> BiasCategory | None:
    if not decision_category_id:
        return None
    return get_category(DECISION_TO_BIAS_CATEGORY.get(decision_category_id))
