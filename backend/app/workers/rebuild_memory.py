import asyncio
import uuid

from app.core.celery_app import celery_app
from app.db.session import WorkerSessionLocal
from app.services.memory_service import rebuild_memory_summary


@celery_app.task(name="rebuild_memory")
def rebuild_memory_task(conversation_id: str) -> None:
    asyncio.run(_rebuild(uuid.UUID(conversation_id)))


async def _rebuild(conversation_id: uuid.UUID) -> None:
    async with WorkerSessionLocal() as db:
        await rebuild_memory_summary(db, conversation_id)
