import pytest

from app.core.rate_limit import _redis
from app.db.session import engine, worker_engine


@pytest.fixture(autouse=True)
def _quiet_safety_screen(monkeypatch, request):
    """The safety screen is a real model call on every chat turn. Tests that
    stream a turn are about something else, so it answers "none" for them
    without a network call; tests/test_safety.py exercises the real thing
    (with the model faked) by marking itself `real_safety`."""
    if request.node.get_closest_marker("real_safety"):
        return
    from app.services import safety

    async def _none(message, history=None):
        return safety.NONE

    monkeypatch.setattr(safety, "assess", _none)


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
        # And the landing demo's per-address and daily counters, for the same
        # reason: every test comes from 127.0.0.1, so one run's spend would
        # otherwise read as the next run's exhausted allowance.
        keys += [k async for k in _redis.scan_iter("guest:address:*")]
        keys += [k async for k in _redis.scan_iter("guest:global:*")]
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
    # The demo allowance keeps its own client; it binds to a loop the same
    # way, and left alone it made every demo test after the first report
    # "no redis available" and skip.
    from app.services.guest_demo import _redis as guest_redis

    await guest_redis.aclose()
    await guest_redis.connection_pool.disconnect()
    # And the admin panel's analytics cache, for the same reason.
    from app.services.posthog_analytics import _redis as analytics_redis

    await analytics_redis.aclose()
    await analytics_redis.connection_pool.disconnect()
    # And the paid companions' daily allowance, the first time a test sends a
    # signed-in Co-Creative message after another test has used it.
    from app.services.preview_access import _redis as preview_redis

    await preview_redis.aclose()
    await preview_redis.connection_pool.disconnect()
