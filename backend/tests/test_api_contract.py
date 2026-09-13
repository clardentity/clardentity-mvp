"""API surface and auth.

These run in-process against the ASGI app. Everything that touches the
database is skipped automatically when one isn't reachable, so the suite is
still useful on a machine with nothing running.
"""

import uuid

import httpx
import pytest
from sqlalchemy import delete, select

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
            f"{API}/profile/onboarding",
            f"{API}/chat/{{conversation_id}}/call-transcript",
        ):
            assert path in paths, f"missing route: {path}"

    def test_me_exposes_the_onboarding_stamp_and_can_be_deleted(self):
        spec = app.openapi()
        assert "delete" in spec["paths"][f"{API}/auth/me"]
        user = spec["components"]["schemas"]["UserPublic"]["properties"]
        assert "onboarding_completed_at" in user, "the client gates /welcome on this field"

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


class TestOnboardingAndAccountDeletion:
    """Register -> not yet onboarded -> answer the welcome questions -> stamped,
    answers stored as evidence -> delete the account -> everything gone.
    Needs a database. Profile inference is queued out-of-band and is stubbed
    here; the contract under test is the stamp and the stored answers."""

    async def test_full_lifecycle(self, monkeypatch):
        from app.api import profile as profile_api
        from app.models import UserProfile

        queued: list[str] = []
        monkeypatch.setattr(
            profile_api.rebuild_profile_task, "delay", lambda user_id: queued.append(user_id)
        )

        email = f"onboard-{uuid.uuid4().hex[:8]}@example.com"
        password = "onboard-password-123"
        uid = None
        try:
            async with client() as c:
                reg = await c.post(
                    f"{API}/auth/register",
                    json={"email": email, "password": password, "display_name": "Onboard"},
                )
                if reg.status_code >= 500:
                    pytest.skip("no database available")
                assert reg.status_code == 201, reg.text
                token = reg.json()["access_token"]
                uid = uuid.UUID(reg.json()["user"]["id"])
                headers = {"Authorization": f"Bearer {token}"}

                # A brand-new account has not been onboarded - this is the
                # field the client routes /welcome on, and it must be an
                # explicit null, not absent.
                me = await c.get(f"{API}/auth/me", headers=headers)
                assert me.status_code == 200
                assert "onboarding_completed_at" in me.json()
                assert me.json()["onboarding_completed_at"] is None

                answers = [
                    {"question": "What brings you here?", "answer": "Deciding on a career move."},
                    {"question": "What are you working on?", "answer": ""},
                ]
                done = await c.post(
                    f"{API}/profile/onboarding", json={"answers": answers}, headers=headers
                )
                assert done.status_code == 202, done.text
                assert done.json()["status"] == "building"
                assert queued == [str(uid)], "a non-blank answer must queue an inference rebuild"

                me = await c.get(f"{API}/auth/me", headers=headers)
                assert me.json()["onboarding_completed_at"] is not None

            async with AsyncSessionLocal() as db:
                profile = await db.get(UserProfile, uid)
                assert profile is not None
                # Blank answers are kept for the record; only non-blank ones
                # reach inference, which gather_evidence filters.
                assert [a["question"] for a in profile.onboarding_answers] == [
                    a["question"] for a in answers
                ]
                from app.services.profile_service import gather_evidence

                evidence, _ = await gather_evidence(db, uid)
                assert "Deciding on a career move." in evidence
                assert "What are you working on?" not in evidence

            async with client() as c:
                gone = await c.delete(f"{API}/auth/me", headers=headers)
                assert gone.status_code == 204, gone.text
                # The token still parses but the account it names is gone.
                assert (await c.get(f"{API}/auth/me", headers=headers)).status_code == 401

            async with AsyncSessionLocal() as db:
                assert await db.get(User, uid) is None
                assert await db.get(UserProfile, uid) is None
                owned = await db.execute(select(Workspace).where(Workspace.owner_id == uid))
                assert owned.scalars().all() == []
            uid = None
        finally:
            if uid is not None:
                async with AsyncSessionLocal() as db:
                    await db.execute(delete(WorkspaceMember).where(WorkspaceMember.user_id == uid))
                    await db.execute(delete(Workspace).where(Workspace.owner_id == uid))
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


