import logging

import redis.asyncio as redis
from fastapi import HTTPException, status

from app.core.config import settings

logger = logging.getLogger("clardentity.rate_limit")

_redis = redis.from_url(settings.redis_url)


async def check_rate_limit(key: str, max_requests: int, window_seconds: int) -> None:
    """§14/§15: rate limiting on /auth and /chat to mitigate abuse. Fixed
    window counter in Redis - simple and shared across worker processes.

    Fails open. This gates register, login, refresh, password reset, realtime
    session, chat send, and audio - effectively the whole product - and an
    unhandled Redis error here previously turned into a bare 500 on every one
    of them. A rate limiter that takes the product down when its own
    dependency is unavailable has the failure mode backwards: a few minutes
    of unthrottled traffic during a Redis outage costs far less than every
    gated endpoint refusing every user. Discovered when Upstash's monthly
    quota was hit and every gated request started 500ing with no exception
    logged anywhere - the crash happened before this function had a chance to
    say why.
    """
    full_key = f"ratelimit:{key}"
    try:
        current = await _redis.incr(full_key)
        if current == 1:
            await _redis.expire(full_key, window_seconds)
    except redis.RedisError:
        logger.warning("rate limiter unavailable, allowing request through", exc_info=True)
        return
    if current > max_requests:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests - please slow down and try again shortly",
        )
