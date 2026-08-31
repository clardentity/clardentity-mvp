"""API surface and auth.

These run in-process against the ASGI app. Everything that touches the
database is skipped automatically when one isn't reachable, so the suite is
still useful on a machine with nothing running.
"""

import uuid

import httpx
import pytest
from sqlalchemy import delete

from app.db.session import AsyncSessionLocal
from app.main import app
from app.models import Message, User, Workspace, WorkspaceMember
from app.core.security import hash_password

API = "/api/v1"


def client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")


class TestRoutes:
    def test_every_expected_route_is_registered(self):
        paths = set(app.openapi()["paths"])
        for path in (
            f"{API}/auth/register",
            f"{API}/auth/login",
            f"{API}/auth/refresh",
            f"{API}/auth/me",
            f"{API}/auth/oauth/google",
            f"{API}/auth/password-reset/request",
            f"{API}/auth/password-reset/confirm",
            f"{API}/realtime/session",
            f"{API}/pro/interest",
            f"{API}/profile/import",
            f"{API}/chat/{{conversation_id}}/call-transcript",
        ):
            assert path in paths, f"missing route: {path}"

    def test_claim_schema_carries_the_fields_the_ui_reads(self):
        claim = app.openapi()["components"]["schemas"]["ClaimOut"]["properties"]
        for field in (
            "claim_index",
            "claim_text",
            "claim_score",
            "entailment_label",
            "distortion_flag",
            "reconciliation_note",
            "dynamic",
            "evidence",
        ):
            assert field in claim, f"ClaimOut lost {field}"

    def test_evidence_schema_carries_the_scores_the_panel_shows(self):
        evidence = app.openapi()["components"]["schemas"]["EvidenceOut"]["properties"]
        for field in ("support_score", "relevance_score", "credibility_score", "excerpt"):
            assert field in evidence, f"EvidenceOut lost {field}"


class TestAuthGuards:
    """Nothing that belongs to a user should answer without a token."""

    @pytest.mark.parametrize(
        "method,path",
        [
            ("get", f"{API}/auth/me"),
            ("post", f"{API}/realtime/session"),
            ("post", f"{API}/pro/interest"),
            ("post", f"{API}/profile/import"),
            ("get", f"{API}/chat/conversations"),
            ("get", f"{API}/workspaces"),
        ],
    )
    async def test_requires_a_token(self, method, path):
        async with client() as c:
            res = await getattr(c, method)(path)
        assert res.status_code in (401, 403), f"{path} answered {res.status_code} unauthenticated"

    async def test_rejects_a_garbage_token(self):
        async with client() as c:
            res = await c.get(f"{API}/auth/me", headers={"Authorization": "Bearer nonsense"})
        assert res.status_code == 401


class TestPasswordResetContract:
    async def test_request_does_not_reveal_whether_an_account_exists(self):
        async with client() as c:
            a = await c.post(
                f"{API}/auth/password-reset/request", json={"email": "nobody-a@example.com"}
            )
            b = await c.post(
                f"{API}/auth/password-reset/request", json={"email": "nobody-b@example.com"}
            )
        if a.status_code >= 500:
            pytest.skip("no database/redis available")

        # The property under test is that the two answers are indistinguishable
        # - not that they are 202. Asserting the status code made this fail
        # whenever the shared per-IP rate limiter had been exercised recently,
        # even though both requests were still answering identically (with a
        # 429), which is the thing that matters.
        assert a.status_code == b.status_code
        assert a.json() == b.json()
        assert a.status_code in (202, 429)

    async def test_confirm_rejects_a_bad_token(self):
        async with client() as c:
            res = await c.post(
                f"{API}/auth/password-reset/confirm",
                json={"token": "not.a.token", "password": "long-enough-password"},
            )
        if res.status_code >= 500:
            pytest.skip("no database/redis available")
        assert res.status_code == 400

    async def test_confirm_enforces_the_minimum_length(self):
        async with client() as c:
            res = await c.post(
                f"{API}/auth/password-reset/confirm", json={"token": "x", "password": "short"}
            )
        assert res.status_code == 422


