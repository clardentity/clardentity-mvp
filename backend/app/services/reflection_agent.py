from app.services.claim_parser import extract_claims
from app.services.anthropic_client import generate_text
from app.services.prompt_builder import MODE_INSTRUCTIONS

_NO_CHANGES_SENTINEL = "NO_CHANGES_NEEDED"

_INSTRUCTIONS_TEMPLATE = (
    "You are reviewing a draft response before it's shown to the user. It was generated "
    "in {mode} mode: {mode_purpose}\n\n"
    "Critique the draft for internal consistency (no contradictions), completeness (does "
    "it fully address the request), and whether its shape matches what {mode} mode should "
    "produce.\n\n"
    f"If the draft is already good, respond with exactly: {_NO_CHANGES_SENTINEL}\n"
    "If it needs improvement, respond with ONLY the complete revised draft, preserving the "
    'exact <claim id="n">...</claim> tag structure and [n] citation markers from the '
    "original - do not add, remove, or renumber claims or citations, only improve the "
    "prose inside them and fix any consistency/completeness issues."
)


async def reflect_and_revise(mode: str, draft_text: str) -> tuple[str, bool]:
    """§9.1 step 2: critiques the draft and may request one revision pass.
    Returns (final_text, was_revised). Never raises - a reflection failure
    falls back to the original draft rather than blocking the response, and
    a revision that breaks the claim structure is discarded for the same
    reason.
    """
    instructions = _INSTRUCTIONS_TEMPLATE.format(mode=mode, mode_purpose=MODE_INSTRUCTIONS[mode])

    try:
        result = await generate_text(
            instructions=instructions, input_text=f"DRAFT:\n{draft_text}", fast=True
        )
    except Exception:
        return draft_text, False

    result = result.strip()
    if not result or result == _NO_CHANGES_SENTINEL:
        return draft_text, False

    original_claims = extract_claims(draft_text)
    revised_claims = extract_claims(result)
    if len(revised_claims) != len(original_claims):
        # The revision mangled the claim structure - safer to keep the draft.
        return draft_text, False

    return result, True
