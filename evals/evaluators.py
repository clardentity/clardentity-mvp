"""Deterministic checks, plus the one generic hook into the LLM judge.

Signature is fixed by Langfuse's experiment runner:
`evaluator(*, input, output, expected_output=None, metadata=None, **kw)`.
Each returns a single {"name","value","comment"} dict, a list of them, or an
empty list when the case doesn't apply to that evaluator - most evaluators
here are gated by `metadata["category"]` for exactly that reason, so the
Langfuse UI doesn't fill up with N/A scores on unrelated cases.

`value` is always 0/1 rather than True/False: Langfuse aggregates numeric
scores into a mean per evaluator per run, which is what turns "12 cases
passed" into a trend line across runs after a prompt change.
"""

from __future__ import annotations

from judge import judge

_VENDOR_WORDS = [
    "openai",
    "anthropic ",  # trailing space: avoids false-hit on "Anthropic AI" self-refs never occurring, but guards "Anthropic released"
    "anthropic.com",
    "gpt-",
    "gpt 5",
    "gpt5",
    "chatgpt",
    "claude ",
    "claude,",
    "claude.",
    "claude-",
    "sonnet",
    "opus",
    "haiku",
    " llama",
    "gemini",
    "mistral",
]

_MARKDOWN_MARKERS = ["**", "##", "<strong>", "\n* ", "—", "–"]

_SELF_LABEL_PHRASES = ["unsupported", "unverified", "no citation", "[no source]"]

_VALID_CLAIM_TIERS = {
    "verifiable_fact",
    "probable_fact",
    "gray_area",
    "distorted",
    "fabricated",
    "full",
    "moderate",
    "partial",
    "none",
    "unsupported",
}


def _text(output: dict | None) -> str:
    return (output or {}).get("answer_text") or ""


def ev_identity_no_vendor_leak(*, input, output, expected_output=None, metadata=None, **kw):
    if (metadata or {}).get("category") not in {"identity", "companion_nickname"}:
        return []
    lower = _text(output).lower()
    hit = next((w for w in _VENDOR_WORDS if w in lower), None)
    return {
        "name": "identity_no_vendor_leak",
        "value": 0 if hit else 1,
        "comment": f"leaked {hit!r}" if hit else "no vendor/model name present",
    }


def ev_context_gate_correct(*, input, output, expected_output=None, metadata=None, **kw):
    meta = metadata or {}
    if "expect_context_question" not in meta:
        return []
    expected = meta["expect_context_question"]
    fired = bool((output or {}).get("context_question_fired"))
    ok = fired == expected
    return {
        "name": "context_gate_correct",
        "value": 1 if ok else 0,
        "comment": f"expected fired={expected}, got fired={fired}",
    }


def ev_decision_teaching_set(*, input, output, expected_output=None, metadata=None, **kw):
    if (metadata or {}).get("category") != "decision_teaching_set":
        return []
    review = (output or {}).get("decision_review") or {}
    suggestions = review.get("suggestions") or []
    n = len(suggestions)
    sound_positions = [i for i, s in enumerate(suggestions) if s.get("sound")]
    unsound_missing_bias = [
        s.get("decision", "?") for s in suggestions if not s.get("sound") and not s.get("bias_name")
    ]
    return [
        {
            "name": "teaching_set_size_3_to_5",
            "value": 1 if 3 <= n <= 5 else 0,
            "comment": f"{n} suggestions returned",
        },
        {
            "name": "teaching_set_exactly_one_sound",
            "value": 1 if len(sound_positions) == 1 else 0,
            "comment": f"{len(sound_positions)} marked sound (want exactly 1)",
        },
        {
            "name": "teaching_set_sound_one_leads",
            "value": 1 if sound_positions and sound_positions[0] == 0 else 0,
            "comment": f"sound entry at position {sound_positions[0] if sound_positions else 'none'}",
        },
        {
            "name": "teaching_set_unsound_entries_named",
            "value": 0 if unsound_missing_bias else 1,
            "comment": (
                f"unnamed: {unsound_missing_bias}" if unsound_missing_bias else "every unsound entry has a bias name"
            ),
        },
    ]


def ev_no_bias_watch_prose(*, input, output, expected_output=None, metadata=None, **kw):
    if (metadata or {}).get("category") != "decision_teaching_set":
        return []
    hit = "bias watch" in _text(output).lower()
    return {"name": "no_bias_watch_prose_section", "value": 0 if hit else 1}


def ev_plain_text_no_markdown(*, input, output, expected_output=None, metadata=None, **kw):
    text = _text(output)
    if not text:
        return []
    hits = [p for p in _MARKDOWN_MARKERS if p in text]
    return {
        "name": "plain_text_no_markdown",
        "value": 0 if hits else 1,
        "comment": f"found {hits}" if hits else "clean",
    }


def ev_no_self_labeling_in_prose(*, input, output, expected_output=None, metadata=None, **kw):
    text = _text(output)
    if not text:
        return []
    lower = text.lower()
    hits = [w for w in _SELF_LABEL_PHRASES if w in lower]
    return {
        "name": "no_self_labeling_in_prose",
        "value": 0 if hits else 1,
        "comment": f"found {hits}" if hits else "clean",
    }


def ev_claims_have_valid_tier(*, input, output, expected_output=None, metadata=None, **kw):
    claims = (output or {}).get("claims") or []
    if not claims:
        return []
    bad = sorted({c.get("entailment_label") for c in claims} - _VALID_CLAIM_TIERS)
    return {
        "name": "claims_have_valid_tier",
        "value": 0 if bad else 1,
        "comment": f"invalid tiers: {bad}" if bad else f"{len(claims)} claims, all valid tiers",
    }


def ev_llm_judge_rubric(*, input, output, expected_output=None, metadata=None, **kw):
    """The catch-all for anything that needs a reader rather than a regex.
    Fires whenever a case carries a `rubric` in its metadata."""
    rubric = (metadata or {}).get("rubric")
    if not rubric:
        return []
    context_lines = [f"User's message (mode={input.get('mode')}): {input.get('message')}"]
    prior = (output or {}).get("clarifier_context")
    if prior:
        context_lines.append(prior)
    result = judge(rubric, _text(output), context="\n".join(context_lines))
    return {
        "name": "llm_judge_rubric",
        "value": 1 if result.get("pass") else 0,
        "comment": result.get("reason", ""),
    }


def ev_clarifier_fired_and_answerable(*, input, output, expected_output=None, metadata=None, **kw):
    if (metadata or {}).get("category") != "clarifier_continuity":
        return []
    out = output or {}
    if not out.get("clarifier_fired"):
        # Whether the clarifier fires at all is the model's own judgement call
        # ("frequently null, and should be") - not firing on one message isn't
        # a policy violation, so this is neutral rather than a failure. The
        # continuity check below only makes sense when it did fire.
        return {
            "name": "clarifier_continuity",
            "value": 1,
            "comment": "clarifier did not fire on this message - nothing to check",
        }
    return []  # the llm_judge_rubric evaluator covers the fired case, using clarifier_context


ALL_EVALUATORS = [
    ev_identity_no_vendor_leak,
    ev_context_gate_correct,
    ev_decision_teaching_set,
    ev_no_bias_watch_prose,
    ev_plain_text_no_markdown,
    ev_no_self_labeling_in_prose,
    ev_claims_have_valid_tier,
    ev_llm_judge_rubric,
    ev_clarifier_fired_and_answerable,
]
