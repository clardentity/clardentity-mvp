from app.models import Message
from app.services.retrieval import RetrievedChunk

# Section 7.1 "System Prompt Emphasis" per mode.
MODE_INSTRUCTIONS: dict[str, str] = {
    "knowing": (
        "Purpose: retrieve and state facts precisely and briefly, citing sources when "
        "they're available. Prefer a direct answer over a long preamble."
    ),
    "thinking": (
        "Purpose: structured, step-by-step reasoning. Show your intermediate logic as "
        "a numbered reasoning chain, then state a clear conclusion."
    ),
    "decision": (
        "Purpose: compare options and recommend one. Enumerate the options and the "
        "criteria you're weighing, lay out the tradeoffs, then give a clear "
        "recommendation with its rationale."
    ),
    "learning": (
        "Purpose: teach and transform knowledge for the user. Adapt your explanation to "
        "the user's apparent level and use analogies where helpful. Do not end "
        "with a quiz question - checking understanding is handled outside your "
        "answer."
    ),
}

# Appendix A.2 / Section 7.5 - entirely user-driven, Thinking mode only. The
# system never infers one of these automatically.
REASONING_LENS_INSTRUCTIONS: dict[str, str] = {
    "analytical": "Break the problem into smaller parts and address each systematically before concluding.",
    "critical": "Evaluate the claim rationally and skeptically; identify assumptions and weak points before accepting any conclusion.",
    "creative": "Generate unique, original angles on the problem rather than the most obvious answer.",
    "divergent": "Generate a wide variety of distinct possibilities before narrowing down.",
    "convergent": "Apply logic to converge on a single, well-justified answer.",
    "abstract": "Reason about the underlying concept independent of a specific example.",
    "concrete": "Ground the answer in specific, tangible, observable details.",
    "associative": "Draw connections between this problem and seemingly unrelated ideas that might illuminate it.",
    "linear": "Proceed step-by-step in strict sequential order.",
    "non_linear": "Explore connections out of sequence, following whichever thread seems most productive.",
    "meta_cognitive": "Explicitly narrate the reasoning process itself, not just the conclusion.",
}


def build_system_instructions(
    mode: str,
    reasoning_lens: str | None = None,
    bias_guidance: str | None = None,
    profile_block: str | None = None,
) -> str:
    parts = [
        "You are Clardentity, one cognitive companion that works in four modes. "
        f"You are currently in {mode} mode, selected explicitly by the user.",
        MODE_INSTRUCTIONS[mode],
    ]

    # Accumulated across sessions so the companion knows who it is talking to.
    if profile_block:
        parts.append(profile_block)

    if mode == "thinking":
        if reasoning_lens and REASONING_LENS_INSTRUCTIONS.get(reasoning_lens):
            parts.append(
                f"Reasoning lens ({reasoning_lens}, chosen explicitly by the user): "
                f"{REASONING_LENS_INSTRUCTIONS[reasoning_lens]}"
            )
        else:
            # Nobody is asked to pick one any more. Choosing well is part of
            # thinking well, and a dropdown of eleven epistemic stances is a
            # question most people can't answer about a problem they haven't
            # worked through yet.
            menu = "\n".join(
                f"- {name}: {text}" for name, text in REASONING_LENS_INSTRUCTIONS.items()
            )
            parts.append(
                "Choose the reasoning approach that actually fits this problem, "
                "and apply it. Do not name it or announce the choice - just "
                "reason that way.\n" + menu
            )

    # Decision mode only: the domain-specific bias watch-list (§ bias taxonomy).
    if bias_guidance:
        parts.append(bias_guidance)

    parts.append(
        # No instruction to ask anything. Clarifying questions are a separate
        # structured call (services/clarifier.py) precisely because a single
        # generation told to answer *and* to ask ends up doing both in prose.
        "Answer what was asked. Do not end with questions or offers to the "
        "user - no 'Quick check: can you...', no 'Would you like me to...', "
        "no 'If you want, I can do A, B or C'. If something genuinely "
        "unstated would change your answer, say what you assumed and carry "
        "on.\n\n"
        "Write in plain text. No Markdown and no HTML: no **bold**, no #, no "
        "<strong>, no bullet characters other than a plain hyphen. The reader "
        "sees your output verbatim, so any markup arrives as literal "
        "characters in the middle of a sentence. Use short paragraphs and "
        "sentence structure for emphasis instead.\n"
        "Use hyphens, never em dashes or en dashes.\n"
        "You must ground factual claims in the provided CONTEXT block when it is relevant.\n"
        "Break your answer into discrete, independently-checkable claims. Tag every claim "
        'with a marker <claim id="n">...</claim> and, inline within it, cite supporting '
        "context with [n] referring to the numbered CONTEXT item. A single claim may cite "
        "more than one source - use multiple [n] markers in that case.\n"
        "If no supporting context exists for a claim, say so explicitly rather than "
        "inventing a source, and leave that claim uncited so it is correctly marked "
        "Unsupported rather than guessing at a citation.\n"
        "Number claims sequentially starting at 1. Every sentence of your response must be "
        "inside some <claim> tag - do not leave prose outside of one."
    )

    return "\n\n".join(parts)


def build_context_block(chunks: list[RetrievedChunk], web_sources: list | None = None) -> str:
    """Numbered context the model cites with [n] markers.

    Documents come first and keep markers 1..N so their numbering is unaffected
    by whether a web search happened. Web sources continue the sequence, and
    are labelled with publisher and date because those are what a reader needs
    to judge a link - a filename means "you uploaded this", a URL means
    "someone on the internet wrote this", and the two do not deserve the same
    trust by default.
    """
    parts = [
        f"[{i}] (from {rc.document.filename}): {rc.chunk.content}"
        for i, rc in enumerate(chunks, start=1)
    ]
    for i, source in enumerate(web_sources or [], start=len(chunks) + 1):
        origin = source.publisher or source.url
        dated = f", {source.date}" if source.date else ""
        parts.append(f"[{i}] (web - {origin}{dated}): {source.excerpt}")

    if not parts:
        return "(no relevant workspace documents found)"
    return "\n\n".join(parts)


def build_conversation_input(
    context_block: str,
    memory_summary: str | None,
    history: list[Message],
    current_message: str,
) -> str:
    """`history` is the verbatim short-term window (oldest-first); anything
    older than that is folded into `memory_summary` by memory_service's
    rolling-summary Celery task (§13).
    """
    lines = [f"CONTEXT:\n{context_block}", "", "CONVERSATION_HISTORY:"]
    if memory_summary:
        lines.append(f"(summary of earlier turns) {memory_summary}")
    lines += [f"{'User' if m.role == 'user' else 'Assistant'}: {m.content}" for m in history]
    lines.append("")
    lines.append(f"USER:\n{current_message}")
    return "\n".join(lines)
