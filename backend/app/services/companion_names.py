"""What the user calls their companion, per mode.

One name per cognitive mode, chosen by the user: "Nick" in learning, "Gale" in
knowing. It is stored on the user rather than in a table because it is at most
four short strings and is always read whole with them.

An unnamed mode is the normal case, not a missing value - the mode's own label
is a perfectly good name for it, so absent keys stay absent rather than being
backfilled with defaults nobody chose.
"""

from app.models.conversation import COGNITIVE_MODES

MAX_NAME_CHARS = 24


def clean_names(raw: object) -> dict[str, str]:
    """Whatever came in, reduced to names we will actually show.

    Unknown modes are dropped rather than rejected: this is a display label,
    and failing someone's whole profile save because a fifth mode appeared in
    the payload would be a worse trade than ignoring it.
    """
    if not isinstance(raw, dict):
        return {}
    cleaned: dict[str, str] = {}
    for mode, name in raw.items():
        if mode not in COGNITIVE_MODES or not isinstance(name, str):
            continue
        # Collapse whitespace so a name cannot be padded into a fake layout,
        # and strip control characters that would break the mode pill.
        text = " ".join(name.split())[:MAX_NAME_CHARS].strip()
        if text:
            cleaned[mode] = text
    return cleaned


def name_for(names: dict | None, mode: str) -> str | None:
    return (names or {}).get(mode) or None
