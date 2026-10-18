"""Regression tests for the 2026-10-18 security audit fixes.

C1 admin by registration, H1 Google account takeover, H2 dashboard SQL guard,
H3/H4 spoofable client address and guest spend, H5 attachment DoS. The
database-backed tests skip without a database, like the rest of the suite.
"""

import io
import uuid
import zipfile

import httpx
import pytest
import redis
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.admin_dashboard import _vet
from app.core.client_ip import client_ip
from app.main import app
from app.schemas.chat import MessageCreate
from app.services import document_ingestion, guest_demo
from app.services.admin_access import is_admin

API = "/api/v1"


def client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")


class _Req:
    def __init__(self, headers, host="10.0.0.9"):
        self.headers = headers
        self.client = type("C", (), {"host": host})()


class _U:
    def __init__(self, email):
        self.email = email


# --- H3/H4: the client address --------------------------------------------


def test_a_prepended_address_does_not_replace_the_real_one():
    # The client sends "1.2.3.4"; Render appends the address it saw, then an
    # internal hop. The real address is the right-most public one.
    req = _Req({"x-forwarded-for": "1.2.3.4, 49.37.1.2, 10.0.0.7"})
    assert client_ip(req) == "49.37.1.2"


def test_rotating_the_spoofed_part_does_not_change_the_address():
    a = client_ip(_Req({"x-forwarded-for": "8.8.8.8, 49.37.1.2"}))
    b = client_ip(_Req({"x-forwarded-for": "9.9.9.9, 49.37.1.2"}))
    assert a == b == "49.37.1.2"


# --- C1: who is admin --------------------------------------------------------


def test_admin_is_an_exact_match_not_a_case_insensitive_one(monkeypatch):
    from app.core import config

    monkeypatch.setattr(config.settings, "admin_emails", "boss@example.com")
    assert is_admin(_U("boss@example.com")) is True
    assert is_admin(_U("BOSS@example.com")) is False
    assert is_admin(_U("Boss@Example.com")) is False


# --- H2: the dashboard SQL guard ---------------------------------------------


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT m FROM messages m",
        "SELECT u.* FROM users u",
        "SELECT * FROM users",
        "SELECT to_jsonb(m) FROM messages m",
        'SELECT id FROM "messages"',
        "SELECT u.email FROM users u, user_profiles p",
        "SELECT pg_terminate_backend(pid) FROM users",
        "SELECT email FROM users WHERE pg_sleep(5) IS NULL",
        "SELECT email FROM users JOIN pg_catalog.pg_user ON true",
    ],
)
def test_whole_rows_system_functions_and_hidden_tables_are_refused(sql):
    with pytest.raises(HTTPException) as exc:
        _vet(sql)
    assert exc.value.status_code == 400


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT count(*) FROM users",
        "SELECT mode_used, count(*) FROM messages WHERE role = 'assistant' GROUP BY mode_used",
        "SELECT u.email, count(m.id) AS n FROM users u JOIN workspaces w ON w.owner_id = u.id "
        "JOIN conversations c ON c.workspace_id = w.id JOIN messages m ON m.conversation_id = c.id "
        "GROUP BY u.email ORDER BY n DESC LIMIT 10",
        "with daily as (select date_trunc('day', created_at) d, count(*) n from messages group by 1) "
        "select d, n from daily order by d",
    ],
)
def test_ordinary_dashboard_questions_still_pass(sql):
    assert _vet(sql)


# --- H5: attachments ---------------------------------------------------------


def test_a_message_carries_at_most_ten_attachments():
    one = {"type": "image", "data": "aGk=", "mime_type": "image/png"}
    MessageCreate(content="hi", mode="knowing", attachments=[one] * 10)
    with pytest.raises(ValidationError):
        MessageCreate(content="hi", mode="knowing", attachments=[one] * 11)


