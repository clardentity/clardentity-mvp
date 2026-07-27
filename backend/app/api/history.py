import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, require_workspace_member
from app.db.session import get_db
from app.models import User
from app.schemas.history import SearchResultOut

router = APIRouter(prefix="/history", tags=["history"])


@router.get("/search", response_model=list[SearchResultOut])
async def search_history(
    workspace_id: uuid.UUID,
    q: str = Query(min_length=1),
    limit: int = Query(default=20, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> list[SearchResultOut]:
    await require_workspace_member(db, workspace_id, current_user.id)

    # FR12: matches the expression in ix_messages_content_fts exactly so
    # Postgres can use the GIN index instead of a sequential scan.
    rows = await db.execute(
        text(
            """
            SELECT m.id AS message_id, m.conversation_id, c.title AS conversation_title,
                   m.role, m.content, m.mode_used, m.created_at,
                   ts_rank(to_tsvector('english', coalesce(m.content, '')), plainto_tsquery('english', :q)) AS rank
            FROM messages m
            JOIN conversations c ON c.id = m.conversation_id
            WHERE c.workspace_id = :workspace_id
              AND to_tsvector('english', coalesce(m.content, '')) @@ plainto_tsquery('english', :q)
            ORDER BY rank DESC
            LIMIT :limit
            """
        ),
        {"workspace_id": str(workspace_id), "q": q, "limit": limit},
    )
    return [
        SearchResultOut(
            message_id=row.message_id,
            conversation_id=row.conversation_id,
            conversation_title=row.conversation_title,
            role=row.role,
            content=row.content or "",
            mode_used=row.mode_used,
            created_at=row.created_at,
            rank=row.rank,
        )
        for row in rows.all()
    ]
