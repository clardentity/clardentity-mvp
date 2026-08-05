import asyncio
import uuid

from app.core.celery_app import celery_app
from app.db.session import WorkerSessionLocal
from app.services.profile_service import rebuild_profile


@celery_app.task(name="rebuild_profile")
def rebuild_profile_task(user_id: str) -> None:
    asyncio.run(_rebuild(uuid.UUID(user_id)))


async def _rebuild(user_id: uuid.UUID) -> None:
    async with WorkerSessionLocal() as db:
        await rebuild_profile(db, user_id)
