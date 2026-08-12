import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.rate_limit import check_rate_limit
from app.core.security import (
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
from app.db.session import get_db
from app.models import User, Workspace, WorkspaceMember
from app.schemas.auth import (
    AuthResponse,
    GoogleOAuthRequest,
    LoginRequest,
    PasswordResetConfirm,
    PasswordResetRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserPublic,
)

from app.workers.send_password_reset_email import send_password_reset_email_task
from app.workers.send_welcome_email import send_welcome_email_task

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _issue_tokens(user: User) -> TokenResponse:
    return TokenResponse(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id, user.refresh_token_version),
    )


async def provision_new_user(db: AsyncSession, user: User) -> None:
    """Everything a brand-new account needs, whichever way they signed up.

    Shared by password registration and Google sign-in: when this only lived in
    the password path, Google users arrived at an empty screen demanding they
    create a "workspace" before asking anything - the exact friction the
    auto-workspace was added to remove.

    Expects `user` to be flushed (so it has an id) and does not commit; the
    caller owns the transaction.
    """
    workspace = Workspace(owner_id=user.id, name="My workspace")
    db.add(workspace)
    await db.flush()
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role="owner"))


async def ensure_workspace(db: AsyncSession, user: User) -> None:
    """Guarantee the signed-in user has somewhere to work.

    Provisioning at registration only helps accounts created after that feature
    existed. Anyone who registered earlier - or who deleted their last
    workspace - lands on an empty screen that looks exactly like a broken
    login: the redirect worked, the app loaded, and there is simply nothing
    there. Checking on every sign-in makes "a user always has a workspace" true
    rather than assumed.
    """
    count = await db.scalar(
        select(func.count())
        .select_from(WorkspaceMember)
        .where(WorkspaceMember.user_id == user.id)
    )
    if not count:
        await provision_new_user(db, user)
        await db.commit()


def queue_welcome_email(user: User) -> None:
    """Best-effort and always out-of-band. A slow or misconfigured email
    provider must never delay or fail account creation.
    """
    if not user.email:
        return
    try:
        send_welcome_email_task.delay(user.email, user.display_name)
    except Exception:
        logger.exception("could not queue welcome email", extra={"user_id": str(user.id)})


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
async def register(
    payload: RegisterRequest, request: Request, db: AsyncSession = Depends(get_db)
) -> AuthResponse:
    await check_rate_limit(f"auth:register:{_client_ip(request)}", max_requests=10, window_seconds=300)

    existing = await db.scalar(select(User).where(User.email == payload.email))
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")

    user = User(
        email=payload.email,
        password_hash=hash_password(payload.password),
        display_name=payload.display_name,
    )
    db.add(user)
    await db.flush()
    await provision_new_user(db, user)

    await db.commit()
    await db.refresh(user)

    queue_welcome_email(user)
    tokens = _issue_tokens(user)
    return AuthResponse(user=UserPublic.model_validate(user), **tokens.model_dump())


@router.post("/login", response_model=TokenResponse)
async def login(
    payload: LoginRequest, request: Request, db: AsyncSession = Depends(get_db)
) -> TokenResponse:
    await check_rate_limit(f"auth:login:{_client_ip(request)}", max_requests=10, window_seconds=300)

    invalid_credentials = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password"
    )

    user = await db.scalar(select(User).where(User.email == payload.email))
    if user is None or user.password_hash is None:
        raise invalid_credentials

    if not verify_password(payload.password, user.password_hash):
        raise invalid_credentials

    await ensure_workspace(db, user)

    return _issue_tokens(user)


@router.post("/password-reset/request", status_code=status.HTTP_202_ACCEPTED)
async def request_password_reset(
    payload: PasswordResetRequest, request: Request, db: AsyncSession = Depends(get_db)
) -> dict:
    """Always answers the same way.

    Telling the caller whether an address is registered turns this endpoint
    into a way to test a list of emails against the user table, so the
    response body, status code and (via the queued send) the response time do
    not vary with whether the account exists.
    """
    await check_rate_limit(
        f"auth:reset-request:{_client_ip(request)}", max_requests=5, window_seconds=900
    )

    user = await db.scalar(select(User).where(User.email == payload.email))
    if user is not None:
        token = create_password_reset_token(user.id, user.password_hash)
        try:
            send_password_reset_email_task.delay(user.email, token)
        except Exception:
            logger.exception(
                "could not queue password reset email", extra={"user_id": str(user.id)}
            )

    return {"detail": "If that address has an account, a reset link is on its way."}