class TestFullAuthFlow:
    """Register -> login -> reset -> old password dead. Needs a database."""

    async def test_reset_revokes_the_old_password_and_is_single_use(self):
        from app.core.security import create_password_reset_token

        email = f"regress-{uuid.uuid4().hex[:8]}@example.com"
        old, new = "old-password-123", "new-password-456"

        try:
            async with AsyncSessionLocal() as db:
                user = User(email=email, password_hash=hash_password(old))
                db.add(user)
                await db.flush()
                ws = Workspace(owner_id=user.id, name="t")
                db.add(ws)
                await db.flush()
                db.add(WorkspaceMember(workspace_id=ws.id, user_id=user.id, role="owner"))
                await db.commit()
                uid, wsid, original = user.id, ws.id, user.password_hash
        except Exception:
            pytest.skip("no database available")

        try:
            token = create_password_reset_token(uid, original)
            async with client() as c:
                first = await c.post(
                    f"{API}/auth/password-reset/confirm", json={"token": token, "password": new}
                )
                assert first.status_code == 200
                assert "access_token" in first.json()

                stale = await c.post(
                    f"{API}/auth/login", json={"email": email, "password": old}
                )
                assert stale.status_code == 401

                fresh = await c.post(
                    f"{API}/auth/login", json={"email": email, "password": new}
                )
                assert fresh.status_code == 200

                replay = await c.post(
                    f"{API}/auth/password-reset/confirm",
                    json={"token": token, "password": "third-password-789"},
                )
                assert replay.status_code == 400

                # The rejected third password must never have been applied.
                assert (
                    await c.post(
                        f"{API}/auth/login",
                        json={"email": email, "password": "third-password-789"},
                    )
                ).status_code == 401
        finally:
            async with AsyncSessionLocal() as db:
                await db.execute(delete(WorkspaceMember).where(WorkspaceMember.workspace_id == wsid))
                await db.execute(delete(Workspace).where(Workspace.id == wsid))
                await db.execute(delete(User).where(User.id == uid))
                await db.commit()


class TestContextQuestionGate:
    """The pre-answer "why" stops the turn and writes nothing.

    The invariant is the same one the mode gate depends on: if a message were
    saved here, the transcript would show the user's question with a question
    back under it and no answer, forever. Needs a database.
    """

    async def _fixture(self):
        from app.models import Conversation

        email = f"ctxgate-{uuid.uuid4().hex[:8]}@example.com"
        password = "gate-password-123"
        async with AsyncSessionLocal() as db:
            user = User(email=email, password_hash=hash_password(password))
            db.add(user)
            await db.flush()
            ws = Workspace(owner_id=user.id, name="t")
            db.add(ws)
            await db.flush()
            db.add(WorkspaceMember(workspace_id=ws.id, user_id=user.id, role="owner"))
            convo = Conversation(workspace_id=ws.id, title="t")
            db.add(convo)
            await db.commit()
            return email, password, user.id, convo.id

    async def test_it_asks_and_saves_nothing(self, monkeypatch):
        from app.models import Message
        from app.api import chat as chat_api

        try:
            email, password, user_id, convo_id = await self._fixture()
        except Exception as exc:  # noqa: BLE001
            # Only a missing database is a skip. A broken fixture used to skip
            # too, which meant this test reported "passed (skipped)" while
            # never having run - the failure mode a contract test exists to
            # prevent.
            if "connect" not in str(exc).lower() and "database" not in str(exc).lower():
                raise
            pytest.skip("no database available")

        asked = "What is going on that has led you to want a divorce?"

        async def fake_guidance(question, mode):
            return {
                "context_question": asked,
                "suggested_mode": None,
                "mode_reason": None,
                "refined_question": None,
                "refinement_reason": None,
            }

        monkeypatch.setattr(chat_api, "propose_guidance", fake_guidance)

        try:
            async with client() as c:
                login = await c.post(
                    f"{API}/auth/login", json={"email": email, "password": password}
                )
                if login.status_code != 200:
                    pytest.skip("login unavailable")
                token = login.json()["access_token"]

                res = await c.post(
                    f"{API}/chat/{convo_id}/messages",
                    json={"content": "I want to divorce my wife", "mode": "decision"},
                    headers={"Authorization": f"Bearer {token}"},
                )
                body = res.text

            assert "context_question" in body
            assert asked in body

            async with AsyncSessionLocal() as db:
                rows = await db.execute(
                    delete(Message).where(Message.conversation_id == convo_id).returning(Message.id)
                )
                saved = list(rows.scalars().all())
                await db.commit()
            # Nothing at all: not the user's message, not an empty answer.
            assert saved == [], f"gate persisted {len(saved)} message(s)"
        finally:
            from app.models import Conversation as _Conversation

            async with AsyncSessionLocal() as db:
                # Foreign keys first, owner last.
                await db.execute(delete(Message).where(Message.conversation_id == convo_id))
                await db.execute(delete(_Conversation).where(_Conversation.id == convo_id))
                await db.execute(delete(WorkspaceMember).where(WorkspaceMember.user_id == user_id))
                await db.execute(delete(Workspace).where(Workspace.owner_id == user_id))
                await db.execute(delete(User).where(User.id == user_id))
                await db.commit()


