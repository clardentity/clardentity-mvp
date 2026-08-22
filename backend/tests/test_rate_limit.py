"""The rate limiter's own dependency going down should not take the product
with it. See app/core/rate_limit.py for why this fails open rather than
closed - discovered live when Upstash's monthly quota was hit and every
gated endpoint started 500ing.
"""

import redis
import pytest

from app.core.rate_limit import check_rate_limit


class _BrokenRedis:
    async def incr(self, key):
        raise redis.ConnectionError("simulated: quota exceeded")

    async def expire(self, key, seconds):
        raise redis.ConnectionError("simulated: quota exceeded")


async def test_a_redis_error_lets_the_request_through(monkeypatch):
    monkeypatch.setattr("app.core.rate_limit._redis", _BrokenRedis())
    # Must not raise - this is the exact call every gated endpoint makes.
    await check_rate_limit("test:key", max_requests=1, window_seconds=60)


async def test_a_working_redis_still_enforces_the_limit():
    for _ in range(3):
        await check_rate_limit("test:enforce", max_requests=3, window_seconds=60)
    with pytest.raises(Exception) as exc_info:
        await check_rate_limit("test:enforce", max_requests=3, window_seconds=60)
    assert "429" in str(exc_info.value) or "Too many" in str(exc_info.value)