@router.post("/password-reset/confirm", response_model=TokenResponse)
async def confirm_password_reset(
    payload: PasswordResetConfirm, request: Request, db: AsyncSession = Depends(get_db)
) -> TokenResponse:
    await check_rate_limit(
        f"auth:reset-confirm:{_client_ip(request)}", max_requests=10, window_seconds=900
    )

    invalid = HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="This reset link has expired or has already been used. Request a new one.",
    )

    try:
        claims = decode_token(payload.token, TokenType.RESET)
    except InvalidTokenError:
        raise invalid from None

    try:
        user_id = uuid.UUID(claims["sub"])
    except (KeyError, ValueError):
        raise invalid from None

    user = await db.get(User, user_id)
    if user is None:
        raise invalid

    # The link is only good against the password it was issued for. Once a
    # reset completes the hash changes, so this stops matching and the link -
    # along with any older ones still sitting in the mailbox - is spent.
    if claims.get("pwf") != password_fingerprint(user.password_hash):
        raise invalid

    user.password_hash = hash_password(payload.password)
    # Everything signed in on the old password is signed out. Someone who
    # resets a password they think was compromised expects exactly that, and
    # would not think to go looking for a "sign out other devices" button.
    user.refresh_token_version += 1

    await ensure_workspace(db, user)
    await db.commit()
    await db.refresh(user)

    # Signed straight in. Making someone re-type the password they just chose,
    # on a login form, is a step that exists only because it was easier to
    # build - and it is the step where they discover the typo.
    return _issue_tokens(user)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    payload: RefreshRequest, request: Request, db: AsyncSession = Depends(get_db)
) -> TokenResponse:
    await check_rate_limit(f"auth:refresh:{_client_ip(request)}", max_requests=30, window_seconds=300)

    invalid_token = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token"
    )

    try:
        token_payload = decode_token(payload.refresh_token, TokenType.REFRESH)
    except InvalidTokenError as exc:
        raise invalid_token from exc

    try:
        user_id = uuid.UUID(token_payload["sub"])
    except (KeyError, ValueError) as exc:
        raise invalid_token from exc

    user = await db.get(User, user_id)
    if user is None or token_payload.get("ver") != user.refresh_token_version:
        raise invalid_token

    # Rotate: bump the version so the presented refresh token can't be reused.
    user.refresh_token_version += 1
    await db.commit()
    await db.refresh(user)

    return _issue_tokens(user)


@router.post("/oauth/google", response_model=TokenResponse)
async def oauth_google(payload: GoogleOAuthRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    if not settings.google_client_id:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Google OAuth is not configured on this server",
        )

    try:
        info = google_id_token.verify_oauth2_token(
            payload.id_token, google_requests.Request(), settings.google_client_id
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Google ID token"
        ) from exc

    oauth_subject = info["sub"]
    email = info.get("email")

    user = await db.scalar(
        select(User).where(User.oauth_provider == "google", User.oauth_subject == oauth_subject)
    )
    if user is None and email:
        user = await db.scalar(select(User).where(User.email == email))

    is_new_user = user is None
    if user is None:
        user = User(
            email=email,
            oauth_provider="google",
            oauth_subject=oauth_subject,
            display_name=info.get("name"),
        )
        db.add(user)
        await db.flush()
        await provision_new_user(db, user)
    elif user.oauth_provider is None:
        # Existing password account signing in with Google for the first time:
        # link the identity rather than creating a duplicate account.
        user.oauth_provider = "google"
        user.oauth_subject = oauth_subject

    await db.commit()
    await db.refresh(user)

    # Covers the returning-user branches above, where nothing is provisioned.
    await ensure_workspace(db, user)

    if is_new_user:
        queue_welcome_email(user)

    return _issue_tokens(user)


@router.get("/me", response_model=UserPublic)
async def me(current_user: User = Depends(get_current_user)) -> UserPublic:
    return UserPublic.model_validate(current_user)
