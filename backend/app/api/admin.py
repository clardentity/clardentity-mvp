import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import User
from app.schemas.admin import AdminSettingsOut, AdminSettingUpdate
from app.services.admin_settings_service import DEFAULTS, get_all_settings, get_setting, set_setting

logger = logging.getLogger("clardentity.admin")

router = APIRouter(prefix="/admin", tags=["admin"])

# No RBAC beyond workspace owner/member in MVP scope (§3.2) - admin settings
# are global, gated on authentication only, same as the rest of the API.


@router.get("/settings", response_model=AdminSettingsOut)
async def get_settings(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AdminSettingsOut:
    return AdminSettingsOut(settings=await get_all_settings(db))


@router.put("/settings", response_model=AdminSettingsOut)
async def update_setting(
    payload: AdminSettingUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> AdminSettingsOut:
    if payload.key not in DEFAULTS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unknown setting key: {payload.key}"
        )

    old_value = await get_setting(db, payload.key)
    await set_setting(db, payload.key, payload.value)

    # §14 Audit: config changes logged with actor + timestamp + diff (the
    # timestamp comes from the log record itself).
    logger.info(
        "admin setting changed",
        extra={
            "actor_id": str(current_user.id),
            "actor_email": current_user.email,
            "key": payload.key,
            "old_value": old_value,
            "new_value": payload.value,
        },
    )

    return AdminSettingsOut(settings=await get_all_settings(db))
