import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class ConversationCreate(BaseModel):
    workspace_id: uuid.UUID
    title: str | None = None


class ConversationOut(BaseModel):
    id: uuid.UUID
    workspace_id: uuid.UUID
    title: str | None
    default_mode: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class MessageCreate(BaseModel):
    content: str = Field(min_length=1)
    # Intentionally not required at the Pydantic level (see FR7): the router
    # validates this explicitly so a missing/invalid mode returns exactly 400,
    # not FastAPI's default 422 for a missing field.
    mode: str | None = None


class CitationOut(BaseModel):
    marker: int
    document_id: uuid.UUID
    document_filename: str
    excerpt: str
    relevance_score: float | None


class MessageOut(BaseModel):
    id: uuid.UUID
    role: str
    content: str | None
    mode_used: str
    confidence_score: float | None
    confidence_band: str | None
    avatar_expression: str | None
    avatar_gesture: str | None
    created_at: datetime
    citations: list[CitationOut] = []

    model_config = {"from_attributes": True}