class TestRefinedQuestionGate:
    """The pre-answer "did you mean" stops the turn and writes nothing -
    same invariant as the context gate, same reason: a saved question with
    no answer under it is worse than not saving anything. Needs a database.
    """

    async def _fixture(self):
        from app.models import Conversation

        email = f"refgate-{uuid.uuid4().hex[:8]}@example.com"
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
            if "connect" not in str(exc).lower() and "database" not in str(exc).lower():
                raise
            pytest.skip("no database available")

        refined = "How do I get better at long-distance running specifically?"

        async def fake_guidance(question, mode):
            return {
                "context_question": None,
                "suggested_mode": None,
                "mode_reason": None,
                "refined_question": refined,
                "refinement_reason": "Names the sport a general 'it' left out.",
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
                    json={"content": "how do I get better at it", "mode": "knowing"},
                    headers={"Authorization": f"Bearer {token}"},
                )
                body = res.text

            assert "refined_question" in body
            assert refined in body

            async with AsyncSessionLocal() as db:
                rows = await db.execute(
                    delete(Message).where(Message.conversation_id == convo_id).returning(Message.id)
                )
                saved = list(rows.scalars().all())
                await db.commit()
            assert saved == [], f"gate persisted {len(saved)} message(s)"
        finally:
            from app.models import Conversation as _Conversation

            async with AsyncSessionLocal() as db:
                await db.execute(delete(Message).where(Message.conversation_id == convo_id))
                await db.execute(delete(_Conversation).where(_Conversation.id == convo_id))
                await db.execute(delete(WorkspaceMember).where(WorkspaceMember.user_id == user_id))
                await db.execute(delete(Workspace).where(Workspace.owner_id == user_id))
                await db.execute(delete(User).where(User.id == user_id))
                await db.commit()


class TestClarifyingOptionsGate:
    """The pre-answer "which did you mean" - clickable options, not a
    rewrite or a free-text box - stops the turn and writes nothing. Same
    invariant as every other pre-answer gate. Needs a database."""

    async def _fixture(self):
        from app.models import Conversation

        email = f"claringate-{uuid.uuid4().hex[:8]}@example.com"
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
            if "connect" not in str(exc).lower() and "database" not in str(exc).lower():
                raise
            pytest.skip("no database available")

        options = ["A sport", "A musical instrument", "A language", "A work skill"]

        async def fake_guidance(question, mode):
            return {
                "context_question": None,
                "suggested_mode": None,
                "mode_reason": None,
                "refined_question": None,
                "refinement_reason": None,
                "clarifying_question": "What are you trying to get better at?",
                "clarifying_options": options,
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
                    json={"content": "how do I get better at it", "mode": "knowing"},
                    headers={"Authorization": f"Bearer {token}"},
                )
                body = res.text

            assert "clarifying_options" in body
            for option in options:
                assert option in body

            async with AsyncSessionLocal() as db:
                rows = await db.execute(
                    delete(Message).where(Message.conversation_id == convo_id).returning(Message.id)
                )
                saved = list(rows.scalars().all())
                await db.commit()
            assert saved == [], f"gate persisted {len(saved)} message(s)"
        finally:
            from app.models import Conversation as _Conversation

            async with AsyncSessionLocal() as db:
                await db.execute(delete(Message).where(Message.conversation_id == convo_id))
                await db.execute(delete(_Conversation).where(_Conversation.id == convo_id))
                await db.execute(delete(WorkspaceMember).where(WorkspaceMember.user_id == user_id))
                await db.execute(delete(Workspace).where(Workspace.owner_id == user_id))
                await db.execute(delete(User).where(User.id == user_id))
                await db.commit()


