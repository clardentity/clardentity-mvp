from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings

engine = create_async_engine(settings.database_url, pool_pre_ping=True)

AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)

# Celery tasks each run inside their own `asyncio.run()` call — a fresh event
# loop every time. A pooled asyncpg connection checked out under one task's
# loop becomes unusable (and unclosable) once that loop is gone, so Celery
# workers get a separate NullPool engine: every checkout opens a connection
# and closes it within the same task's loop, nothing persists across tasks.
worker_engine = create_async_engine(settings.database_url, poolclass=NullPool)

WorkerSessionLocal = async_sessionmaker(worker_engine, expire_on_commit=False)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session
