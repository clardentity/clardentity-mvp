"""Temporary chats: in no list, no search, no profile, and gone when left.

Each rule here is a promise the chat makes on screen ("won't appear in your
history, won't shape your profile, deleted when you leave it"), so each is
tested against the thing that would break it rather than against the flag.
Needs a database; skipped without one.
"""

import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from sqlalchemy import select, update

from app.db.session import AsyncSessionLocal
from app.main import app
from app.models import Conversation, Document, DocumentChunk, Message
from app.models.document import EMBEDDING_DIM
from app.services import stored_files, temporary_chats
from app.services.profile_service import gather_evidence
from app.services.retrieval import retrieve_chunks

API = "/api/v1"


def client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")


async def _account(c: httpx.AsyncClient) -> tuple[dict, str, uuid.UUID]:
    reg = await c.post(
        f"{API}/auth/register",
        json={
            "email": f"temp-{uuid.uuid4().hex[:8]}@example.com",
            "password": "temp-password-123",
            "display_name": "Temp",
            "accepted_terms": True,
        },
    )
    if reg.status_code >= 500:
        pytest.skip("no database available")
    assert reg.status_code == 201, reg.text
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    me = (await c.get(f"{API}/auth/me", headers=headers)).json()
    ws = (await c.get(f"{API}/workspaces", headers=headers)).json()[0]["id"]
    return headers, ws, uuid.UUID(me["id"])


async def _chat(c: httpx.AsyncClient, headers: dict, ws: str, *, temporary: bool) -> dict:
    res = await c.post(
        f"{API}/chat/conversations",
        json={"workspace_id": ws, "default_mode": None, "temporary": temporary},
        headers=headers,
    )
    assert res.status_code == 201, res.text
    return res.json()


async def _say(conversation_id: str, text: str) -> None:
    async with AsyncSessionLocal() as db:
        db.add(
            Message(
                conversation_id=uuid.UUID(conversation_id),
                role="user",
                content=text,
                mode_used="knowing",
            )
        )
        await db.commit()


async def _attach(workspace_id: str, user_id: uuid.UUID, conversation_id: str | None) -> uuid.UUID:
    """A processed document with one embedded chunk, as ingestion leaves it."""
    async with AsyncSessionLocal() as db:
        document = Document(
            workspace_id=uuid.UUID(workspace_id),
            conversation_id=uuid.UUID(conversation_id) if conversation_id else None,
            filename="lease.pdf",
            file_type="pdf",
            storage_path=f"{workspace_id}/{uuid.uuid4()}/lease.pdf",
            status="processed",
            uploaded_by=user_id,
        )
        db.add(document)
        await db.flush()
        db.add(
            DocumentChunk(
                document_id=document.id,
                chunk_index=0,
                content="The deposit is returned within thirty days.",
                embedding=[1.0] * EMBEDDING_DIM,
            )
        )
        await db.commit()
        return document.id


