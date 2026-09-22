import asyncio
import uuid

from app.core.celery_app import celery_app
from app.db.session import WorkerSessionLocal
from app.models import Document
from app.services.document_ingestion import build_chunks
from app.services.storage import download_file


@celery_app.task(name="ingest_document")
def ingest_document_task(document_id: str) -> None:
    asyncio.run(_ingest_document(uuid.UUID(document_id)))


async def _ingest_document(document_id: uuid.UUID) -> None:
    async with WorkerSessionLocal() as db:
        document = await db.get(Document, document_id)
        if document is None:
            return

        try:
            file_bytes = download_file(document.storage_path)
            chunks = await build_chunks(document.id, file_bytes, document.file_type or "txt")
            if not chunks:
                document.status = "failed"
                await db.commit()
                return
            for chunk in chunks:
                db.add(chunk)
            document.status = "processed"
            await db.commit()
        except Exception:
            document.status = "failed"
            await db.commit()
            raise
