from app.models import Message

# Section 7.1 "System Prompt Emphasis" per mode. Retrieval grounding, claim
# tagging, and citation instructions are added on top of this in later phases
# (RAG in Phase 4, per-claim validation in Phase 6).
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
        f"{MODE_INSTRUCTIONS[mode]}"
    )


def build_conversation_input(history: list[Message], current_message: str) -> str:
    """`history` is prior turns oldest-first. Phase 3 includes them verbatim;
    Phase 5 replaces older turns with a rolling summary once the window grows.
    """
    lines = [
        f"{'User' if m.role == 'user' else 'Assistant'}: {m.content}" for m in history
    ]
    lines.append(f"User: {current_message}")
    return "\n\n".join(lines)
