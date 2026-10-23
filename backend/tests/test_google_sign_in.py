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
