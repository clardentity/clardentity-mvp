import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import User, UserProfile
from app.schemas.profile import (
    ProfileAspectIn,
    ProfileAspectOut,
    ProfileOut,
    ProfileRoleOut,
    ProfileUpdate,
    RoleOut,
    RoleQualifierOut,
)
from app.services import taxonomy
from app.services.companion_names import clean_names
from app.services.output_cleanup import clean_output
from app.services.chat_import import UnreadableExport, parse_export
from app.services.profile_service import get_profile
from app.workers.rebuild_profile import rebuild_profile_task

router = APIRouter(prefix="/profile", tags=["profile"])


def _serialize(profile: UserProfile | None, companion_names: dict | None = None) -> ProfileOut:
    if profile is None:
        return ProfileOut(personality_md=None, aspects=[], roles=[], user_edited=False)

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
        companion_names=clean_names(companion_names),
        aspects=[
            ProfileAspectOut(
                id=str(a.get("id") or ""),
                label=a.get("label") or "",
                value=a.get("value") or "",
                source=a.get("source") or "inferred",
            )
            for a in (profile.aspects or [])
            if a.get("label") and a.get("value")
        ],
        roles=roles,
        user_edited=profile.user_edited,
        updated_at=profile.updated_at,
    )


@router.get("", response_model=ProfileOut)
async def read_profile(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ProfileOut:
    return _serialize(await get_profile(db, current_user.id), current_user.companion_names)


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

    if payload.companion_names is not None:
        # Stored on the user, not the profile: naming your companion is a
        # preference about the product, not something inferred about you, and
        # it must survive a profile rebuild.
        current_user.companion_names = clean_names(payload.companion_names) or None

    profile.user_edited = True
    await db.commit()
    await db.refresh(profile)
    return _serialize(profile, current_user.companion_names)


_MAX_ASPECTS = 40


@router.post("/aspects", response_model=ProfileOut, status_code=status.HTTP_201_CREATED)
async def add_aspect(
    payload: ProfileAspectIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ProfileOut:
    """Add one fact about yourself.

    Marked `source: "user"`, which is what protects it from being replaced the
    next time inference runs. Unlike the old whole-document edit, adding one
    aspect does not freeze the rest of the profile.
    """
    label = clean_output(payload.label)[:40].strip()
    value = clean_output(payload.value)[:400].strip()
    if not label or not value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An aspect needs both a label and a value",
        )

    profile = await get_profile(db, current_user.id)
    if profile is None:
        profile = UserProfile(user_id=current_user.id)
        db.add(profile)

    aspects = list(profile.aspects or [])
    if len(aspects) >= _MAX_ASPECTS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"A profile holds at most {_MAX_ASPECTS} aspects",
        )
    # Same label twice is a correction, not a second fact.
    aspects = [a for a in aspects if a.get("label", "").lower() != label.lower()]
    aspects.append(
        {"id": str(uuid.uuid4()), "label": label, "value": value, "source": "user"}
    )
    profile.aspects = aspects

    await db.commit()
    await db.refresh(profile)
    return _serialize(profile, current_user.companion_names)


@router.delete("/aspects/{aspect_id}", response_model=ProfileOut)
async def remove_aspect(
    aspect_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> ProfileOut:
    """Drop one aspect. Deleting a wrong inferred fact no longer means
    discarding the whole profile to get rid of it."""
    profile = await get_profile(db, current_user.id)
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No profile yet")

    profile.aspects = [a for a in (profile.aspects or []) if a.get("id") != aspect_id]
    await db.commit()
    await db.refresh(profile)
    return _serialize(profile, current_user.companion_names)


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


# Bigger than any plausible export of *messages* after filtering, small enough
# that a mistaken upload of something else is rejected before it is parsed.
MAX_IMPORT_BYTES = 60 * 1024 * 1024


@router.post("/import", status_code=status.HTTP_202_ACCEPTED)
async def import_history(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Seed the profile from a ChatGPT, Claude or Gemini data export.

    There is no API to read another assistant's history and there isn't going
    to be one, so this takes the file the provider gives the user directly.
    Only their own messages are kept; the other assistant's replies are
    discarded on parse and never stored.
    """
    raw = await file.read()
    if len(raw) > MAX_IMPORT_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="That file is too large. Export files over 60MB usually contain "
            "attachments - upload conversations.json on its own.",
        )

    try:
        history = parse_export(raw)
    except UnreadableExport as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    profile = await get_profile(db, current_user.id)
    if profile is None:
        profile = UserProfile(user_id=current_user.id)
        db.add(profile)

    profile.imported_context = history.text
    profile.imported_source = history.source
    profile.imported_at = datetime.now(timezone.utc)
    # An import is new evidence, so the inferred profile is now out of date.
    # Clearing user_edited matches /rebuild: asking for this is asking for the
    # picture to be redrawn.
    profile.user_edited = False
    await db.commit()

    rebuild_profile_task.delay(str(current_user.id))
    return {
        "status": "importing",
        "source": history.source,
        "messages": len(history.messages),
        "conversations": history.conversations,
    }
