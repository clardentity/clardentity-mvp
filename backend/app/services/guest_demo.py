"""The allowance behind the landing page's try-it-here box.

Someone who has not signed up can hold a short conversation on the stage,
and is asked to sign up once it has cost 5,000 tokens. Everything here is
about making that affordable rather than about being precise: nothing bills
off these counters, and losing them costs at most one extra free
conversation.

Two counters, not one, because they stop different things.

The per-session budget is the product rule: one visitor, one taste of it.
The session id comes from the browser, so it is trivially rotated - clearing
storage or opening a private window buys another 5,000 - and that is fine,
because the point is a demo rather than a paywall.

The per-address budget is the cost rule, and it is the one that matters. It
is what stops a script from rotating session ids in a loop and spending the
answer budget for the month in an afternoon. It is deliberately much larger
than one session, so a household, an office or a university behind one
address can all try it, and deliberately finite.

Both expire. A counter that never resets turns a demo into a one-time offer
for anyone whose address is shared.
"""

import logging
from datetime import UTC, datetime

import redis.asyncio as redis

from app.core.config import settings

logger = logging.getLogger("clardentity.guest")

_redis = redis.from_url(settings.redis_url)

#: What one visitor gets before being asked to sign up.
SESSION_BUDGET = 5_000

#: What one network address gets in a day, across however many sessions it
#: invents, counted in what the turns actually cost - the claim checking
#: included. A demo turn now runs the full pipeline, and one with per-claim
#: research measured 37k tokens (2026-10-10), so this is roughly a dozen
#: answers: enough for an office of people trying it from one address,
#: small enough that a loop rotating session ids hits it quickly.
ADDRESS_BUDGET = 400_000

_DAY = 24 * 60 * 60

#: Longest single question, and longest history carried back, in characters.
#: The history arrives from the browser and is pasted into the prompt, so
#: without a ceiling one request could carry a megabyte of context.
MAX_MESSAGE_CHARS = 2_000
MAX_HISTORY_CHARS = 12_000
MAX_HISTORY_TURNS = 20


def _session_key(session_id: str) -> str:
    return f"guest:session:{session_id}"


def _address_key(address: str) -> str:
    return f"guest:address:{address}"


def _global_key() -> str:
    return f"guest:global:{datetime.now(UTC):%Y-%m-%d}"


async def _get(key: str) -> int:
    try:
        value = await _redis.get(key)
    except redis.RedisError:
        # A counter that cannot be read must not refuse the request: the
        # failure mode of the demo is "slightly too generous", never "the
        # landing page is broken".
        logger.warning("guest counter unavailable on read", exc_info=True)
        return 0
    return int(value or 0)


async def spent(session_id: str, address: str) -> tuple[int, int]:
    """Tokens already spent by this session, and by this address today."""
    return await _get(_session_key(session_id)), await _get(_address_key(address))


async def over_global_budget() -> bool:
    """Whether the demo has spent its whole allowance for today.

    The backstop under the other two. Both of those are keyed on something
    the caller controls - a session id the browser invents, an address read
    from a header a proxy sets - so neither survives someone determined. This
    one is keyed on the date, and nothing else, which is what makes the worst
    case a number rather than a question.
    """
    # Fails closed, unlike the other counters: when Redis can't be read
    # there is no ceiling at all, and this is the one counter whose whole
    # job is to make the worst case a number.
    try:
        value = await _redis.get(_global_key())
    except redis.RedisError:
        logger.warning("guest global budget unavailable; treating as spent", exc_info=True)
        return True
    return int(value or 0) >= settings.guest_daily_token_budget


async def exhausted(session_id: str, address: str) -> bool:
    session_spent, address_spent = await spent(session_id, address)
    return session_spent >= SESSION_BUDGET or address_spent >= ADDRESS_BUDGET


async def reserve(address: str, tokens: int) -> None:
    """Hold part of a turn's cost against the address and the day before it
    is generated. Charging only at the end let a client hang up just before
    the end - the generator is cancelled, nothing is counted - and let many
    requests in parallel all pass the check before any was charged. The
    reservation is settled by `charge(..., reserved=...)`."""
    try:
        pipe = _redis.pipeline()
        pipe.incrby(_address_key(address), max(0, tokens))
        pipe.expire(_address_key(address), _DAY)
        pipe.incrby(_global_key(), max(0, tokens))
        pipe.expire(_global_key(), _DAY)
        await pipe.execute()
    except redis.RedisError:
        logger.warning("guest counter unavailable on reserve", exc_info=True)


async def charge(
    session_id: str, address: str, session_tokens: int, total_tokens: int, reserved: int = 0
) -> int:
    """Add one turn to the counters. Returns the session total.

    Two numbers, because the counters measure different things. The session
    is the visitor's allowance and is charged the conversation they held -
    the answer they were given. The address and the daily ceiling bound what
    the demo costs, so they are charged everything the turn spent, including
    the claim checking a visitor never asked to pay for.

    Charged after the answer rather than reserved before it: a turn that has
    already been generated has already been paid for, and refusing to count
    it would be the one way to actually lose money here.
    """
    # What was reserved up front has already been counted.
    total_tokens = max(0, total_tokens - reserved)
    total = await _get(_session_key(session_id))
    if session_tokens <= 0 and total_tokens <= 0:
        return total
    try:
        pipe = _redis.pipeline()
        pipe.incrby(_session_key(session_id), max(0, session_tokens))
        pipe.expire(_session_key(session_id), _DAY)
        pipe.incrby(_address_key(address), max(0, total_tokens))
        pipe.expire(_address_key(address), _DAY)
        pipe.incrby(_global_key(), max(0, total_tokens))
        pipe.expire(_global_key(), _DAY)
        results = await pipe.execute()
        total = int(results[0])
    except redis.RedisError:
        logger.warning("guest counter unavailable on write", exc_info=True)
    return total


def trim_history(history: list[dict]) -> list[dict]:
    """The conversation so far, cut to something that cannot be abused.

    Oldest turns go first: the recent ones are what the next answer needs.
    """
    turns = [
        {"role": h.get("role"), "content": (h.get("content") or "")[:MAX_MESSAGE_CHARS]}
        for h in history
        if h.get("role") in {"user", "assistant"} and (h.get("content") or "").strip()
    ][-MAX_HISTORY_TURNS:]

    while turns and sum(len(t["content"]) for t in turns) > MAX_HISTORY_CHARS:
        turns.pop(0)
    return turns


async def visitor_location(
    address: str | None, timezone: str | None = None
) -> tuple[str | None, str | None]:
    """(country, subdivision) for a visitor, from their address - asked only
    when the answer depends on it (a message the safety screen flagged, or
    Guidance and Healthcare, whose rules and numbers are local). Cached a day
    under a hash of the address (geolocation.resolve_cached); the browser's
    time zone names the country when the lookup cannot."""
    from app.services.geolocation import country_from_timezone, resolve_cached

    located = await resolve_cached(address) or {}
    if located.get("country"):
        return located["country"], located.get("subdivision")
    return country_from_timezone(timezone), None
