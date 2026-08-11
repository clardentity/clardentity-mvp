import uuid
from datetime import datetime

from pydantic import BaseModel


class DocumentOut(BaseModel):
    id: uuid.UUID
    filename: str
    file_type: str | None
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class DocumentDetailOut(DocumentOut):
    chunk_count: int


class DocumentUploadOut(BaseModel):
    document_id: uuid.UUID
    status: str


class AttachmentHitOut(BaseModel):
    """One passage inside an attachment that matched a search."""

    document_id: uuid.UUID
    filename: str
    chunk_index: int
    page_number: int | None = None
    excerpt: str
    #: True when this passage was actually cited in the conversation being
    #: searched. Only ever set by the conversation-scoped search.
    cited_here: bool = False


class AttachmentSearchOut(BaseModel):
    query: str
    #: Null for a room-wide search; set when scoped to one conversation.
    conversation_id: uuid.UUID | None = None
    total: int
    hits: list[AttachmentHitOut]
