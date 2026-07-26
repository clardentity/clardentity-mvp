import json
import re
from dataclasses import dataclass

from app.services.openai_client import generate_text

_INSTRUCTIONS = (
    "You verify one claim from an AI assistant's response against its cited evidence, and "
    "screen its reasoning for two specific distortion patterns.\n\n"
    "For each piece of evidence given (in the order provided), judge how well it supports "
    'the claim: "full" (directly and completely supports it), "partial" (related but '
    'doesn\'t fully establish it), or "none" (doesn\'t support it at all) - plus a '
    "support_score from 0 to 1 (0 = no support, 1 = complete direct support).\n\n"
    "Then screen the claim's reasoning itself (not just its factual grounding) for:\n"
    "- wishful_thinking: the claim's conclusion is asserted AS IF IT WERE ESTABLISHED FACT "
    "while its evidence (cited or absent) only weakly or not at all supports it - the claim "
    "reaches beyond what its evidence can carry.\n"
    '- magical_thinking: the claim asserts a causal link ("X caused/leads to Y") where the '
    "evidence shows X and Y at most co-occurring, with no mechanism connecting them.\n\n"
    "Important - do NOT flag a claim just because it lacks a citation. An uncited claim is "
    "wishful/magical thinking only if it confidently asserts something as true that isn't "
    "warranted. It is NOT wishful/magical thinking, and must NOT be flagged, when the claim "
    "itself:\n"
    "  * honestly acknowledges uncertainty or absence of evidence (e.g. \"this cannot be "
    "confirmed from the available data\", \"there is no evidence for X\") - this is the "
    "opposite of wishful thinking;\n"
    "  * is analytical meta-commentary about options, tradeoffs, criteria, or reasoning steps "
    "(e.g. a pro/con list, a definition, a restatement of the question) rather than a "
    "first-order factual assertion about the world;\n"
    "  * is a plan, recommendation, or next step (e.g. \"check X before concluding Y\") rather "
    "than a claim that X or Y is already true.\n"
    "Only flag claims that assert something IS the case with unwarranted confidence.\n\n"
    "Respond with ONLY a JSON object with exactly these keys, no other text and no markdown "
    "fencing:\n"
    '{"evidence": [{"entailment_label": "full|partial|none", "support_score": 0.0}, ...], '
    '"distortion_flag": "wishful_thinking"|"magical_thinking"|null, '
    '"distortion_explanation": "one plain-language sentence, or null"}\n'
    "The evidence array must have exactly as many items, in the same order, as the "
    "evidence you were given."
)

_ENTAILMENT_LABELS = ("full", "partial", "none")
_DISTORTION_FLAGS = ("wishful_thinking", "magical_thinking")


@dataclass
class EvidenceVerification:
    entailment_label: str
    support_score: float


@dataclass
class ClaimVerification:
    evidence: list[EvidenceVerification]
    distortion_flag: str | None
    distortion_explanation: str | None


def _strip_code_fence(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()


async def verify_claim(claim_text: str, evidence_texts: list[str]) -> ClaimVerification:
    """§9.1 step 3 / §9.4: entailment + support scoring per cited evidence
    item, plus wishful/magical-thinking screening on the claim's reasoning.
    Runs even for zero-evidence claims (distortion screening still applies).
    Never raises - falls back to a conservative "partial/uncertain" verdict
    rather than blocking the response.
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
        raw = await generate_text(instructions=_INSTRUCTIONS, input_text=input_text)
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

        distortion_flag = parsed.get("distortion_flag")
        if distortion_flag not in _DISTORTION_FLAGS:
            distortion_flag = None
        distortion_explanation = parsed.get("distortion_explanation") if distortion_flag else None

        return ClaimVerification(
            evidence=evidence_results,
            distortion_flag=distortion_flag,
            distortion_explanation=distortion_explanation,
        )
    except Exception:
        return fallback
