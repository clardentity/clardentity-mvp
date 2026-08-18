import re
from dataclasses import dataclass

from app.services import taxonomy
from app.services.anthropic_client import generate_structured
from app.services.output_cleanup import replace_dashes

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
    "Also return `quote`: the specific sentence or two, copied verbatim from that piece of "
    "evidence, that decided your judgement - the part a reader would need to see to agree "
    "with you. Copy it exactly, do not paraphrase, and keep it under about 240 characters. "
    "If nothing in the evidence bears on the claim, return the sentence that comes closest "
    "and score it accordingly.\n\n"
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
    '{"evidence": [{"entailment_label": "full|partial|none", "support_score": 0.0, '
    '"quote": "the deciding sentence, verbatim"}, ...], '
    '"bias": "<exact label from VOCABULARY>"|null, '
    '"bias_explanation": "one plain-language sentence naming what the reasoning does, or null"}\n'
    "The evidence array must have exactly as many items, in the same order, as the "
    "evidence you were given."
)

# Per-source-category judgement criteria from the "Output/Answer Veracity
# Scoring Framework" Metric Accuracy Parameters table. We have no wire-service
# API, plagiarism scanner, domain-authority database, or bot-detection system
# to call - these are the framework's benchmarks folded into the verifier's
# own judgement instead of a fabricated integration, so the model applies the
# same standard a human reviewer would without us pretending to automate what
# we can't.
_SOURCE_BENCHMARKS = (
    "When evidence looks like a news or media article, weigh chronological consistency and "
    "whether quotes appear to be reported verbatim; a single outlet's account is weaker than "
    "corroboration you can infer from independent, reputable coverage of the same event.\n"
    "When evidence looks like a scientific or academic paper, weigh methodological soundness "
    "and peer-review signals (journal, citations) over the confidence of its prose; a claim "
    "that outruns what the study itself established should not inherit the study's credibility.\n"
    "When evidence looks like user-generated content (reviews, forum posts, social media), "
    "weigh first-hand experiential detail against generic or incentivized-sounding language "
    "(vague praise/complaint patterns typical of paid or bot-generated reviews)."
)

_ENTAILMENT_LABELS = ("full", "partial", "none")


@dataclass
class EvidenceVerification:
    entailment_label: str
    support_score: float
    # The sentence the judgement actually turned on. What we used to show a
    # reader instead was the first 300 characters of the retrieved chunk,
    # which is where the chunk happened to start rather than anything to do
    # with the claim - so the panel asked you to take the score on trust and
    # then showed you an unrelated paragraph as if it were the reason.
    quote: str | None = None


@dataclass
class ClaimVerification:
    evidence: list[EvidenceVerification]
    distortion_flag: str | None
    distortion_explanation: str | None
    bias_category: str | None = None


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

    return (
        f"{_BASE_INSTRUCTIONS}\n\nSOURCE BENCHMARKS:\n{_SOURCE_BENCHMARKS}"
        f"\n\n{header}:\n" + "\n".join(lines)
    )


_SCHEMA = {
    "type": "object",
    "properties": {
        "evidence": {
            "type": "array",
            "description": "One entry per cited evidence item, in the order given.",
            "items": {
                "type": "object",
                "properties": {
                    "entailment_label": {
                        "type": "string",
                        "enum": list(_ENTAILMENT_LABELS),
                        "description": "Does the evidence support the claim fully, partly, or not at all.",
                    },
                    "support_score": {
                        "type": "number",
                        "description": "0.0-1.0, how strongly this evidence supports the claim.",
                    },
                    "quote": {
                        "type": "string",
                        "description": (
                            "The sentence from this evidence that decided the judgement, "
                            "copied verbatim. Under ~240 characters."
                        ),
                    },
                },
                "required": ["entailment_label", "support_score", "quote"],
                "additionalProperties": False,
            },
        },
        "bias": {
            "type": ["string", "null"],
            "description": "Id of a cognitive bias detected in the claim's reasoning, or null.",
        },
        "bias_explanation": {
            "type": ["string", "null"],
            "description": "One sentence on how the bias shows up in this claim, or null.",
        },
    },
    "required": ["evidence", "bias", "bias_explanation"],
    "additionalProperties": False,
}


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
        # Schema-enforced rather than "please reply in JSON". This runs once
        # per claim, so a parse failure that fell back to a flat
        # "partial / 0.5" verdict used to quietly flatten a whole message's
        # scoring, and looked identical to genuine uncertainty.
        parsed = await generate_structured(
            instructions=_build_instructions(bias_category_id),
            input_text=input_text,
            schema=_SCHEMA,
            schema_name="claim_verification",
        )
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
            quote = item.get("quote")
            if isinstance(quote, str):
                quote = quote.strip()[:400] or None
            else:
                quote = None
            evidence_results.append(EvidenceVerification(label, score, quote))

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


