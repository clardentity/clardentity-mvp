"""Deletes take their files in storage with them.

A chat takes the pictures drawn in it, a workspace its documents' files and
its chats' pictures, an account all of that plus every picture it ever had
drawn. Removal happens after the commit and never fails the delete: storage
being down leaves an orphaned file, not a chat the user deleted. The first
group runs without a database; the endpoint tests skip without one.
"""

import uuid

import httpx
import pytest

from app.db.session import AsyncSessionLocal
from app.main import app
from app.models import Conversation, Document, Message, Workspace
from app.services import storage, stored_files
from app.services.image_generation import storage_key as image_storage_key

API = "/api/v1"


def client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")


# --- Keys, prefixes and the best-effort removal -----------------------------


def test_a_picture_is_deleted_under_both_extensions_it_may_have():
    owner, image = uuid.uuid4(), uuid.uuid4()
    keys = stored_files.image_keys(
        [{"owner": str(owner), "id": str(image)}, None, {"id": "no-owner"}, "not a dict"]
    )
    assert keys == [f"generated/{owner}/{image}.webp", f"generated/{owner}/{image}.png"]


def test_the_accounts_picture_folder_holds_every_picture_it_drew():
    owner = uuid.uuid4()
    prefix = stored_files.generated_images_prefix(owner)
    assert image_storage_key(owner, uuid.uuid4()).startswith(prefix)
    assert not image_storage_key(uuid.uuid4(), uuid.uuid4()).startswith(prefix)


async def test_a_storage_failure_is_logged_and_never_raised(monkeypatch, caplog):
    attempted: list[str] = []

    def failing_delete(key):
        attempted.append(key)
        raise ConnectionError("storage is down")

    def failing_prefix(prefix):
        attempted.append(prefix)
        raise ConnectionError("storage is down")

    monkeypatch.setattr(stored_files, "delete_file", failing_delete)
    monkeypatch.setattr(stored_files, "delete_prefix", failing_prefix)

    await stored_files.remove(["a", "b", "a"], prefixes=["generated/u/"])

    # Every key is still tried after the first fails, each once.
    assert attempted == ["a", "b", "generated/u/"]
    assert caplog.text.count("not deleted") == 3


def test_a_prefix_is_deleted_a_page_at_a_time(monkeypatch):
    pages = [
        {"Contents": [{"Key": "generated/u/1.webp"}, {"Key": "generated/u/2.webp"}]},
        {},
        {"Contents": [{"Key": "generated/u/3.png"}]},
    ]
    calls: list[list[str]] = []

    class _Paginator:
        def paginate(self, Bucket, Prefix):
            assert Prefix == "generated/u/"
            return iter(pages)

    class _Client:
        def get_paginator(self, name):
            assert name == "list_objects_v2"
            return _Paginator()

        def delete_objects(self, Bucket, Delete):
            calls.append([o["Key"] for o in Delete["Objects"]])

    monkeypatch.setattr(storage, "get_s3_client", lambda: _Client())
    assert storage.delete_prefix("generated/u/") == 3
    assert calls == [["generated/u/1.webp", "generated/u/2.webp"], ["generated/u/3.png"]]


# --- The deletes themselves --------------------------------------------------


async def _account(c: httpx.AsyncClient) -> tuple[dict, str, uuid.UUID]:
    reg = await c.post(
        f"{API}/auth/register",
        json={
            "email": f"files-{uuid.uuid4().hex[:8]}@example.com",
            "password": "files-password-123",
            "accepted_terms": True,
        },
    )
    if reg.status_code >= 500:
        pytest.skip("no database available")
    assert reg.status_code == 201, reg.text
    headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
    user_id = uuid.UUID(reg.json()["user"]["id"])
    ws = (await c.get(f"{API}/workspaces", headers=headers)).json()[0]["id"]
    return headers, ws, user_id


async def _chat(c: httpx.AsyncClient, headers: dict, ws: str) -> str:
    res = await c.post(
        f"{API}/chat/conversations",
        json={"workspace_id": ws, "default_mode": None},
        headers=headers,
    )
    assert res.status_code == 201, res.text
    return res.json()["id"]


