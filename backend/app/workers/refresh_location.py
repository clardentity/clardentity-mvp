import asyncio
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.core.celery_app import celery_app
from app.db.session import WorkerSessionLocal
from app.models import User
from app.services.geolocation import resolve

# Re-resolving on every sign-in would burn a third-party quota to learn the
# same thing repeatedly. A fortnight is short enough to notice someone moving
# and long enough that a daily user costs two lookups a month.
STALE_AFTER = timedelta(days=14)


@celery_app.task(name="refresh_location")
def refresh_location_task(user_id: str, ip: str) -> None:
    """Out-of-band on purpose: sign-in must never wait on a third party, and a
    failed lookup must never be something the user can perceive.
    """
    asyncio.run(_run(uuid.UUID(user_id), ip))


async def _run(user_id: uuid.UUID, ip: str) -> None:
    async with WorkerSessionLocal() as db:
        user = await db.scalar(select(User).where(User.id == user_id))
        if user is None:
            return

        fresh_enough = (
            user.location_updated_at is not None
            and datetime.now(timezone.utc) - user.location_updated_at < STALE_AFTER
        )
        if fresh_enough:
            return

        located = await resolve(ip)
        if located is None:
            return

        user.location_label = located["label"]
        user.location_country = located["country"]
        user.location_timezone = located["timezone"]
        user.location_updated_at = datetime.now(timezone.utc)
        await db.commit()
