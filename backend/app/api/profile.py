from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import User, UserProfile
from app.schemas.profile import (
    ProfileOut,
    ProfileRoleOut,
    ProfileUpdate,
    RoleOut,
    RoleQualifierOut,
)
from app.services import taxonomy
from app.services.profile_service import get_profile
from app.workers.rebuild_profile import rebuild_profile_task

router = APIRouter(prefix="/profile", tags=["profile"])


def _serialize(profile: UserProfile | None) -> ProfileOut:
    if profile is None:
        return ProfileOut(personality_md=None, roles=[], user_edited=False)

    roles = []
    for entry in profile.roles or []:
        role = taxonomy.get_role(entry.get("role_id"))
        if role is None:
            # A stored role that no longer exists in the taxonomy is skipped
            # rather than shown as a bare id.
            continue
        roles.append(
            ProfileRoleOut(
                role_id=role.id,
                label=role.label,
                qualifiers=entry.get("qualifiers") or {},
                evidence=entry.get("evidence") or "",
            )
        )

    return ProfileOut(
        personality_md=profile.personality_md,
        roles=roles,
        user_edited=profile.user_edited,
        updated_at=profile.updated_at,
    )


@router.get("", response_model=ProfileOut)
async def read_profile(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ProfileOut:
    return _serialize(await get_profile(db, current_user.id))


@router.get("/roles", response_model=list[RoleOut])
async def list_roles(current_user: User = Depends(get_current_user)) -> list[RoleOut]:
    """The 25-role framework, for rendering the profile editor."""
    return [
        RoleOut(
            id=r.id,
            index=r.index,
            label=r.label,
            description=r.description,
            group=r.group,
            qualifiers=[
                RoleQualifierOut(
                    id=q.id, label=q.label, exclusive=q.exclusive, options=list(q.options)
                )
                for q in r.qualifiers
            ],
        )
        for r in taxonomy.all_roles()
    ]


@router.put("", response_model=ProfileOut)
async def update_profile(
    payload: ProfileUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ProfileOut:
    """A hand-edited profile is marked `user_edited`, which stops inference
    from overwriting it - a correction that silently reverts would be worse
    than no profile at all.
    """
    profile = await get_profile(db, current_user.id)
    if profile is None:
        profile = UserProfile(user_id=current_user.id)
        db.add(profile)

    if payload.personality_md is not None:
        profile.personality_md = payload.personality_md.strip() or None
    if payload.roles is not None:
        profile.roles = [
            {
                "role_id": r.role_id,
                "qualifiers": taxonomy.validate_role_selection(r.role_id, r.qualifiers),
                "evidence": r.evidence,
            }
            for r in payload.roles
            if taxonomy.get_role(r.role_id) is not None
        ]

    profile.user_edited = True
    await db.commit()
    await db.refresh(profile)
    return _serialize(profile)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def clear_profile(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    """Forget everything inferred about this user, and let inference resume."""
    profile = await get_profile(db, current_user.id)
    if profile is not None:
        await db.delete(profile)
        await db.commit()


@router.post("/rebuild", status_code=status.HTTP_202_ACCEPTED)
async def request_rebuild(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    """Regenerate now from current history. Clears `user_edited` first, since
    asking for a rebuild is an explicit request to replace manual edits.
    """
    profile = await get_profile(db, current_user.id)
    if profile is not None and profile.user_edited:
        profile.user_edited = False
        await db.commit()

    rebuild_profile_task.delay(str(current_user.id))
    return {"status": "rebuilding"}
