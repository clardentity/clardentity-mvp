import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.core.config import settings
from app.core.rate_limit import check_rate_limit
from app.core.security import (
    InvalidTokenError,
    TokenType,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.db.session import get_db
from app.models import User, Workspace, WorkspaceMember
from app.schemas.auth import (
    AuthResponse,
    GoogleOAuthRequest,
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserPublic,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _issue_tokens(user: User) -> TokenResponse:
    return TokenResponse(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id, user.refresh_token_version),
    )


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

    # Give every new account a workspace up front. Otherwise the first thing a
    # new user meets is an empty screen demanding they name a "workspace"
    # before they can ask a single question - the friction this product is
    # meant to avoid. They can rename it or add more later.
    workspace = Workspace(owner_id=user.id, name="My workspace")
    db.add(workspace)
    await db.flush()
    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=user.id, role="owner"))

    await db.commit()
    await db.refresh(user)

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

    if user is None:
        user = User(
            email=email,
            oauth_provider="google",
            oauth_subject=oauth_subject,
            display_name=info.get("name"),
        )
        db.add(user)
    elif user.oauth_provider is None:
        user.oauth_provider = "google"
        user.oauth_subject = oauth_subject

    await db.commit()
    await db.refresh(user)

    return _issue_tokens(user)


@router.get("/me", response_model=UserPublic)
async def me(current_user: User = Depends(get_current_user)) -> UserPublic:
    return UserPublic.model_validate(current_user)
