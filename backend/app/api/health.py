from typing import Literal

import redis.asyncio as redis
from fastapi import APIRouter
from sqlalchemy import text

from app.core.config import settings
from app.db.session import AsyncSessionLocal
from app.services.storage import get_s3_client

router = APIRouter(tags=["health"])

DependencyStatus = Literal["ok", "error"]


async def _check_database() -> DependencyStatus:
    try:
        async with AsyncSessionLocal() as session:
            await session.execute(text("SELECT 1"))
        return "ok"
    except Exception:
        return "error"


async def _check_redis() -> DependencyStatus:
    client = redis.from_url(settings.redis_url)
    try:
        await client.ping()
        return "ok"
    except Exception:
        return "error"
    finally:
        await client.aclose()


def _check_storage() -> DependencyStatus:
    try:
        client = get_s3_client()
        client.head_bucket(Bucket=settings.s3_bucket)
        return "ok"
    except Exception:
        return "error"


@router.get("/health")
async def health_check():
    dependencies: dict[str, DependencyStatus] = {
        "database": await _check_database(),
        "redis": await _check_redis(),
        "storage": _check_storage(),
    }
    overall: DependencyStatus = "ok" if all(v == "ok" for v in dependencies.values()) else "error"
    # Which web search is in play - the one operational fact that is not
    # visible from outside and that changes what answers look like: without
    # a Tavily key the model's own (slow) search tool is used, weather and
    # price questions mostly miss their budget, and answers say "I don't
    # have live data". Reported so a deploy can be checked from a browser.
    from app.services.web_research import tavily_available

    return {
        "status": overall,
        "dependencies": dependencies,
        "search": "tavily" if tavily_available() else "model-tool",
    }
