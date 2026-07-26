import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models import User, Workspace, WorkspaceMember
from app.schemas.workspace import WorkspaceCreate, WorkspaceOut, WorkspaceUpdate

router = APIRouter(prefix="/workspaces", tags=["workspaces"])


async def _get_membership(
    db: AsyncSession, workspace_id: uuid.UUID, user_id: uuid.UUID
) -> WorkspaceMember | None:
    return await db.scalar(
        select(WorkspaceMember).where(
            WorkspaceMember.workspace_id == workspace_id,
            WorkspaceMember.user_id == user_id,
        )
    )


@router.post("", response_model=WorkspaceOut, status_code=status.HTTP_201_CREATED)
async def create_workspace(
    payload: WorkspaceCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WorkspaceOut:
    workspace = Workspace(owner_id=current_user.id, name=payload.name)
    db.add(workspace)
    await db.flush()

    db.add(WorkspaceMember(workspace_id=workspace.id, user_id=current_user.id, role="owner"))
    await db.commit()
    await db.refresh(workspace)

    return WorkspaceOut(
        id=workspace.id, name=workspace.name, role="owner", created_at=workspace.created_at
    )


@router.get("", response_model=list[WorkspaceOut])
async def list_workspaces(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[WorkspaceOut]:
    rows = await db.execute(
        select(Workspace, WorkspaceMember.role)
        .join(WorkspaceMember, WorkspaceMember.workspace_id == Workspace.id)
        .where(WorkspaceMember.user_id == current_user.id)
        .order_by(Workspace.created_at)
    )
    return [
        WorkspaceOut(id=ws.id, name=ws.name, role=role, created_at=ws.created_at)
        for ws, role in rows.all()
    ]


@router.get("/{workspace_id}", response_model=WorkspaceOut)
async def get_workspace(
    workspace_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WorkspaceOut:
    membership = await _get_membership(db, workspace_id, current_user.id)
    if membership is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")

    workspace = await db.get(Workspace, workspace_id)
    if workspace is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")

    return WorkspaceOut(
        id=workspace.id, name=workspace.name, role=membership.role, created_at=workspace.created_at
    )


@router.patch("/{workspace_id}", response_model=WorkspaceOut)
async def rename_workspace(
    workspace_id: uuid.UUID,
    payload: WorkspaceUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> WorkspaceOut:
    membership = await _get_membership(db, workspace_id, current_user.id)
    if membership is None or membership.role != "owner":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")

    workspace = await db.get(Workspace, workspace_id)
    if workspace is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")

    workspace.name = payload.name
    await db.commit()
    await db.refresh(workspace)

    return WorkspaceOut(id=workspace.id, name=workspace.name, role="owner", created_at=workspace.created_at)


@router.delete("/{workspace_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_workspace(
    workspace_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> None:
    membership = await _get_membership(db, workspace_id, current_user.id)
    if membership is None or membership.role != "owner":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Workspace not found")

    workspace = await db.get(Workspace, workspace_id)
    if workspace is not None:
        await db.delete(workspace)
        await db.commit()
