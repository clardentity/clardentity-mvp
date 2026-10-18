"""The address a request really came from.

Behind Render the socket peer is the platform's proxy - a private address -
so `request.client.host` is the same for every user and says nothing about
where any of them are. The forwarded header carries the real one. Until
2026-10-16 sign-in read the peer, every lookup was skipped as "private", and
no signed-in user anywhere had a location: no local rules, no local crisis
numbers. The demo read the header and was right all along.

Only the proxy's own entry is trusted (the last one); anything before it
is whatever the client sent.
"""

import ipaddress

from fastapi import Request


def client_timezone(request: Request) -> str | None:
    """The IANA time zone the browser reports (sent by the client on every
    API call), or None. Only ever used to name a country when the address
    cannot; anything that is not a zone in the table is ignored."""
    value = (request.headers.get("x-client-timezone") or "").strip()
    return value if 0 < len(value) <= 64 else None


def client_ip(request: Request) -> str:
    """The right-most public address in X-Forwarded-For.

    Render's proxy appends the address that connected to it, and internal
    hops after that are private addresses. Anything to the left was sent by
    the client and can say anything - taking the first entry let a script
    put a fresh "address" on every request and walk past every per-address
    limit (sign-in attempts, password-reset mail, the guest demo's spend).
    Reading from the right, skipping private hops, lands on the address the
    proxy saw."""
    forwarded = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
    for candidate in reversed(forwarded):
        try:
            if ipaddress.ip_address(candidate).is_global:
                return candidate
        except ValueError:
            continue
    if forwarded:
        return forwarded[-1]
    return request.client.host if request.client else "unknown"
