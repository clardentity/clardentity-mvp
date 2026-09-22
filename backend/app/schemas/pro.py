from pydantic import BaseModel


class ProInterestRequest(BaseModel):
    #: Which locked model was clicked. Free text from the client, narrowed to
    #: the known set server-side.
    model: str | None = None


class PreviewStatus(BaseModel):
    """What the plans dialog and the mode picker need to know: whether the
    paid-tier companions are open for this account, which ones, and how much
    of today's allowance is left."""

    unlocked: bool
    modes: list[str]
    daily_limit: int
    used_today: int
    remaining_today: int
