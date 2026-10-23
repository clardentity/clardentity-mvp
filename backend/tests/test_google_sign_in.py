"""Google sign-in from the website and the phone apps.

The audience check runs against a real signed token through the pinned
google-auth (only the certificate fetch is faked), so a library change in how
a list of audiences is handled shows up here rather than as every phone
sign-in failing. The account tests need a database and skip without one,
like the rest of the suite.
"""

import time
import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from google.auth import crypt, jwt
from google.oauth2 import id_token as google_id_token

from app.core.config import Settings, settings
from app.main import app

API = "/api/v1"
WEB = "web-client.apps.googleusercontent.com"
IOS = "ios-client.apps.googleusercontent.com"
ANDROID = "android-client.apps.googleusercontent.com"


def client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")


def _settings(**overrides) -> Settings:
    return settings.model_copy(update=overrides)


# --- Which audiences are accepted ------------------------------------------


def test_the_app_client_ids_are_accepted_alongside_the_websites():
    s = _settings(google_client_id=WEB, google_client_ids_extra=f" {IOS}, ,{ANDROID},{WEB}")
    assert s.google_client_ids == [WEB, IOS, ANDROID]


def test_extras_alone_do_not_switch_google_sign_in_on():
    assert _settings(google_client_id=None, google_client_ids_extra=IOS).google_client_ids == []


def test_without_extras_only_the_website_is_accepted():
    assert _settings(google_client_id=WEB).google_client_ids == [WEB]


@pytest.fixture(scope="module")
def google_key():
    """A signing key and a self-signed certificate standing in for Google's."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "test")])
    now = datetime.now(UTC)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(1)
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=1))
        .sign(key, hashes.SHA256())
    )
    pem_key = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    return pem_key, cert.public_bytes(serialization.Encoding.PEM)


def _token(pem_key: bytes, audience: str) -> str:
    signer = crypt.RSASigner.from_string(pem_key, key_id="k1")
    now = int(time.time())
    return jwt.encode(
        signer,
        {
            "iss": "https://accounts.google.com",
            "aud": audience,
            "sub": "123",
            "email": "x@example.com",
            "email_verified": True,
            "iat": now,
            "exp": now + 600,
        },
    ).decode()


def test_a_token_for_any_of_our_clients_verifies(monkeypatch, google_key):
    pem_key, cert = google_key
    monkeypatch.setattr(google_id_token, "_fetch_certs", lambda *_a, **_k: {"k1": cert})
    audiences = [WEB, IOS, ANDROID]
    for aud in audiences:
        info = google_id_token.verify_oauth2_token(_token(pem_key, aud), None, audiences)
        assert info["aud"] == aud


def test_a_token_for_someone_elses_client_is_refused(monkeypatch, google_key):
    pem_key, cert = google_key
    monkeypatch.setattr(google_id_token, "_fetch_certs", lambda *_a, **_k: {"k1": cert})
    with pytest.raises(ValueError):
        google_id_token.verify_oauth2_token(
            _token(pem_key, "other-app.apps.googleusercontent.com"), None, [WEB, IOS]
        )


async def test_the_endpoint_checks_the_token_against_every_configured_client(monkeypatch):
    from app.api import auth as auth_api
    from app.core import config

    monkeypatch.setattr(config.settings, "google_client_id", WEB)
    monkeypatch.setattr(config.settings, "google_client_ids_extra", f"{IOS},{ANDROID}")
    seen = {}

    def _verify(token, request, audience):
        seen["audience"] = audience
        raise ValueError("wrong audience")

    monkeypatch.setattr(auth_api.google_id_token, "verify_oauth2_token", _verify)
    async with client() as c:
        res = await c.post(f"{API}/auth/oauth/google", json={"id_token": "x"})
    # Refused before any database work, so this runs without one.
    assert res.status_code == 401
    assert seen["audience"] == [WEB, IOS, ANDROID]


# --- Verified address, for new accounts as well as links -------------------


async def test_an_unverified_or_missing_address_never_makes_an_account(monkeypatch):
    from app.api import auth as auth_api
    from app.core import config

    monkeypatch.setattr(config.settings, "google_client_id", WEB)
    claims: dict = {}
    monkeypatch.setattr(auth_api.google_id_token, "verify_oauth2_token", lambda *_a, **_k: dict(claims))
    email = f"g-new-{uuid.uuid4().hex[:8]}@example.com"

    async with client() as c:
        claims.update(sub=f"sub-{uuid.uuid4().hex}", email=email, email_verified=False)
        res = await c.post(f"{API}/auth/oauth/google", json={"id_token": "x"})
        if res.status_code >= 500:
            pytest.skip("no database available")
        assert res.status_code == 401

        # Nothing was created: a password sign-up for that address still works.
        reg = await c.post(
            f"{API}/auth/register",
            json={"email": email, "password": "google-test-123", "accepted_terms": True},
        )
        assert reg.status_code == 201, reg.text
        await c.delete(
            f"{API}/auth/me", headers={"Authorization": f"Bearer {reg.json()['access_token']}"}
        )

        claims.clear()
        claims.update(sub=f"sub-{uuid.uuid4().hex}", email_verified=True)
        res = await c.post(f"{API}/auth/oauth/google", json={"id_token": "x"})
        assert res.status_code == 401


# --- Terms, for an account Google sign-in creates ---------------------------


async def test_a_google_sign_up_records_the_terms_it_was_shown(monkeypatch):
    from app.api import auth as auth_api
    from app.core import config
    from app.db.session import AsyncSessionLocal
    from app.models import User

    monkeypatch.setattr(config.settings, "google_client_id", WEB)
    claims: dict = {}
    monkeypatch.setattr(auth_api.google_id_token, "verify_oauth2_token", lambda *_a, **_k: dict(claims))

    async def sign_in(c, accepted: bool | None) -> tuple[uuid.UUID, str]:
        body: dict = {"id_token": "x"}
        if accepted is not None:
            body["accepted_terms"] = accepted
        res = await c.post(f"{API}/auth/oauth/google", json=body)
        if res.status_code >= 500:
            pytest.skip("no database available")
        assert res.status_code == 200, res.text
        token = res.json()["access_token"]
        me = await c.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"})
        return uuid.UUID(me.json()["id"]), token

    async def terms_of(user_id: uuid.UUID):
        async with AsyncSessionLocal() as db:
            user = await db.get(User, user_id)
            return user.terms_accepted_at, user.terms_version

    def new_identity() -> None:
        claims.update(
            sub=f"sub-{uuid.uuid4().hex}",
            email=f"g-{uuid.uuid4().hex[:8]}@example.com",
            email_verified=True,
        )

    tokens: list[str] = []
    async with client() as c:
        try:
            # Agreed on the way in: stored as an email sign-up stores it.
            new_identity()
            agreed, token = await sign_in(c, True)
            tokens.append(token)
            at, version = await terms_of(agreed)
            assert at is not None
            assert version == config.settings.terms_version

            # Signing in again later never rewrites the record.
            again, _ = await sign_in(c, False)
            assert again == agreed
            assert await terms_of(agreed) == (at, version)

            # A client that doesn't say (one built before the field): the
            # account is made, and the row records nothing rather than
            # pretending something was agreed.
            new_identity()
            silent, token = await sign_in(c, None)
            tokens.append(token)
            assert await terms_of(silent) == (None, None)
        finally:
            for token in tokens:
                await c.delete(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"})
