"""Tokens.

The password-reset token carries no server-side state, so everything that
makes it single-use lives in these assertions.
"""

import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest

from app.core.config import settings
from app.core.security import (
    JWT_ALGORITHM,
    InvalidTokenError,
    TokenType,
    create_access_token,
    create_password_reset_token,
    create_refresh_token,
    decode_token,
    hash_password,
    password_fingerprint,
    verify_password,
)

OLD_HASH = "$2b$12$abcdefghijklmnopqrstuv"
NEW_HASH = "$2b$12$zyxwvutsrqponmlkjihgfe"


class TestPasswords:
    def test_round_trip(self):
        h = hash_password("correct horse battery staple")
        assert verify_password("correct horse battery staple", h)
        assert not verify_password("wrong", h)

    def test_hash_is_salted(self):
        assert hash_password("same") != hash_password("same")


class TestTokenTypes:
    def test_each_type_rejects_the_others(self):
        uid = uuid.uuid4()
        access = create_access_token(uid)
        refresh = create_refresh_token(uid, 0)
        reset = create_password_reset_token(uid, OLD_HASH)

        assert decode_token(access, TokenType.ACCESS)["sub"] == str(uid)
        assert decode_token(refresh, TokenType.REFRESH)["sub"] == str(uid)
        assert decode_token(reset, TokenType.RESET)["sub"] == str(uid)

        # A reset link must not be usable as a login.
        for token, wrong in (
            (reset, TokenType.ACCESS),
            (access, TokenType.RESET),
            (refresh, TokenType.ACCESS),
        ):
            with pytest.raises(InvalidTokenError):
                decode_token(token, wrong)

    def test_rejects_a_forged_signature(self):
        forged = jwt.encode(
            {"sub": str(uuid.uuid4()), "type": "reset"}, "not-our-secret", algorithm=JWT_ALGORITHM
        )
        with pytest.raises(InvalidTokenError):
            decode_token(forged, TokenType.RESET)

    def test_rejects_an_expired_token(self):
        past = datetime.now(timezone.utc) - timedelta(hours=1)
        expired = jwt.encode(
            {"sub": str(uuid.uuid4()), "type": "reset", "exp": past},
            settings.jwt_secret,
            algorithm=JWT_ALGORITHM,
        )
        with pytest.raises(InvalidTokenError):
            decode_token(expired, TokenType.RESET)


class TestResetSingleUse:
    def test_fingerprint_changes_with_the_password(self):
        assert password_fingerprint(OLD_HASH) != password_fingerprint(NEW_HASH)

    def test_fingerprint_is_stable_for_the_same_password(self):
        assert password_fingerprint(OLD_HASH) == password_fingerprint(OLD_HASH)

    def test_token_matches_only_the_password_it_was_issued_against(self):
        claims = decode_token(create_password_reset_token(uuid.uuid4(), OLD_HASH), TokenType.RESET)
        assert claims["pwf"] == password_fingerprint(OLD_HASH)
        # After a completed reset the stored hash differs, so the link is spent.
        assert claims["pwf"] != password_fingerprint(NEW_HASH)

    def test_accounts_with_no_password_get_a_stable_fingerprint(self):
        # Google sign-in users can still set a password through the flow.
        assert password_fingerprint(None) == password_fingerprint("")

    def test_does_not_leak_the_hash(self):
        fp = password_fingerprint(OLD_HASH)
        assert OLD_HASH not in fp
        assert len(fp) == 32
