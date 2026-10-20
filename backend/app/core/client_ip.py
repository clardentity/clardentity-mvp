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
    """The visitor's address.

    Render's web services sit behind Cloudflare (`server: cloudflare`,
    `cf-ray` on every response), and Cloudflare puts the address that
    connected to it in CF-Connecting-IP - one address, set by Cloudflare,
    which overwrites any value a client sends. That is the visitor.

    Without it, the right-most public address in X-Forwarded-For. Anything
    to the left was sent by the client and can say anything - taking the
    first entry let a script put a fresh "address" on every request and walk
    past every per-address limit (sign-in attempts, password-reset mail, the
    guest demo's spend). But behind Cloudflare the right-most public entry is
    Cloudflare's own edge: on 2026-10-19 the demo located a visitor in India
    as Singapore whenever their request was routed through Cloudflare's
    Singapore edge, and every visitor through one edge shared one set of
    per-address limits. Hence CF-Connecting-IP first."""
    cf = (request.headers.get("cf-connecting-ip") or "").strip()
    if cf:
        try:
            if ipaddress.ip_address(cf).is_global:
                return cf
        except ValueError:
            pass
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
