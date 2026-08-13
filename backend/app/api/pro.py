"""Interest in the paid tier.

The locked model rows in the composer are the only demand signal this app
has. Which of the three people reach for is worth considerably more than how
many reached for something, so the click records what was clicked.

No email field: the caller is authenticated, so their address is already
known. Asking a signed-in user to type the address we are about to email them
at is a form that exists to look like a form.
"""

import logging

from fastapi import APIRouter, Depends, status
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import ProInterest, User
from app.schemas.pro import ProInterestRequest

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pro", tags=["pro"])

_KNOWN_MODELS = {"chatgpt", "claude", "gemini"}


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