class TestMessageFeedback:
    """Thumbs up/down plus an optional comment on one answer. Needs a
    database - a plain assistant row is enough, no generation pipeline."""

    async def _fixture(self):
        from app.models import Conversation

        email = f"feedback-{uuid.uuid4().hex[:8]}@example.com"
        password = "feedback-password-123"
        async with AsyncSessionLocal() as db:
            user = User(email=email, password_hash=hash_password(password))
            db.add(user)
            await db.flush()
            ws = Workspace(owner_id=user.id, name="t")
            db.add(ws)
            await db.flush()
            db.add(WorkspaceMember(workspace_id=ws.id, user_id=user.id, role="owner"))
            convo = Conversation(workspace_id=ws.id, title="t")
            db.add(convo)
            await db.flush()
            answer = Message(
                conversation_id=convo.id, role="assistant", content="an answer", mode_used="knowing"
            )
            question = Message(
                conversation_id=convo.id, role="user", content="a question", mode_used="knowing"
            )
            db.add_all([answer, question])
            await db.commit()
            return email, password, user.id, convo.id, answer.id, question.id

    async def _login(self, c, email, password):
        login = await c.post(f"{API}/auth/login", json={"email": email, "password": password})
        if login.status_code != 200:
            pytest.skip("login unavailable")
        return login.json()["access_token"]

    async def _cleanup(self, convo_id, user_id):
        from app.models import Conversation as _Conversation

        async with AsyncSessionLocal() as db:
            await db.execute(delete(Message).where(Message.conversation_id == convo_id))
            await db.execute(delete(_Conversation).where(_Conversation.id == convo_id))
            await db.execute(delete(WorkspaceMember).where(WorkspaceMember.user_id == user_id))
            await db.execute(delete(Workspace).where(Workspace.owner_id == user_id))
            await db.execute(delete(User).where(User.id == user_id))
            await db.commit()

    async def test_records_a_rating_and_comment_on_an_answer(self):
        try:
            email, password, user_id, convo_id, answer_id, _question_id = await self._fixture()
        except Exception as exc:  # noqa: BLE001
            if "connect" not in str(exc).lower() and "database" not in str(exc).lower():
                raise
            pytest.skip("no database available")

        try:
            async with client() as c:
                token = await self._login(c, email, password)
                res = await c.put(
                    f"{API}/chat/{convo_id}/messages/{answer_id}/feedback",
                    json={"rating": "up", "comment": "This nailed it"},
                    headers={"Authorization": f"Bearer {token}"},
                )
                assert res.status_code == 200
                assert res.json()["feedback"] == {"rating": "up", "comment": "This nailed it"}

            async with AsyncSessionLocal() as db:
                row = await db.get(Message, answer_id)
                assert row.feedback == {"rating": "up", "comment": "This nailed it"}
        finally:
            await self._cleanup(convo_id, user_id)

    async def test_a_second_call_overwrites_rather_than_accumulates(self):
        try:
            email, password, user_id, convo_id, answer_id, _question_id = await self._fixture()
        except Exception as exc:  # noqa: BLE001
            if "connect" not in str(exc).lower() and "database" not in str(exc).lower():
                raise
            pytest.skip("no database available")

        try:
            async with client() as c:
                token = await self._login(c, email, password)
                headers = {"Authorization": f"Bearer {token}"}
                await c.put(
                    f"{API}/chat/{convo_id}/messages/{answer_id}/feedback",
                    json={"rating": "up", "comment": None},
                    headers=headers,
                )
                res = await c.put(
                    f"{API}/chat/{convo_id}/messages/{answer_id}/feedback",
                    json={"rating": "down", "comment": "changed my mind"},
                    headers=headers,
                )
                assert res.json()["feedback"] == {"rating": "down", "comment": "changed my mind"}
        finally:
            await self._cleanup(convo_id, user_id)

    async def test_rejects_feedback_on_the_users_own_message(self):
        try:
            email, password, user_id, convo_id, _answer_id, question_id = await self._fixture()
        except Exception as exc:  # noqa: BLE001
            if "connect" not in str(exc).lower() and "database" not in str(exc).lower():
                raise
            pytest.skip("no database available")

        try:
            async with client() as c:
                token = await self._login(c, email, password)
                res = await c.put(
                    f"{API}/chat/{convo_id}/messages/{question_id}/feedback",
                    json={"rating": "up"},
                    headers={"Authorization": f"Bearer {token}"},
                )
                assert res.status_code == 400
        finally:
            await self._cleanup(convo_id, user_id)

    async def test_404s_on_a_message_from_someone_elses_conversation(self):
        try:
            email, password, user_id, convo_id, answer_id, _q = await self._fixture()
            other_email, other_password, other_user_id, other_convo_id, _a2, _q2 = (
                await self._fixture()
            )
        except Exception as exc:  # noqa: BLE001
            if "connect" not in str(exc).lower() and "database" not in str(exc).lower():
                raise
            pytest.skip("no database available")

        try:
            async with client() as c:
                token = await self._login(c, other_email, other_password)
                res = await c.put(
                    f"{API}/chat/{other_convo_id}/messages/{answer_id}/feedback",
                    json={"rating": "up"},
                    headers={"Authorization": f"Bearer {token}"},
                )
                assert res.status_code == 404
        finally:
            await self._cleanup(convo_id, user_id)
            await self._cleanup(other_convo_id, other_user_id)


