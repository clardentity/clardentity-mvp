"""The stored copies a delete leaves behind, and removing them.

Rows go by the schema's cascades; the objects in storage they point at do
not. A deleted chat leaves the pictures drawn in it, a deleted workspace its
documents' files and its chats' pictures, and a deleted account all of those
plus every picture it ever had drawn. Each delete collects the keys while the
rows still exist, commits, and only then removes the objects: storage being
down must not leave something the user deleted sitting in the database, and
an orphaned file is the lesser failure. So removal is best-effort - logged,
never raised - and runs inline after the commit, as temporary chats' cleanup
always has; a delete is rare enough that a few storage calls on its way out
cost nobody anything.
"""

import asyncio
import logging
import uuid
from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Conversation, Document, Message
from app.services.image_generation import storage_key as image_storage_key
from app.services.storage import delete_file, delete_prefix

logger = logging.getLogger("clardentity.stored_files")

# The serving route tries both; a delete of a key that was never written is a
# no-op, so both are deleted rather than the extension being recorded.
_IMAGE_EXTENSIONS = ("webp", "png")


def image_keys(images: Iterable[dict | None]) -> list[str]:
    """Storage keys for messages' `generated_image` values."""
    return [
        image_storage_key(image["owner"], image["id"], ext)
        for image in images
        if isinstance(image, dict) and image.get("owner") and image.get("id")
        for ext in _IMAGE_EXTENSIONS
    ]


def generated_images_prefix(user_id: uuid.UUID | str) -> str:
    """Every picture one account has had drawn, wherever it was drawn - the
    owner's folder in image_generation.storage_key."""
    return f"generated/{user_id}/"


async def keys_in_conversations(db: AsyncSession, conversation_ids: list[uuid.UUID]) -> list[str]:
    """Files that belong to these chats: what was attached inside a temporary
    one, and the pictures drawn in any. A file attached in an ordinary chat
    belongs to the workspace and stays with it."""
    if not conversation_ids:
        return []
    documents = (
        await db.execute(
            select(Document.storage_path).where(
                Document.conversation_id.in_(conversation_ids),
                Document.storage_path.is_not(None),
            )
        )
    ).scalars().all()
    images = (
        await db.execute(
            select(Message.generated_image).where(
                Message.conversation_id.in_(conversation_ids),
                Message.generated_image.is_not(None),
            )
        )
    ).scalars().all()
    return [*documents, *image_keys(images)]


async def keys_in_workspaces(db: AsyncSession, workspace_ids: list[uuid.UUID]) -> list[str]:
    """Every document's file in these workspaces, and the pictures drawn in
    their chats."""
    if not workspace_ids:
        return []
    documents = (
        await db.execute(
            select(Document.storage_path).where(
                Document.workspace_id.in_(workspace_ids),
                Document.storage_path.is_not(None),
            )
        )
    ).scalars().all()
    images = (
        await db.execute(
            select(Message.generated_image)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .where(
                Conversation.workspace_id.in_(workspace_ids),
                Message.generated_image.is_not(None),
            )
        )
    ).scalars().all()
    return [*documents, *image_keys(images)]


async def remove(keys: Iterable[str], *, prefixes: Iterable[str] = ()) -> None:
    """Delete these objects, and everything under these prefixes. Call after
    the commit. Never raises: see the module docstring."""
    for key in dict.fromkeys(keys):
        try:
            await asyncio.to_thread(delete_file, key)
        except Exception:  # noqa: BLE001 - see the module docstring
            logger.warning("stored file %s was not deleted", key, exc_info=True)
    for prefix in prefixes:
        try:
            await asyncio.to_thread(delete_prefix, prefix)
        except Exception:  # noqa: BLE001 - see the module docstring
            logger.warning("stored files under %s were not deleted", prefix, exc_info=True)
