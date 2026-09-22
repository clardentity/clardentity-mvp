"""Interest in the paid tier.

The locked model rows in the composer are the only demand signal this app
has. Which of the three people reach for is worth considerably more than how
many reached for something, so the click records what was clicked.

No email field: the caller is authenticated, so their address is already
known. Asking a signed-in user to type the address we are about to email them
at is a form that exists to look like a form.
"""

import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, status
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import ProInterest, User
from app.schemas.pro import PreviewStatus, ProInterestRequest
from app.services.preview_access import daily_limit, preview_modes, used_today

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pro", tags=["pro"])

# The Clar tiers, as the picker labels them. Narrowed server-side so a
# client sending anything else records interest without a bogus model name
# ending up in the demand data.
_KNOWN_MODELS = {"clar pro", "clar max", "clar ultra"}


@router.post("/interest", status_code=status.HTTP_202_ACCEPTED)
async def register_interest(
    payload: ProInterestRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    model = (payload.model or "").strip().lower() or None
    if model not in _KNOWN_MODELS:
        model = None

    # Clicking twice is impatience, not a second data point - and a duplicate
    # must not surface as an error on a button whose whole job is to feel like
    # it worked.
    await db.execute(
        insert(ProInterest)
        .values(user_id=current_user.id, requested_model=model)
        .on_conflict_do_nothing(constraint="uq_pro_interest_user_model")
    )
    await db.commit()

    return {"status": "registered", "email": current_user.email}


async def _preview_status(user: User) -> PreviewStatus:
    unlocked = user.preview_unlocked_at is not None
    used = await used_today(user.id) if unlocked else 0
    limit = daily_limit()
    return PreviewStatus(
        unlocked=unlocked,
        modes=sorted(preview_modes()),
        daily_limit=limit,
        used_today=used,
        remaining_today=max(0, limit - used),
    )


@router.get("/preview", response_model=PreviewStatus)
async def preview_status(
    current_user: User = Depends(get_current_user),
) -> PreviewStatus:
    """Whether this account has the paid-tier companions open, and what is
    left of today's allowance."""
    return await _preview_status(current_user)


@router.post("/preview", response_model=PreviewStatus)
async def open_preview(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PreviewStatus:
    """"Skip for now" in the plans dialog: open the locked companions for
    this account. Idempotent - a second click keeps the original date, so the
    grant cannot be refreshed by reopening the dialog."""
    if current_user.preview_unlocked_at is None:
        current_user.preview_unlocked_at = datetime.now(UTC)
        db.add(current_user)
        await db.commit()
        await db.refresh(current_user)
    return await _preview_status(current_user)


@router.delete("/preview", response_model=PreviewStatus)
async def close_preview(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> PreviewStatus:
    """Hand the locks back - so a tester can see what a free account sees."""
    if current_user.preview_unlocked_at is not None:
        current_user.preview_unlocked_at = None
        db.add(current_user)
        await db.commit()
        await db.refresh(current_user)
    return await _preview_status(current_user)
