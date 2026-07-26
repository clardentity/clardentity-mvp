from datetime import datetime

from pydantic import BaseModel


class MemoryOut(BaseModel):
    summary: str | None
    last_updated: datetime | None
