import pytest

from app.core.rate_limit import _redis
from app.db.session import engine, worker_engine


@pytest.fixture(autouse=True)
async def _clear_rate_limits():
    """Rate limiting is infrastructure these tests run through, not the thing
    under test. The counters are per-IP and every test arrives from the same
    one, so without this the suite passes once and then 429s until the window
    expires - and the failure looks like a broken endpoint rather than a
    limiter doing its job.
    """
    try:
        keys = [k async for k in _redis.scan_iter("ratelimit:*")]
        if keys:
            await _redis.delete(*keys)
    except Exception:
        # No Redis: the tests that need it skip themselves.
        pass
    yield


@pytest.fixture(autouse=True)
async def _dispose_pools_between_tests():
    """Return every pooled connection before the test's event loop closes.

    asyncpg and redis both bind a connection to the loop that opened it, and
    pytest-asyncio gives each test its own loop. Without this, the first test
    to touch either leaves a live connection in a module-level pool, the next
    test checks it out on a different loop, and the failure surfaces as
    "Event loop is closed" - in whichever test happened to run second, rather
    than in the one at fault. Which is why these tests passed alone and failed
    as a suite.
    """
    yield
    await engine.dispose()
    await worker_engine.dispose()
    await _redis.aclose()
    await _redis.connection_pool.disconnect()
