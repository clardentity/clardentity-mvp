"""Coarse location from the address a user signs in from.

Why at all: "what's the weather", "is this legal", "what time do shops shut"
are all region-dependent, and asking every user to fill in a location field is
a form nobody completes. The IP already says roughly where they are.

Deliberately coarse. City, region, country and timezone - the granularity of
"which country's rules apply", not "where do they live". Nothing finer is
stored, no coordinates, no ISP, no postal code, and the raw IP is never
persisted. It is offered to the model as background that may be wrong,
because it frequently is: VPNs, mobile carriers routing through another state,
and people travelling all produce a confident, wrong answer.
"""

import ipaddress
import logging

import httpx

logger = logging.getLogger(__name__)

# HTTPS on the free tier and no API key. The timeout is short and every
# failure is swallowed - this is a nice-to-have attached to a sign-in, and a
# slow third party must never be something the user waits behind.
_ENDPOINT = "https://ipapi.co/{ip}/json/"
_TIMEOUT_SECONDS = 4.0


def is_resolvable(ip: str | None) -> bool:
    """False for anything a lookup can't say anything useful about."""
    if not ip:
        return False
    try:
        parsed = ipaddress.ip_address(ip)
    except ValueError:
        return False
    # Localhost and LAN addresses are what every developer machine and a good
    # number of misconfigured proxies report.
    return not (
        parsed.is_private
        or parsed.is_loopback
        or parsed.is_reserved
        or parsed.is_link_local
        or parsed.is_multicast
    )


async def resolve(ip: str) -> dict | None:
    """{"label", "country", "timezone"} or None. Never raises."""
    if not is_resolvable(ip):
        return None

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            response = await client.get(
                _ENDPOINT.format(ip=ip), headers={"User-Agent": "Clardentity/1.0"}
            )
        if response.status_code != 200:
            return None
        data = response.json()
    except Exception:
        logger.info("geolocation lookup failed", exc_info=True)
        return None

    # The free tier signals quota and bad input with a 200 and an error body.
    if data.get("error"):
        return None

    parts = [data.get("city"), data.get("region"), data.get("country_name")]
    label = ", ".join(p for p in parts if p)
    if not label:
        return None

    return {
        "label": label[:120],
        "country": (data.get("country_code") or "")[:2] or None,
        "timezone": (data.get("timezone") or "")[:64] or None,
    }


def location_prompt_line(label: str | None, timezone: str | None) -> str | None:
    """One line of background, hedged on purpose.

    Stated as where they *appear* to be signing in from rather than where they
    are, so the model uses it for defaults - units, jurisdiction, season - and
    still believes the user over it when they say otherwise.
    """
    if not label:
        return None
    line = f"They appear to be signing in from {label}"
    if timezone:
        line += f" (timezone {timezone})"
    return (
        line + ". Use this only to pick sensible regional defaults - units, currency, "
        "season, which country's rules are likely relevant. It is inferred from a "
        "network address, so it is often wrong: never assert it back to them, and "
        "drop it immediately if they say otherwise."
    )
