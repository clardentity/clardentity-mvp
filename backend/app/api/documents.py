import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import distinct, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_workspace_member
from app.core.config import settings
from app.db.session import get_db
from app.models import (
    Citation,
    Conversation,
    Document,
    DocumentChunk,
    Message,
    User,
)
from app.schemas.document import (
    AttachmentHitOut,
    AttachmentSearchOut,
    DocumentDetailOut,
    DocumentOut,
    DocumentUploadOut,
)
from app.services.storage import delete_file, upload_file
from app.workers.ingest_document import ingest_document_task

router = APIRouter(prefix="/documents", tags=["documents"])

ALLOWED_EXTENSIONS: dict[str, str] = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "txt": "text/plain",
}


_EXCERPT_RADIUS = 140


def _excerpt_around(content: str, term: str) -> str:
    """A window centred on the match, not the first 300 characters.

    A hit whose excerpt doesn't contain the thing you searched for looks like
    a bug, and on a long chunk the match is usually nowhere near the start.
    """
    position = content.lower().find(term.lower())
    if position == -1:
        return content[: _EXCERPT_RADIUS * 2].strip()
    start = max(0, position - _EXCERPT_RADIUS)
    end = min(len(content), position + len(term) + _EXCERPT_RADIUS)
    return ("…" if start else "") + content[start:end].strip() + ("…" if end < len(content) else "")


@router.post("/upload", response_model=DocumentUploadOut, status_code=status.HTTP_201_CREATED)
async def upload_document(
    workspace_id: uuid.UUID = Form(...),
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DocumentUploadOut:
    await require_workspace_member(db, workspace_id, current_user.id)

    extension = (file.filename or "").rsplit(".", 1)[-1].lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported file type. Allowed: pdf, docx, txt",
        )

    contents = await file.read()
    max_bytes = settings.max_upload_size_mb * 1024 * 1024
    if len(contents) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File exceeds the {settings.max_upload_size_mb}MB limit",
        )

    document = Document(
        workspace_id=workspace_id,
        filename=file.filename or "untitled",
        file_type=extension,
        status="uploading",
        uploaded_by=current_user.id,
    )
    db.add(document)
    await db.flush()

    storage_key = f"{workspace_id}/{document.id}/{document.filename}"
    upload_file(storage_key, contents, ALLOWED_EXTENSIONS[extension])

    document.storage_path = storage_key
    document.status = "processing"
    await db.commit()
    await db.refresh(document)

    ingest_document_task.delay(str(document.id))

    return DocumentUploadOut(document_id=document.id, status=document.status)


@router.get("/search", response_model=AttachmentSearchOut)
async def search_attachments(
    workspace_id: uuid.UUID,
    q: str,
    conversation_id: uuid.UUID | None = None,
    limit: int = 25,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AttachmentSearchOut:
    """Find a passage inside your attachments.

    Two scopes, because they answer different questions. Without
    `conversation_id` this searches everything in the room - "where did I read
    that?". With one, it searches only the attachments that conversation
    actually cited - "what was this answer built on?" - which is a much
    smaller haystack and the one you want when you are auditing a reply.

    Deliberately literal matching rather than the embedding search used for
    retrieval. Someone typing into a search box is usually looking for a
    phrase they remember, and semantic nearest-neighbour is the wrong tool for
    recalling an exact wording.
    """
    await require_workspace_member(db, workspace_id, current_user.id)

    term = q.strip()
    if not term:
        return AttachmentSearchOut(
            query=q, conversation_id=conversation_id, total=0, hits=[]
        )

    cited_chunk_ids: set[uuid.UUID] = set()
    if conversation_id is not None:
        # Ownership of the conversation is checked by the join to workspace_id
        # below; a conversation in someone else's room yields no chunks.
        rows = await db.execute(
            select(distinct(Citation.chunk_id))
            .join(Message, Message.id == Citation.message_id)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .where(
                Message.conversation_id == conversation_id,
                Conversation.workspace_id == workspace_id,
                Citation.chunk_id.isnot(None),
            )
        )
        cited_chunk_ids = {r[0] for r in rows.all()}
        if not cited_chunk_ids:
            return AttachmentSearchOut(
                query=term, conversation_id=conversation_id, total=0, hits=[]
            )

    conditions = [
        Document.workspace_id == workspace_id,
        or_(
            DocumentChunk.content.ilike(f"%{term}%"),
            Document.filename.ilike(f"%{term}%"),
        ),
    ]
    if cited_chunk_ids:
        conditions.append(DocumentChunk.id.in_(cited_chunk_ids))

    rows = await db.execute(
        select(DocumentChunk, Document.filename)
        .join(Document, Document.id == DocumentChunk.document_id)
        .where(*conditions)
        .order_by(Document.created_at.desc(), DocumentChunk.chunk_index)
        .limit(min(limit, 100))
    )

    hits = [
        AttachmentHitOut(
            document_id=chunk.document_id,
            filename=filename,
            chunk_index=chunk.chunk_index,
            page_number=chunk.page_number,
            excerpt=_excerpt_around(chunk.content, term),
            cited_here=chunk.id in cited_chunk_ids,
        )
        for chunk, filename in rows.all()
    ]
    return AttachmentSearchOut(
        query=term, conversation_id=conversation_id, total=len(hits), hits=hits
    )


@router.get("", response_model=list[DocumentOut])
async def list_documents(
    workspace_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[DocumentOut]:
    await require_workspace_member(db, workspace_id, current_user.id)

    rows = await db.execute(
        select(Document)
        .where(Document.workspace_id == workspace_id)
        .order_by(Document.created_at.desc())
    )
    return [DocumentOut.model_validate(d) for d in rows.scalars().all()]


@router.get("/{document_id}", response_model=DocumentDetailOut)
async def get_document(
    document_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> DocumentDetailOut:
    document = await db.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    await require_workspace_member(db, document.workspace_id, current_user.id)

    chunk_count = await db.scalar(
        select(func.count()).select_from(DocumentChunk).where(DocumentChunk.document_id == document_id)
    )

    return DocumentDetailOut(
        id=document.id,
        filename=document.filename,
        file_type=document.file_type,
        status=document.status,
        created_at=document.created_at,
        chunk_count=chunk_count or 0,
    )


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    document_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    document = await db.get(Document, document_id)
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    await require_workspace_member(db, document.workspace_id, current_user.id)

    if document.storage_path:
        delete_file(document.storage_path)
    await db.delete(document)
    await db.commit()
