import hashlib
import uuid
from datetime import datetime, timedelta, timezone
from enum import StrEnum

import bcrypt
import jwt

from app.core.config import settings

JWT_ALGORITHM = "HS256"

# Long enough to walk to another device and find the mail, short enough that a
# forwarded or over-the-shoulder link is not a standing key to the account.
PASSWORD_RESET_TOKEN_EXPIRE_MINUTES = 30


class TokenType(StrEnum):
    ACCESS = "access"
    REFRESH = "refresh"
    RESET = "reset"


class InvalidTokenError(Exception):
    pass


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def create_access_token(user_id: uuid.UUID) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "type": TokenType.ACCESS.value,
        "iat": now,
        "exp": now + timedelta(minutes=settings.jwt_access_token_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: uuid.UUID, version: int) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "type": TokenType.REFRESH.value,
        "ver": version,
        "iat": now,
        "exp": now + timedelta(days=settings.jwt_refresh_token_expire_days),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=JWT_ALGORITHM)


def password_fingerprint(password_hash: str | None) -> str:
    """A short, non-reversible marker for "the password as it is right now".

    Carried inside a reset token and re-checked when the token is redeemed,
    which is what makes the link single-use without a table to store spent
    tokens in: completing a reset changes the hash, so every link issued
    against the old one stops validating in the same instant. Requesting a
    second link before using the first therefore leaves both working - they
    fingerprint the same unchanged password - and the first use kills both.

    Empty string for an account with no password yet (Google sign-in), so
    those users can still set one through this flow.
    """
    return hashlib.sha256((password_hash or "").encode("utf-8")).hexdigest()[:32]


def create_password_reset_token(user_id: uuid.UUID, password_hash: str | None) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "type": TokenType.RESET.value,
        "pwf": password_fingerprint(password_hash),
        "iat": now,
        "exp": now + timedelta(minutes=PASSWORD_RESET_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=JWT_ALGORITHM)


def decode_token(token: str, expected_type: TokenType) -> dict:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError as exc:
        raise InvalidTokenError(str(exc)) from exc

    if payload.get("type") != expected_type.value:
        raise InvalidTokenError(f"expected a {expected_type.value} token")

    return payload
