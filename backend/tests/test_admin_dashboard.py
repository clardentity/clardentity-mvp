"""The admin view: who may open it, and what the dynamic query will run."""

import pytest
from fastapi import HTTPException

from app.api.admin_dashboard import _vet
from app.services.admin_access import admin_emails, is_admin


class _U:
    def __init__(self, email):
        self.email = email


class TestWhoIsAdmin:
    def test_membership_comes_from_configuration_only(self, monkeypatch):
        from app.core import config

        monkeypatch.setattr(config.settings, "admin_emails", "boss@example.com, Second@Example.com")
        assert admin_emails() == {"boss@example.com", "second@example.com"}
        # exact match only: stored emails are lower-cased, see tests/test_security_fixes.py
        assert is_admin(_U("boss@example.com")) is True
        assert is_admin(_U("BOSS@example.com")) is False
        assert is_admin(_U("someone@example.com")) is False

    def test_nobody_is_admin_when_unset(self, monkeypatch):
        from app.core import config

        monkeypatch.setattr(config.settings, "admin_emails", "")
        assert is_admin(_U("anyone@example.com")) is False


class TestQueryGate:
    """The model is told to write one read-only SELECT. This is what happens
    when it doesn't - which is the only part that makes the feature safe."""

    def test_plain_selects_pass(self):
        assert _vet("SELECT count(*) FROM users") == "SELECT count(*) FROM users"
        assert _vet("with x as (select 1) select * from x;").startswith("with x")

    @pytest.mark.parametrize(
        "sql",
        [
            "DELETE FROM users",
            "UPDATE users SET email = 'x'",
            "DROP TABLE users",
            "SELECT 1; DROP TABLE users",
            "INSERT INTO users (email) VALUES ('x')",
            "TRUNCATE messages",
        ],
    )
    def test_anything_that_writes_is_refused(self, sql):
        with pytest.raises(HTTPException) as exc:
            _vet(sql)
        assert exc.value.status_code == 400

    @pytest.mark.parametrize(
        "sql",
        [
            "SELECT content FROM messages",
            "SELECT password_hash FROM users",
            "SELECT transcript FROM audio_transcripts",
            "SELECT claim_text FROM message_claims",
        ],
    )
    def test_what_people_wrote_is_off_limits(self, sql):
        with pytest.raises(HTTPException):
            _vet(sql)

    def test_tables_outside_the_list_are_refused(self):
        with pytest.raises(HTTPException) as exc:
            _vet("SELECT * FROM alembic_version")
        assert "not available" in exc.value.detail

    def test_an_empty_query_is_refused(self):
        with pytest.raises(HTTPException):
            _vet("   ")


class TestSpendPerModel:
    """The breakdown that maps to money.

    "By mode" cannot answer "what is Opus costing us" - the same companion
    answered on the cheapest and the dearest model is one bar. The meter has
    always recorded the split; this is the fold that reads it back, and the
    rows it reads are JSON written by several versions of the code.
    """

    def test_it_adds_input_and_output_across_turns(self):
        from app.api.admin_dashboard import add_model_spend

        totals: dict[str, int] = {}
        add_model_spend(totals, {
            "by_model": {
                "claude-opus-5-5": {"input_tokens": 1000, "output_tokens": 200},
                "claude-haiku-4-5": {"input_tokens": 50, "output_tokens": 10},
            }
        })
        add_model_spend(totals, {
            "by_model": {"claude-opus-5-5": {"input_tokens": 500, "output_tokens": 100}}
        })
        assert totals == {"claude-opus-5-5": 1800, "claude-haiku-4-5": 60}

    def test_a_turn_with_no_split_contributes_nothing(self):
        from app.api.admin_dashboard import add_model_spend

        totals: dict[str, int] = {"claude-opus-5-5": 10}
        # Written before the meter kept a split, and the three shapes a
        # half-written row can take. None of them may invent a number, and
        # none may raise - this runs once per assistant message ever sent.
        for usage in (None, {}, {"input_tokens": 5}, {"by_model": None}, {"by_model": []}):
            add_model_spend(totals, usage)
        assert totals == {"claude-opus-5-5": 10}

    def test_it_survives_rubbish_in_the_column(self):
        from app.api.admin_dashboard import add_model_spend

        totals: dict[str, int] = {}
        add_model_spend(totals, {
            "by_model": {
                "good": {"input_tokens": 7, "output_tokens": 3},
                "nested-wrong": "not a dict",
                "none-values": {"input_tokens": None, "output_tokens": None},
                "not-a-number": {"input_tokens": "lots", "output_tokens": 1},
            }
        })
        # Only the readable one, and a model that spent nothing is left out
        # rather than drawn as an empty bar.
        assert totals == {"good": 10}


class TestGlobalSettingsAreAdminOnly:
    """The answer model, scoring weights and feature flags apply to everyone,
    so only an administrator may read or change them. Until 2026-10-17 any
    signed-in account could. Needs a database."""

    async def test_an_ordinary_account_is_refused_and_an_admin_is_not(self, monkeypatch):
        import uuid

        import httpx
        import pytest

        from app.core import config
        from app.main import app

        email = f"settings-{uuid.uuid4().hex[:8]}@example.com"
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
            reg = await c.post(
                "/api/v1/auth/register",
                json={"email": email, "password": "settings-password-123", "accepted_terms": True},
            )
            if reg.status_code >= 500:
                pytest.skip("no database available")
            headers = {"Authorization": f"Bearer {reg.json()['access_token']}"}
            try:
                monkeypatch.setattr(config.settings, "admin_emails", "someone-else@example.com")
                assert (await c.get("/api/v1/admin/settings", headers=headers)).status_code == 404, "hidden, like the dashboard"
                put = await c.put(
                    "/api/v1/admin/settings",
                    json={"key": "feature_flags", "value": {"web_search_enabled": False}},
                    headers=headers,
                )
                assert put.status_code == 404

                monkeypatch.setattr(config.settings, "admin_emails", email)
                assert (await c.get("/api/v1/admin/settings", headers=headers)).status_code == 200
            finally:
                await c.delete("/api/v1/auth/me", headers=headers)