# Second-level screening: only for claims that land in the gray_area tier on
# the first pass ("Output/Answer Veracity Scoring Framework" §"Automated AI
# Execution" -> "Targeted Blind Sampling"). This is a genuinely separate call
# from verify_claim, not a re-run of it - it never receives the first pass's
# score or label, so it can't just agree with itself. It is oriented around
# the framework's three Reconciliation Matrix scenarios: a fabricated/deepfake
# premise being missed, an accurate claim being underscored for informal or
# regional phrasing, or a genuinely developing topic that isn't wrong, just
# not settled yet.
_RECONCILIATION_INSTRUCTIONS = (
    "You are the second, independent reviewer for a claim an AI assistant made, which a first "
    "pass rated as unclear/gray-area. You do NOT know what the first reviewer concluded - form "
    "your own judgement from the claim and evidence alone.\n\n"
    "Decide which of these three patterns best fits:\n"
    '  "spoofed" - the claim mimics the format of something factual (e.g. a fabricated quote, a '
    "cloned/synthetic-sounding source, a manufactured statistic) but its core premise looks "
    "manufactured or unverifiable at the source.\n"
    '  "understated" - the claim is stated informally, colloquially, or in a regional/non-standard '
    "way, but the underlying factual content looks accurate and well-supported once the phrasing "
    "is set aside.\n"
    '  "genuinely_developing" - this is authentically gray: developing news, a speculative '
    "forecast, or a hypothesis that lacks long-run data, where no amount of re-reading the "
    "evidence resolves it further right now.\n\n"
    "Respond with ONLY a JSON object, no other text and no markdown fencing:\n"
    '{"pattern": "spoofed|understated|genuinely_developing", '
    '"note": "one plain-language sentence explaining the call, written for the person reading the '
    'answer"}'
)

_RECONCILIATION_SCHEMA = {
    "type": "object",
    "properties": {
        "pattern": {
            "type": "string",
            "enum": ["spoofed", "understated", "genuinely_developing"],
        },
        "note": {"type": "string"},
    },
    "required": ["pattern", "note"],
    "additionalProperties": False,
}


@dataclass
class ReconciliationResult:
    pattern: str
    note: str
    dynamic: bool


async def reconcile_gray_area(claim_text: str, evidence_texts: list[str]) -> ReconciliationResult:
    """Blind second-level review for a gray_area claim. Never raises - falls
    back to "genuinely_developing" (the safest read: leave the tier as-is,
    tag it dynamic) rather than block scoring.
    """
    if evidence_texts:
        evidence_block = "\n\n".join(
            f"EVIDENCE {i + 1}:\n{text}" for i, text in enumerate(evidence_texts)
        )
    else:
        evidence_block = "(no evidence was cited for this claim)"

    input_text = f"CLAIM:\n{claim_text}\n\n{evidence_block}"

    fallback = ReconciliationResult(
        pattern="genuinely_developing",
        note="Second-level review was inconclusive; treated as a genuinely developing topic.",
        dynamic=True,
    )

    try:
        parsed = await generate_structured(
            instructions=_RECONCILIATION_INSTRUCTIONS,
            input_text=input_text,
            schema=_RECONCILIATION_SCHEMA,
            schema_name="gray_area_reconciliation",
            fast=True,
        )
    except Exception:
        return fallback

    pattern = parsed.get("pattern")
    if pattern not in ("spoofed", "understated", "genuinely_developing"):
        return fallback

    # This note is our own prose and goes straight to the panel without
    # passing through the answer's clean_output pass, so it needs the dash
    # rule applied here or it arrives with the en dashes the model likes to
    # write ranges with ("28-35%"). Source quotes above are deliberately left
    # verbatim - misquoting a document in an evidence panel is a worse fault
    # than a typographic one.
    note = replace_dashes(parsed.get("note") or fallback.note)
    return ReconciliationResult(pattern=pattern, note=note, dynamic=pattern == "genuinely_developing")
