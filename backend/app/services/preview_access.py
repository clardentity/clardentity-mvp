"""The preview grant: paid-tier companions, opened to the people testing
this build, behind a daily message cap.

Billing does not exist yet, so the tier locks in the picker are the only
thing standing between a tester and Mentoring, Reflect & Relieve,
Co-Creative and Legal. Refusing them outright means the modes we most need
feedback on are the ones nobody can reach. The grant is the middle: anyone
signed in can open them from the plans dialog ("Skip for now"), and every
message they send in one of those modes is counted against a per-day
allowance so an open door is not an open tab.

The count lives in Redis under a key that expires at the end of the day,
because it is a throttle rather than a ledger - nothing bills off it, and a
lost counter costs at most one day's extra usage. The grant itself is a
column on the user, so it survives a Redis flush and a new device.
"""

import logging
from datetime import UTC, datetime

import redis.asyncio as redis

from app.core.config import settings

logger = logging.getLogger("clardentity.preview")

_redis = redis.from_url(settings.redis_url)
_DAY_SECONDS = 24 * 60 * 60


def preview_modes() -> set[str]:
    return {m.strip() for m in settings.preview_modes.split(",") if m.strip()}


def is_preview_mode(mode: str) -> bool:
    return mode in preview_modes()


def _key(user_id, day: str) -> str:
    return f"preview:{user_id}:{day}"


def _today() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%d")


async def used_today(user_id) -> int:
    """How many preview-mode messages this user has sent today. 0 when the
    counter is unavailable - a throttle that cannot read its own count must
    not refuse the request."""
    try:
        value = await _redis.get(_key(user_id, _today()))
    except redis.RedisError:
        logger.warning("preview counter unavailable on read", exc_info=True)
        return 0
    return int(value or 0)


async def spend(user_id) -> int:
    """Count one preview-mode message and return the new total."""
    try:
        total = await _redis.incr(_key(user_id, _today()))
        if total == 1:
            await _redis.expire(_key(user_id, _today()), _DAY_SECONDS)
        return int(total)
    except redis.RedisError:
        logger.warning("preview counter unavailable on write", exc_info=True)
        return 0


def daily_limit() -> int:
    return settings.preview_daily_messages