class TestTemporaryChats:
    async def test_it_is_in_no_list_and_no_search(self):
        async with client() as c:
            headers, ws, _ = await _account(c)
            try:
                kept = await _chat(c, headers, ws, temporary=False)
                temp = await _chat(c, headers, ws, temporary=True)
                assert temp["temporary"] is True
                assert kept["temporary"] is False

                listed = (
                    await c.get(f"{API}/chat/conversations", params={"workspace_id": ws}, headers=headers)
                ).json()
                assert [x["id"] for x in listed] == [kept["id"]]

                # Still openable by its owner - it is the chat on screen.
                opened = await c.get(f"{API}/chat/conversations/{temp['id']}", headers=headers)
                assert opened.status_code == 200
                assert opened.json()["temporary"] is True

                await _say(kept["id"], "zanzibar kept question")
                await _say(temp["id"], "zanzibar temporary question")
                hits = (
                    await c.get(
                        f"{API}/history/search",
                        params={"workspace_id": ws, "q": "zanzibar"},
                        headers=headers,
                    )
                ).json()
                assert {h["conversation_id"] for h in hits} == {kept["id"]}
            finally:
                await c.delete(f"{API}/auth/me", headers=headers)

    async def test_sign_in_never_hands_back_a_temporary_chat(self):
        """Temporary chats are never named, so they look exactly like the empty
        chat bootstrap reuses - a null title. Without the exclusion the next
        sign-in drops you back into the chat you were leaving."""
        async with client() as c:
            headers, ws, _ = await _account(c)
            try:
                opened = (await c.post(f"{API}/bootstrap", json={"workspace_id": ws}, headers=headers)).json()
                # The empty chat gets used, so it is no longer reusable...
                async with AsyncSessionLocal() as db:
                    await db.execute(
                        update(Conversation)
                        .where(Conversation.id == uuid.UUID(opened["conversation_id"]))
                        .values(title="Asked something")
                    )
                    await db.commit()
                # ...leaving a temporary chat as the only untitled one.
                temp = await _chat(c, headers, ws, temporary=True)
                await _say(temp["id"], "something private")

                again = (await c.post(f"{API}/bootstrap", json={"workspace_id": ws}, headers=headers)).json()
                assert again["conversation_id"] != temp["id"]
                assert again["conversation_created"] is True
            finally:
                await c.delete(f"{API}/auth/me", headers=headers)

    async def test_it_does_not_feed_the_profile(self):
        async with client() as c:
            headers, ws, user_id = await _account(c)
            try:
                kept = await _chat(c, headers, ws, temporary=False)
                temp = await _chat(c, headers, ws, temporary=True)
                await _say(kept["id"], "I teach chemistry at a school in Kochi")
                await _say(temp["id"], "I am secretly a trapeze artist")
                await _attach(ws, user_id, temp["id"])

                async with AsyncSessionLocal() as db:
                    evidence, total = await gather_evidence(db, user_id)
                assert total == 1, "the temporary chat's message was counted"
                assert "chemistry" in evidence
                assert "trapeze" not in evidence
                assert "lease.pdf" not in evidence, "a temporary chat's file reached the profile"
            finally:
                await c.delete(f"{API}/auth/me", headers=headers)

    async def test_its_files_belong_to_it_alone(self, monkeypatch):
        async def fake_embed(_text):
            return [1.0] * EMBEDDING_DIM

        monkeypatch.setattr("app.services.retrieval.embed_text", fake_embed)

        async with client() as c:
            headers, ws, user_id = await _account(c)
            try:
                temp = await _chat(c, headers, ws, temporary=True)
                other = await _chat(c, headers, ws, temporary=False)
                await _attach(ws, user_id, temp["id"])

                # Not in the workspace's Attachments, nor its room-wide search.
                docs = (await c.get(f"{API}/documents", params={"workspace_id": ws}, headers=headers)).json()
                assert docs == []
                found = (
                    await c.get(
                        f"{API}/documents/search",
                        params={"workspace_id": ws, "q": "deposit"},
                        headers=headers,
                    )
                ).json()
                assert found["total"] == 0

                # Read by the temporary chat, by no other.
                async with AsyncSessionLocal() as db:
                    here = await retrieve_chunks(
                        db, uuid.UUID(ws), "deposit", "rapid", conversation_id=uuid.UUID(temp["id"])
                    )
                    elsewhere = await retrieve_chunks(
                        db, uuid.UUID(ws), "deposit", "rapid", conversation_id=uuid.UUID(other["id"])
                    )
                    unscoped = await retrieve_chunks(db, uuid.UUID(ws), "deposit", "rapid")
                assert [rc.chunk.content for rc in here] == ["The deposit is returned within thirty days."]
                assert elsewhere == []
                assert unscoped == []
            finally:
                await c.delete(f"{API}/auth/me", headers=headers)

    async def test_leaving_it_deletes_it_with_its_files_and_pictures(self, monkeypatch):
        deleted: list[str] = []
        monkeypatch.setattr(stored_files, "delete_file", deleted.append)

        async with client() as c:
            headers, ws, user_id = await _account(c)
            try:
                temp = await _chat(c, headers, ws, temporary=True)
                document_id = await _attach(ws, user_id, temp["id"])
                image_id = str(uuid.uuid4())
                async with AsyncSessionLocal() as db:
                    db.add(
                        Message(
                            conversation_id=uuid.UUID(temp["id"]),
                            role="assistant",
                            content="Here it is.",
                            mode_used="creative",
                            generated_image={"id": image_id, "owner": str(user_id), "prompt": "a fox"},
                        )
                    )
                    stored = (
                        await db.execute(select(Document.storage_path).where(Document.id == document_id))
                    ).scalar_one()
                    await db.commit()

                res = await c.delete(f"{API}/chat/conversations/{temp['id']}", headers=headers)
                assert res.status_code == 204

                async with AsyncSessionLocal() as db:
                    assert await db.get(Conversation, uuid.UUID(temp["id"])) is None
                    assert await db.get(Document, document_id) is None, "its file outlived it"
                assert stored in deleted
                assert f"generated/{user_id}/{image_id}.webp" in deleted
            finally:
                await c.delete(f"{API}/auth/me", headers=headers)

    async def test_an_abandoned_one_is_swept_after_a_day(self, monkeypatch):
        monkeypatch.setattr(stored_files, "delete_file", lambda _key: None)

        async with client() as c:
            headers, ws, user_id = await _account(c)
            try:
                stale = await _chat(c, headers, ws, temporary=True)
                fresh = await _chat(c, headers, ws, temporary=True)
                old_kept = await _chat(c, headers, ws, temporary=False)
                long_ago = datetime.now(UTC) - timedelta(days=2)
                async with AsyncSessionLocal() as db:
                    await db.execute(
                        update(Conversation)
                        .where(Conversation.id.in_([uuid.UUID(stale["id"]), uuid.UUID(old_kept["id"])]))
                        .values(created_at=long_ago)
                    )
                    await db.commit()

                async with AsyncSessionLocal() as db:
                    swept = await temporary_chats.sweep_idle(db, user_id)
                assert swept == 1

                async with AsyncSessionLocal() as db:
                    assert await db.get(Conversation, uuid.UUID(stale["id"])) is None
                    assert await db.get(Conversation, uuid.UUID(fresh["id"])) is not None
                    assert await db.get(Conversation, uuid.UUID(old_kept["id"])) is not None, (
                        "an ordinary chat was swept"
                    )
            finally:
                await c.delete(f"{API}/auth/me", headers=headers)
