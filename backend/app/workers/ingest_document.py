import asyncio
import uuid

from app.core.celery_app import celery_app
from app.db.session import WorkerSessionLocal
from app.models import Document, DocumentChunk
from app.services.document_ingestion import chunk_text, extract_pages
from app.services.openai_client import embed_texts
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
            pages = extract_pages(file_bytes, document.file_type or "txt")

            entries: list[tuple[int | None, str]] = [
                (page_number, chunk)
                for page_number, page_text in pages
                for chunk in chunk_text(page_text)
                if chunk.strip()
            ]

            if not entries:
                document.status = "failed"
                await db.commit()
                return

            embeddings = await embed_texts([content for _, content in entries])

            for index, ((page_number, content), embedding) in enumerate(zip(entries, embeddings)):
                db.add(
                    DocumentChunk(
                        document_id=document.id,
                        chunk_index=index,
                        content=content,
                        embedding=embedding,
                        page_number=page_number,
                    )
                )

            document.status = "processed"
            await db.commit()
        except Exception:
            document.status = "failed"
            await db.commit()
            raise