class TestUserMessageSnapshot:
    """The "answer" SSE event carries a snapshot of the just-persisted user
    row alongside the assistant's - the client's optimistic copy of that
    same question was displayed under a local placeholder id, before the
    server ever assigned one, and needs the real id back to address the row
    again later (e.g. to delete it).

    That snapshot is taken right after `flush()`, before the surrounding
    `commit()` would expire the row's attributes. This checks the snapshot
    is actually complete - in particular `created_at`, a server-side
    default - rather than raising or silently serializing a null timestamp
    into the event. Needs a database.
    """

    async def _fixture(self):
        from app.models import Conversation

        email = f"usersnap-{uuid.uuid4().hex[:8]}@example.com"
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
            return user.id, convo.id

    async def test_flush_alone_is_enough_to_serialize_a_fresh_message(self):
        from app.api.chat import _serialize_message

        try:
            user_id, convo_id = await self._fixture()
        except Exception as exc:  # noqa: BLE001
            if "connect" not in str(exc).lower() and "database" not in str(exc).lower():
                raise
            pytest.skip("no database available")

        try:
            async with AsyncSessionLocal() as db:
                message = Message(
                    conversation_id=convo_id,
                    role="user",
                    content="how do I get better at it",
                    mode_used="knowing",
                )
                db.add(message)
                # Mirrors exactly what `send_message` does before its own
                # commit: flush() alone, while the row is still attached and
                # unexpired - unlike everything after the commit that
                # follows this in the real endpoint.
                await db.flush()
                payload = _serialize_message(message, []).model_dump(mode="json")

                assert payload["id"] == str(message.id)
                assert payload["created_at"], "created_at was not populated before commit"
        finally:
            from app.models import Conversation as _Conversation

            async with AsyncSessionLocal() as db:
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


class TestMessageDeletion:
    """DELETE .../messages/{id}: a real, cascading delete - the one
    destructive operation on a message, distinct from fork/edit/regenerate
    which never delete anything. Needs a database."""

    async def _fixture(self):
        from app.models import Conversation

        email = f"delmsg-{uuid.uuid4().hex[:8]}@example.com"
        password = "del-password-123"
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

            # Two sibling answers to the same question.
            answer_a = Message(
                conversation_id=convo.id, role="assistant", content="answer a",
                mode_used="knowing", parent_id=question.id,
            )
            db.add(answer_a)
            answer_b = Message(
                conversation_id=convo.id, role="assistant", content="answer b",
                mode_used="knowing", parent_id=question.id,
            )
            db.add(answer_b)
            await db.flush()

            # A continuation built on top of answer_b only.
            followup_q = Message(
                conversation_id=convo.id, role="user", content="follow-up",
                mode_used="knowing", parent_id=answer_b.id,
            )
            db.add(followup_q)
            await db.flush()
            followup_a = Message(
                conversation_id=convo.id, role="assistant", content="follow-up answer",
                mode_used="knowing", parent_id=followup_q.id,
            )
            db.add(followup_a)
            await db.flush()

            convo.active_leaf_id = followup_a.id
            await db.commit()
            return (
                email, password, user.id, convo.id,
                question.id, answer_a.id, answer_b.id, followup_q.id, followup_a.id,
            )

    async def _login(self, c, email, password):
        login = await c.post(f"{API}/auth/login", json={"email": email, "password": password})
        if login.status_code != 200:
            pytest.skip("login unavailable")
        return login.json()["access_token"]

    async def _cleanup(self, convo_id, user_id):
        from app.models import Conversation as _Conversation

        async with AsyncSessionLocal() as db:
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

    async def test_deleting_a_sibling_outside_the_active_path_leaves_the_leaf_alone(self):
        try:
            (email, password, user_id, convo_id, q_id, a_id, b_id,
             fq_id, fa_id) = await self._fixture()
        except Exception as exc:  # noqa: BLE001
            if "connect" not in str(exc).lower() and "database" not in str(exc).lower():
                raise
            pytest.skip("no database available")

        try:
            async with client() as c:
                token = await self._login(c, email, password)
                headers = {"Authorization": f"Bearer {token}"}

                res = await c.delete(f"{API}/chat/{convo_id}/messages/{a_id}", headers=headers)
                assert res.status_code == 204

                async with AsyncSessionLocal() as db:
                    remaining = await db.execute(
                        select(Message.id).where(Message.conversation_id == convo_id)
                    )
                    remaining_ids = {r[0] for r in remaining.all()}
                assert a_id not in remaining_ids
                assert {q_id, b_id, fq_id, fa_id} <= remaining_ids

                shown = await c.get(f"{API}/chat/{convo_id}/messages", headers=headers)
                assert [m["content"] for m in shown.json()] == ["q", "answer b", "follow-up", "follow-up answer"]
        finally:
            await self._cleanup(convo_id, user_id)

    async def test_deleting_a_message_in_the_active_path_cascades_and_repoints_the_leaf(self):
        try:
            (email, password, user_id, convo_id, q_id, a_id, b_id,
             fq_id, fa_id) = await self._fixture()
        except Exception as exc:  # noqa: BLE001
            if "connect" not in str(exc).lower() and "database" not in str(exc).lower():
                raise
            pytest.skip("no database available")

        try:
            async with client() as c:
                token = await self._login(c, email, password)
                headers = {"Authorization": f"Bearer {token}"}

                # answer_b is an ancestor of the active leaf - deleting it
                # must take its whole subtree (follow-up + follow-up answer)
                # with it, and land the leaf back on the surviving sibling.
                res = await c.delete(f"{API}/chat/{convo_id}/messages/{b_id}", headers=headers)
                assert res.status_code == 204

                async with AsyncSessionLocal() as db:
                    remaining = await db.execute(
                        select(Message.id).where(Message.conversation_id == convo_id)
                    )
                    remaining_ids = {r[0] for r in remaining.all()}
                assert remaining_ids == {q_id, a_id}

                shown = await c.get(f"{API}/chat/{convo_id}/messages", headers=headers)
                assert [m["content"] for m in shown.json()] == ["q", "answer a"]
        finally:
            await self._cleanup(convo_id, user_id)

    async def test_deleting_an_unknown_message_404s(self):
        try:
            email, password, user_id, convo_id, *_ = await self._fixture()
        except Exception as exc:  # noqa: BLE001
            if "connect" not in str(exc).lower() and "database" not in str(exc).lower():
                raise
            pytest.skip("no database available")

        try:
            async with client() as c:
                token = await self._login(c, email, password)
                res = await c.delete(
                    f"{API}/chat/{convo_id}/messages/{uuid.uuid4()}",
                    headers={"Authorization": f"Bearer {token}"},
                )
                assert res.status_code == 404
        finally:
            await self._cleanup(convo_id, user_id)


