from dataclasses import dataclass

# §7.1 / §8.4 - gesture is determined purely by mode_used.
GESTURE_BY_MODE: dict[str, str] = {
    "knowing": "presenting",
    "thinking": "chin_stroke",
    "decision": "weighing_scales",
    "learning": "open_hand_explaining",
}

# §8.4 - base expression by confidence band.
EXPRESSION_BY_BAND: dict[str, str] = {
    "Likely Fact": "confident",
    "Plausible": "thoughtful",
    "Needs Verification": "cautious",
}

DISTORTION_OVERRIDE_EXPRESSION = "concerned"


@dataclass
class AvatarCue:
    expression: str
    gesture: str


def compute_avatar_cue(
    mode: str, band: str, distortion_applied: bool, gesture_map: dict[str, str] | None = None
) -> AvatarCue:
    """§8.4: two independent signals combine once confidence scoring
    completes. A distortion flag overrides the expression to "concerned"
    regardless of the numeric band - a response that reasons via wishful or
    magical thinking should never look fully confident. `gesture_map` is the
    §11.8/FR14 admin override; falls back to the spec default per mode.
    """
    gesture = (gesture_map or GESTURE_BY_MODE).get(mode, GESTURE_BY_MODE.get(mode, "presenting"))
    expression = (
        DISTORTION_OVERRIDE_EXPRESSION
        if distortion_applied
        else EXPRESSION_BY_BAND.get(band, "thoughtful")
    )
    return AvatarCue(expression=expression, gesture=gesture)