async def _picture(conversation_id: str, owner: uuid.UUID) -> str:
    image_id = str(uuid.uuid4())
    async with AsyncSessionLocal() as db:
        db.add(
            Message(
                conversation_id=uuid.UUID(conversation_id),
                role="assistant",
                content="Here it is.",
                mode_used="creative",
                generated_image={"id": image_id, "owner": str(owner), "prompt": "a fox"},
            )
        )
        await db.commit()
    return f"generated/{owner}/{image_id}.webp"


async def _document(workspace_id: str, owner: uuid.UUID) -> str:
    key = f"{workspace_id}/{uuid.uuid4()}/notes.pdf"
    async with AsyncSessionLocal() as db:
        db.add(
            Document(
                workspace_id=uuid.UUID(workspace_id),
                filename="notes.pdf",
                file_type="pdf",
                storage_path=key,
                status="processed",
                uploaded_by=owner,
            )
        )
        await db.commit()
    return key


@pytest.fixture
def deleted(monkeypatch) -> dict[str, list[str]]:
    seen: dict[str, list[str]] = {"keys": [], "prefixes": []}
    monkeypatch.setattr(stored_files, "delete_file", seen["keys"].append)

    def _prefix(prefix):
        seen["prefixes"].append(prefix)
        return 0

    monkeypatch.setattr(stored_files, "delete_prefix", _prefix)
    return seen


async def test_deleting_a_chat_takes_its_pictures_and_leaves_the_workspaces_files(deleted):
    async with client() as c:
        headers, ws, user_id = await _account(c)
        try:
            chat = await _chat(c, headers, ws)
            picture = await _picture(chat, user_id)
            document = await _document(ws, user_id)

            res = await c.delete(f"{API}/chat/conversations/{chat}", headers=headers)
            assert res.status_code == 204

            assert picture in deleted["keys"]
            assert document not in deleted["keys"], "a workspace file went with one chat"
        finally:
            await c.delete(f"{API}/auth/me", headers=headers)


async def test_deleting_a_workspace_takes_its_documents_and_pictures(deleted):
    async with client() as c:
        headers, _, user_id = await _account(c)
        try:
            res = await c.post(f"{API}/workspaces", json={"name": "Scratch"}, headers=headers)
            assert res.status_code == 201, res.text
            ws = res.json()["id"]
            chat = await _chat(c, headers, ws)
            picture = await _picture(chat, user_id)
            document = await _document(ws, user_id)

            res = await c.delete(f"{API}/workspaces/{ws}", headers=headers)
            assert res.status_code == 204

            assert picture in deleted["keys"]
            assert document in deleted["keys"]
        finally:
            await c.delete(f"{API}/auth/me", headers=headers)


async def test_deleting_the_account_takes_every_file_and_picture(deleted):
    async with client() as c:
        headers, ws, user_id = await _account(c)
        chat = await _chat(c, headers, ws)
        picture = await _picture(chat, user_id)
        document = await _document(ws, user_id)

        res = await c.delete(f"{API}/auth/me", headers=headers)
        assert res.status_code == 204

        assert picture in deleted["keys"]
        assert document in deleted["keys"]
        # And the pictures no row points at any more.
        assert deleted["prefixes"] == [f"generated/{user_id}/"]


async def test_storage_being_down_does_not_stop_a_delete(monkeypatch):
    def down(*_a):
        raise ConnectionError("storage is down")

    monkeypatch.setattr(stored_files, "delete_file", down)
    monkeypatch.setattr(stored_files, "delete_prefix", down)

    async with client() as c:
        headers, ws, user_id = await _account(c)
        try:
            res = await c.post(f"{API}/workspaces", json={"name": "Scratch"}, headers=headers)
            other_ws = res.json()["id"]
            chat = await _chat(c, headers, ws)
            await _picture(chat, user_id)
            await _document(other_ws, user_id)

            assert (await c.delete(f"{API}/chat/conversations/{chat}", headers=headers)).status_code == 204
            assert (await c.delete(f"{API}/workspaces/{other_ws}", headers=headers)).status_code == 204
            async with AsyncSessionLocal() as db:
                assert await db.get(Conversation, uuid.UUID(chat)) is None
                assert await db.get(Workspace, uuid.UUID(other_ws)) is None
        finally:
            res = await c.delete(f"{API}/auth/me", headers=headers)
            assert res.status_code == 204
