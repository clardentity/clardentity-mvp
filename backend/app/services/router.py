from app.models import COGNITIVE_MODES


class InvalidModeError(ValueError):
    """Raised when a request is missing `mode` or sends a value outside the
    four fixed cognitive modes. There is intentionally no fallback or
    auto-detection (§7.2) - the caller should turn this into an HTTP 400.
    """


REASONING_LENSES: tuple[str, ...] = (
    "analytical",
    "critical",
    "creative",
    "divergent",
    "convergent",
    "abstract",
    "concrete",
    "associative",
    "linear",
    "non_linear",
    "meta_cognitive",
)


class InvalidReasoningLensError(ValueError):
    pass


def validate_mode(mode: str | None) -> str:
    if mode not in COGNITIVE_MODES:
        raise InvalidModeError(
            "mode is required and must be one of: " + ", ".join(COGNITIVE_MODES)
        )
    return mode


def validate_reasoning_lens(reasoning_lens: str | None) -> str | None:
    """§7.5: an optional, purely user-driven sub-selector for Thinking mode.
    Returns None if unset; raises if set to something unrecognized.
    """
    if reasoning_lens is None:
        return None
    if reasoning_lens not in REASONING_LENSES:
        raise InvalidReasoningLensError(
            "reasoning_lens must be one of: " + ", ".join(REASONING_LENSES)
        )
    return reasoning_lens
