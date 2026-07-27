import redis.asyncio as redis
from fastapi import HTTPException, status

from app.core.config import settings

_redis = redis.from_url(settings.redis_url)


async def check_rate_limit(key: str, max_requests: int, window_seconds: int) -> None:
    """§14/§15: rate limiting on /auth and /chat to mitigate abuse. Fixed
    window counter in Redis - simple and shared across worker processes.
    """
    full_key = f"ratelimit:{key}"
    current = await _redis.incr(full_key)
    if current == 1:
        await _redis.expire(full_key, window_seconds)
    if current > max_requests:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests - please slow down and try again shortly",
        )