class TestRefreshAcrossDevices:
    """Two devices hold two refresh tokens for one account. Refreshing on one
    must not sign the other out - which is exactly what per-refresh version
    rotation did, since the version lives on the user, not the device. A
    password reset still revokes everything (covered by the version bump
    there). Needs a database."""

    async def test_refreshing_on_one_device_keeps_the_other_signed_in(self):
        email = f"devices-{uuid.uuid4().hex[:8]}@example.com"
        password = "two-devices-password-1"
        token = None
        try:
            async with client() as c:
                reg = await c.post(
                    f"{API}/auth/register",
                    json={"email": email, "password": password, "display_name": "Two"},
                )
                if reg.status_code >= 500:
                    pytest.skip("no database available")
                assert reg.status_code == 201, reg.text
                laptop = reg.json()["refresh_token"]
                token = reg.json()["access_token"]

                phone_login = await c.post(
                    f"{API}/auth/login", json={"email": email, "password": password}
                )
                assert phone_login.status_code == 200, phone_login.text
                phone = phone_login.json()["refresh_token"]

                # The phone refreshes (its access token expired)...
                r1 = await c.post(f"{API}/auth/refresh", json={"refresh_token": phone})
                assert r1.status_code == 200, r1.text
                token = r1.json()["access_token"]

                # ...and the laptop, opened later, must still be able to.
                r2 = await c.post(f"{API}/auth/refresh", json={"refresh_token": laptop})
                assert r2.status_code == 200, r2.text

                # Same token twice - a reload racing another tab - is fine too.
                r3 = await c.post(f"{API}/auth/refresh", json={"refresh_token": laptop})
                assert r3.status_code == 200, r3.text

                # Garbage is still refused.
                bad = await c.post(f"{API}/auth/refresh", json={"refresh_token": laptop + "x"})
                assert bad.status_code == 401
        finally:
            if token:
                async with client() as c:
                    await c.delete(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"})