def test_an_office_file_that_expands_too_far_is_refused(monkeypatch):
    monkeypatch.setattr(document_ingestion, "MAX_UNZIPPED_BYTES", 1024)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("xl/worksheets/sheet1.xml", "0" * 50_000)  # compresses to almost nothing
    with pytest.raises(ValueError):
        document_ingestion.extract_pages(buf.getvalue(), "xlsx")


# --- H3: the guest demo's daily ceiling -------------------------------------


async def test_the_daily_ceiling_fails_closed_when_redis_is_down(monkeypatch):
    class Down:
        async def get(self, *_a, **_k):
            raise redis.RedisError("down")

    monkeypatch.setattr(guest_demo, "_redis", Down())
    assert await guest_demo.over_global_budget() is True


# --- C1 and H1 against the database -----------------------------------------


async def _register(c, email, password="audit-password-123"):
    return await c.post(
        f"{API}/auth/register",
        json={"email": email, "password": password, "display_name": "A", "accepted_terms": True},
    )


async def _cleanup(c, token):
    if token:
        await c.delete(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"})


async def test_an_admin_address_cannot_be_self_registered(monkeypatch):
    from app.core import config

    admin = f"boss-{uuid.uuid4().hex[:8]}@example.com"
    monkeypatch.setattr(config.settings, "admin_emails", admin)
    async with client() as c:
        exact = await _register(c, admin)
        if exact.status_code >= 500:
            pytest.skip("no database available")
        assert exact.status_code == 409
        shouted = await _register(c, admin.upper())
        assert shouted.status_code == 409


async def test_addresses_are_one_account_whatever_the_case():
    local = f"Mixed-{uuid.uuid4().hex[:8]}"
    token = None
    async with client() as c:
        try:
            first = await _register(c, f"{local}@Example.com")
            if first.status_code >= 500:
                pytest.skip("no database available")
            assert first.status_code == 201, first.text
            token = first.json()["access_token"]
            assert first.json()["user"]["email"] == f"{local}@example.com".lower()

            again = await _register(c, f"{local.lower()}@example.com")
            assert again.status_code == 409

            login = await c.post(
                f"{API}/auth/login",
                json={"email": f"{local.upper()}@EXAMPLE.COM", "password": "audit-password-123"},
            )
            assert login.status_code == 200, login.text
        finally:
            await _cleanup(c, token)


async def test_google_needs_a_verified_address_and_its_own_identity(monkeypatch):
    from app.api import auth as auth_api
    from app.core import config

    monkeypatch.setattr(config.settings, "google_client_id", "test-client-id")
    email = f"google-{uuid.uuid4().hex[:8]}@example.com"
    claims: dict = {}
    monkeypatch.setattr(auth_api.google_id_token, "verify_oauth2_token", lambda *_a, **_k: dict(claims))

    token = None
    async with client() as c:
        try:
            reg = await _register(c, email)
            if reg.status_code >= 500:
                pytest.skip("no database available")
            token = reg.json()["access_token"]

            # An unverified address never signs into the existing account.
            claims.update(sub="google-sub-1", email=email, email_verified=False)
            res = await c.post(f"{API}/auth/oauth/google", json={"id_token": "x"})
            assert res.status_code == 401

            # Verified: the first Google identity is linked...
            claims.update(email_verified=True)
            res = await c.post(f"{API}/auth/oauth/google", json={"id_token": "x"})
            assert res.status_code == 200, res.text

            # ...and a different Google identity with the same address is refused.
            claims.update(sub="google-sub-2")
            res = await c.post(f"{API}/auth/oauth/google", json={"id_token": "x"})
            assert res.status_code == 409

            # An administrator's address is never created or linked through Google.
            monkeypatch.setattr(config.settings, "admin_emails", f"admin-{email}")
            claims.update(sub="google-sub-3", email=f"admin-{email}")
            res = await c.post(f"{API}/auth/oauth/google", json={"id_token": "x"})
            assert res.status_code == 403
        finally:
            await _cleanup(c, token)
