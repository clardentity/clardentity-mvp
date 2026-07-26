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
