import uuid
from datetime import datetime

from pydantic import BaseModel


class SearchResultOut(BaseModel):
    message_id: uuid.UUID
    conversation_id: uuid.UUID
    conversation_title: str | None
    role: str
    content: str
    mode_used: str
    created_at: datetime
    rank: float