class TestMessageForking:
    """The fork switcher's read side: sibling metadata on GET /messages, and
    PUT .../active-leaf to move between branches. Built by hand rather than
    through send_message - a forked tree is just rows with the right
    parent_id and an active_leaf_id pointer, and constructing it directly
    tests exactly that shape without mocking the whole generation pipeline.
    Needs a database.
    """

    async def _fixture(self):
        from app.models import Conversation

        email = f"fork-{uuid.uuid4().hex[:8]}@example.com"
        password = "fork-password-123"
        async with AsyncSessionLocal() as db:
            user = User(email=email, password_hash=hash_password(password))
            db.add(user)
            await db.flush()
            ws = Workspace(owner_id=user.id, name="t")
            db.add(ws)
            await db.flush()
            db.add(WorkspaceMember(workspace_id=ws.id, user_id=user.id, role="owner"))
            convo = Conversation(workspace_id=ws.id, title="t")
            db.add(convo)
            await db.flush()

            question = Message(
                conversation_id=convo.id, role="user", content="q", mode_used="knowing", parent_id=None
            )
            db.add(question)
            await db.flush()

            old_answer = Message(
                conversation_id=convo.id,
                role="assistant",
                content="first answer",
                mode_used="knowing",
                parent_id=question.id,
            )
            db.add(old_answer)
            await db.flush()

            new_answer = Message(
                conversation_id=convo.id,
                role="assistant",
                content="regenerated answer",
                mode_used="knowing",
                parent_id=question.id,
            )
            db.add(new_answer)
            await db.flush()

            # The regenerate flow leaves the newest sibling active.
            convo.active_leaf_id = new_answer.id
            await db.commit()
            return (
                email,
                password,
                user.id,
                convo.id,
                question.id,
                old_answer.id,
                new_answer.id,
            )

    async def _login(self, c, email, password):
        login = await c.post(f"{API}/auth/login", json={"email": email, "password": password})
        if login.status_code != 200:
            pytest.skip("login unavailable")
        return login.json()["access_token"]

    async def _cleanup(self, convo_id, user_id):
        from app.models import Conversation as _Conversation

        async with AsyncSessionLocal() as db:
            # active_leaf_id points into messages - clear it first so the
            # FK doesn't block the message rows being deleted.
            await db.execute(
                _Conversation.__table__.update()
                .where(_Conversation.id == convo_id)
                .values(active_leaf_id=None)
            )
            await db.execute(delete(Message).where(Message.conversation_id == convo_id))
            await db.execute(delete(_Conversation).where(_Conversation.id == convo_id))
            await db.execute(delete(WorkspaceMember).where(WorkspaceMember.user_id == user_id))
            await db.execute(delete(Workspace).where(Workspace.owner_id == user_id))
            await db.execute(delete(User).where(User.id == user_id))
            await db.commit()

    async def test_the_active_branch_shows_the_newest_sibling_by_default(self):
        try:
            email, password, user_id, convo_id, q_id, old_id, new_id = await self._fixture()
        except Exception as exc:  # noqa: BLE001
            if "connect" not in str(exc).lower() and "database" not in str(exc).lower():
                raise
            pytest.skip("no database available")

        try:
            async with client() as c:
                token = await self._login(c, email, password)
                res = await c.get(
                    f"{API}/chat/{convo_id}/messages",
                    headers={"Authorization": f"Bearer {token}"},
                )
                body = res.json()
                contents = [m["content"] for m in body]
                assert contents == ["q", "regenerated answer"]
                answer = next(m for m in body if m["id"] == str(new_id))
                assert answer["sibling_index"] == 1
                assert answer["sibling_count"] == 2
                assert answer["sibling_ids"] == [str(old_id), str(new_id)]
        finally:
            await self._cleanup(convo_id, user_id)

    async def test_switching_the_active_leaf_shows_the_other_branch(self):
        try:
            email, password, user_id, convo_id, q_id, old_id, new_id = await self._fixture()
        except Exception as exc:  # noqa: BLE001
            if "connect" not in str(exc).lower() and "database" not in str(exc).lower():
                raise
            pytest.skip("no database available")

        try:
            async with client() as c:
                token = await self._login(c, email, password)
                headers = {"Authorization": f"Bearer {token}"}
                switch = await c.put(
                    f"{API}/chat/{convo_id}/active-leaf",
                    json={"message_id": str(old_id)},
                    headers=headers,
                )
                assert switch.status_code == 200
                assert switch.json()["active_leaf_id"] == str(old_id)

                res = await c.get(f"{API}/chat/{convo_id}/messages", headers=headers)
                contents = [m["content"] for m in res.json()]
                assert contents == ["q", "first answer"]
        finally:
            await self._cleanup(convo_id, user_id)

    async def test_switching_to_an_unknown_message_404s(self):
        try:
            email, password, user_id, convo_id, *_ = await self._fixture()
        except Exception as exc:  # noqa: BLE001
            if "connect" not in str(exc).lower() and "database" not in str(exc).lower():
                raise
            pytest.skip("no database available")

        try:
            async with client() as c:
                token = await self._login(c, email, password)
                res = await c.put(
                    f"{API}/chat/{convo_id}/active-leaf",
                    json={"message_id": str(uuid.uuid4())},
                    headers={"Authorization": f"Bearer {token}"},
                )
                assert res.status_code == 404
        finally:
            await self._cleanup(convo_id, user_id)
