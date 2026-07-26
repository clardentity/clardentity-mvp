from pydantic import BaseModel

from app.schemas.chat import ClaimOut


class ValidationOut(BaseModel):
    score: float | None
    band: str | None
    claims: list[ClaimOut]
