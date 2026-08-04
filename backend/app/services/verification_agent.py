import json
import re
from dataclasses import dataclass

from app.services import taxonomy
from app.services.openai_client import generate_text

# Listing every screenable bias inline would dominate the prompt, so the model
# is given a domain-scoped shortlist by name. It resolves the name back to a
# catalogue entry on our side (taxonomy.resolve_bias), which is also what keeps
# an invented label from ever reaching the database.
_SHORTLIST_SIZE = 60

_BASE_INSTRUCTIONS = (
    "You verify one claim from an AI assistant's response against its cited evidence, and "
    "screen its reasoning for cognitive bias.\n\n"
    "For each piece of evidence given (in the order provided), judge how well it supports "
    'the claim: "full" (directly and completely supports it), "partial" (related but '
    'doesn\'t fully establish it), or "none" (doesn\'t support it at all) - plus a '
    "support_score from 0 to 1 (0 = no support, 1 = complete direct support).\n\n"
    "Then screen the claim's reasoning itself (not just its factual grounding). If the "
    "reasoning exhibits a cognitive bias or distortion, name it using EXACTLY one of the "
    "labels from the VOCABULARY below - copy the label verbatim. If the reasoning is sound, "
    "return null.\n\n"
    "Important - do NOT flag a claim just because it lacks a citation. An uncited claim is "
    "biased only if it confidently asserts something as true that isn't warranted. It is NOT "
    "biased, and must NOT be flagged, when the claim itself:\n"
    "  * honestly acknowledges uncertainty or absence of evidence (e.g. \"this cannot be "
    "confirmed from the available data\", \"there is no evidence for X\") - this is the "
    "opposite of biased reasoning;\n"
    "  * is analytical meta-commentary about options, tradeoffs, criteria, or reasoning steps "
    "(e.g. a pro/con list, a definition, a restatement of the question) rather than a "
    "first-order factual assertion about the world;\n"
    "  * is a plan, recommendation, or next step (e.g. \"check X before concluding Y\") rather "
    "than a claim that X or Y is already true.\n"
    "Only flag claims that assert something IS the case with unwarranted confidence, or whose "
    "reasoning visibly follows a biased pattern. Prefer the most specific applicable label; "
    "fall back to Wishful Thinking or Magical Thinking when no more specific bias fits.\n\n"
    "Respond with ONLY a JSON object with exactly these keys, no other text and no markdown "
    "fencing:\n"
    '{"evidence": [{"entailment_label": "full|partial|none", "support_score": 0.0}, ...], '
    '"bias": "<exact label from VOCABULARY>"|null, '
    '"bias_explanation": "one plain-language sentence naming what the reasoning does, or null"}\n'
    "The evidence array must have exactly as many items, in the same order, as the "
    "evidence you were given."
)

_ENTAILMENT_LABELS = ("full", "partial", "none")


@dataclass
class EvidenceVerification:
    entailment_label: str
    support_score: float


@dataclass
class ClaimVerification:
    evidence: list[EvidenceVerification]
    distortion_flag: str | None
    distortion_explanation: str | None
    bias_category: str | None = None


def _strip_code_fence(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()


def _build_instructions(bias_category_id: str | None) -> str:
    """Domain-scoped vocabulary: the biases most likely to apply come first,
    and the two SRS distortions are always available as a general fallback.
    """
    shortlist = taxonomy.screenable_biases(bias_category_id)[:_SHORTLIST_SIZE]
    lines = [f"- {b.name}: {b.definition}" for b in shortlist]
    for d in taxonomy.SRS_DISTORTIONS.values():
        lines.append(f"- {d['name']}: {d['definition']}")

    scope = taxonomy.get_category(bias_category_id)
    header = "VOCABULARY"
    if scope is not None:
        header += f" (this conversation looks like: {scope.name})"

    return f"{_BASE_INSTRUCTIONS}\n\n{header}:\n" + "\n".join(lines)


async def verify_claim(
    claim_text: str,
    evidence_texts: list[str],
    bias_category_id: str | None = None,
) -> ClaimVerification:
    """§9.1 step 3 / §9.4: entailment + support scoring per cited evidence
    item, plus cognitive-bias screening on the claim's reasoning.

    Runs even for zero-evidence claims (bias screening still applies). Never
    raises - falls back to a conservative "partial/uncertain" verdict rather
    than blocking the response.
    """
    if evidence_texts:
        evidence_block = "\n\n".join(
            f"EVIDENCE {i + 1}:\n{text}" for i, text in enumerate(evidence_texts)
        )
    else:
        evidence_block = "(no evidence was cited for this claim)"

    input_text = f"CLAIM:\n{claim_text}\n\n{evidence_block}"

    fallback = ClaimVerification(
        evidence=[EvidenceVerification("partial", 0.5) for _ in evidence_texts],
        distortion_flag=None,
        distortion_explanation=None,
    )

    try:
        raw = await generate_text(
            instructions=_build_instructions(bias_category_id), input_text=input_text
        )
        parsed = json.loads(_strip_code_fence(raw))
    except Exception:
        return fallback

    try:
        evidence_results = []
        raw_evidence = parsed.get("evidence", [])
        for i in range(len(evidence_texts)):
            item = raw_evidence[i] if i < len(raw_evidence) else {}
            label = item.get("entailment_label")
            if label not in _ENTAILMENT_LABELS:
                label = "partial"
            score = float(item.get("support_score", 0.5))
            score = max(0.0, min(1.0, score))
            evidence_results.append(EvidenceVerification(label, score))

        # Anything the model names that isn't in the catalogue resolves to None
        # and is dropped, so a hallucinated bias never reaches the UI or the DB.
        bias = taxonomy.resolve_bias(parsed.get("bias"))
        explanation = parsed.get("bias_explanation") if bias else None
        category = None
        if bias is not None and bias.categories:
            # Prefer the domain we scoped the shortlist to, when the bias sits
            # in several - otherwise its first listed domain.
            category = (
                bias_category_id
                if bias_category_id in bias.categories
                else bias.categories[0]
            )

        return ClaimVerification(
            evidence=evidence_results,
            distortion_flag=bias.id if bias else None,
            distortion_explanation=explanation,
            bias_category=category,
        )
    except Exception:
        return fallback
