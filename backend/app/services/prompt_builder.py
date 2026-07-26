from app.models import Message
from app.services.retrieval import RetrievedChunk

# Section 7.1 "System Prompt Emphasis" per mode. Full <claim> tagging is added
# on top of this in Phase 6; this is a simpler precursor that just asks for
# plain [n] citations.
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
        "the user's apparent level, use analogies where helpful, and offer an optional "
        "check-for-understanding (e.g. a short quiz question) at the end."
    ),
}


def build_system_instructions(mode: str) -> str:
    return (
        f"You are Clardentity operating in {mode} mode (selected explicitly by the user).\n\n"
        f"{MODE_INSTRUCTIONS[mode]}\n\n"
        "You must ground factual claims in the provided CONTEXT block when it is relevant. "
        "Cite supporting context inline with [n], where n is the numbered CONTEXT item you're "
        "drawing from. If no supporting context exists for a claim, say so explicitly rather "
        "than inventing a source."
    )


def build_context_block(chunks: list[RetrievedChunk]) -> str:
    if not chunks:
        return "(no relevant workspace documents found)"
    return "\n\n".join(
        f"[{i}] (from {rc.document.filename}): {rc.chunk.content}"
        for i, rc in enumerate(chunks, start=1)
    )


def build_conversation_input(
    context_block: str, history: list[Message], current_message: str
) -> str:
    """`history` is prior turns oldest-first. Phase 3 includes them verbatim;
    Phase 5 replaces older turns with a rolling summary once the window grows.
    """
    lines = [f"CONTEXT:\n{context_block}", "", "CONVERSATION_HISTORY:"]
    lines += [f"{'User' if m.role == 'user' else 'Assistant'}: {m.content}" for m in history]
    lines.append("")
    lines.append(f"USER:\n{current_message}")
    return "\n".join(lines)
