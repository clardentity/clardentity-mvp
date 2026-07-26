import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_workspace_member
from app.core.config import settings
from app.db.session import get_db
from app.models import Document, DocumentChunk, User
from app.schemas.document import DocumentDetailOut, DocumentOut, DocumentUploadOut
from app.services.storage import delete_file, upload_file
from app.workers.ingest_document import ingest_document_task

router = APIRouter(prefix="/documents", tags=["documents"])

ALLOWED_EXTENSIONS: dict[str, str] = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "txt": "text/plain",
}


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
