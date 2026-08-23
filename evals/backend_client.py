"""A thin client that talks to Clardentity exactly the way the real frontend
does: register/login over HTTP, open a workspace, POST a message, and parse
the SSE stream back into events. No internal imports from `app.*` - the point
of the eval is to catch what a user would actually receive, including
anything that breaks between the model call and the wire.

One eval account is created once and reused across runs (credentials cached
in `.eval_creds.json`, gitignored) so repeated runs don't accumulate throwaway
users on production. Each case gets its own conversation so history from one
case never leaks into another; the one deliberate exception is the two-turn
clarifier-continuity case, which reuses a conversation on purpose.
"""

from __future__ import annotations

import json
import os
import secrets
import string
import time
from dataclasses import dataclass, field
from pathlib import Path

import httpx

_CREDS_PATH = Path(__file__).parent / ".eval_creds.json"
_WORKSPACE_NAME = "Evals"


class BackendTurnError(RuntimeError):
    """The HTTP request succeeded (200, SSE headers sent) but the turn itself
    failed server-side mid-stream - a circuit breaker open, a crashed
    generation, anything the server reports via an `error` event rather than
    an HTTP status. `res.raise_for_status()` cannot see this: the status line
    was already 200 before the failure happened. Discovered the hard way -
    the first real eval run "passed" every case as an empty response with no
    indication anything had gone wrong, because nothing checked for this."""


@dataclass
class SSEResult:
    """Every event the server sent, in order, plus the raw text for anything
    an evaluator needs that isn't parsed into a named field."""

    events: list[tuple[str, dict]] = field(default_factory=list)
    raw: str = ""

    def first(self, event_type: str) -> dict | None:
        for et, data in self.events:
            if et == event_type:
                return data
        return None

    def has(self, event_type: str) -> bool:
        return self.first(event_type) is not None

    @property
    def final_message(self) -> dict | None:
        final = self.first("final")
        return (final or {}).get("message")

    @property
    def answer_text(self) -> str:
        msg = self.final_message or (self.first("answer") or {}).get("message") or {}
        return msg.get("content") or ""


def _parse_sse(text: str) -> SSEResult:
    events: list[tuple[str, dict]] = []
    event_type = "message"
    for raw_line in text.split("\n"):
        line = raw_line.rstrip("\r")
        if line.startswith("event:"):
            event_type = line[len("event:") :].strip()
        elif line.startswith("data:"):
            payload = line[len("data:") :].strip()
            if not payload:
                continue
            try:
                events.append((event_type, json.loads(payload)))
            except json.JSONDecodeError:
                events.append((event_type, {"_raw": payload}))
        elif line == "":
            event_type = "message"
    return SSEResult(events=events, raw=text)


def _random_password() -> str:
    alphabet = string.ascii_letters + string.digits
    return "Ev4l-" + "".join(secrets.choice(alphabet) for _ in range(20))


class BackendClient:
    def __init__(self, base_url: str, timeout: float = 240.0):
        self.base_url = base_url.rstrip("/")
        self._http = httpx.Client(timeout=timeout)
        self._token: str | None = None
        self._workspace_id: str | None = None

    def _request(self, method: str, url: str, **kw) -> httpx.Response:
        """Up to three attempts on a 5xx, with backoff. Measured directly
        against production: `/health` alternates ok/error roughly every other
        poll a few seconds apart (Redis flapping - database and storage stay
        green throughout), and it is real: `/auth/register` 500s on the same
        cadence with no response body, which is FastAPI's default handler
        hiding a genuine unhandled exception, most likely the rate limiter's
        Redis call. Without a retry here, whether a case "passes" would depend
        on which half-second it happened to run in - a false signal a prompt
        change didn't cause and can't fix. This does not fix the flapping
        itself; it only stops it from being mistaken for a policy failure."""
        last: httpx.Response | None = None
        for attempt in range(6):
            last = self._http.request(method, url, **kw)
            if last.status_code < 500:
                return last
            time.sleep(2 * (attempt + 1))
        return last

    # -- setup -----------------------------------------------------------

    def ensure_account(self) -> None:
        """Reuse a cached eval account, or create one. Never touches a real
        user's account - this is a dedicated login that exists only to run
        evals against."""
        creds = self._load_creds()
        if creds:
            email, password = creds["email"], creds["password"]
            if self._try_login(email, password):
                return
            # Cached password stopped working (account gone, rotated,
            # whatever) - fall through and mint a fresh one.

        email = f"evals+{secrets.token_hex(6)}@clardentity.internal"
        password = _random_password()
        res = self._request(
            "POST",
            f"{self.base_url}/auth/register",
            json={"email": email, "password": password, "display_name": "Eval Harness"},
        )
        res.raise_for_status()
        body = res.json()
        self._token = body["access_token"]
        self._save_creds(email, password)

    def _try_login(self, email: str, password: str) -> bool:
        res = self._request(
            "POST", f"{self.base_url}/auth/login", json={"email": email, "password": password}
        )
        if res.status_code != 200:
            return False
        self._token = res.json()["access_token"]
        return True

    def _load_creds(self) -> dict | None:
        if not _CREDS_PATH.exists():
            return None
        try:
            return json.loads(_CREDS_PATH.read_text())
        except (json.JSONDecodeError, OSError):
            return None

    def _save_creds(self, email: str, password: str) -> None:
        _CREDS_PATH.write_text(json.dumps({"email": email, "password": password}))
        os.chmod(_CREDS_PATH, 0o600)

    @property
    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self._token}"}

    def ensure_workspace(self) -> str:
        """One workspace named "Evals", reused across runs rather than
        created fresh each time - so a look at the account shows one tidy
        workspace, not a hundred abandoned ones."""
        if self._workspace_id:
            return self._workspace_id
        res = self._request("GET", f"{self.base_url}/workspaces", headers=self._headers)
        res.raise_for_status()
        for ws in res.json():
            if ws["name"] == _WORKSPACE_NAME:
                self._workspace_id = ws["id"]
                return self._workspace_id
        res = self._request(
            "POST", f"{self.base_url}/workspaces", headers=self._headers, json={"name": _WORKSPACE_NAME}
        )
        res.raise_for_status()
        self._workspace_id = res.json()["id"]
        return self._workspace_id

    def set_companion_name(self, mode: str, name: str) -> None:
        """Only ever sets one mode's name, on an account that exists solely to
        run evals - never touches a real user's chosen names."""
        res = self._request(
            "PUT",
            f"{self.base_url}/profile",
            headers=self._headers,
            json={"companion_names": {mode: name}},
        )
        res.raise_for_status()

    # -- conversations -----------------------------------------------------

    def new_conversation(self, title: str) -> str:
        res = self._request(
            "POST",
            f"{self.base_url}/chat/conversations",
            headers=self._headers,
            json={"workspace_id": self.ensure_workspace(), "title": title[:80]},
        )
        res.raise_for_status()
        return res.json()["id"]

    def send_message(
        self,
        conversation_id: str,
        content: str,
        mode: str,
        *,
        mode_confirmed: bool = True,
        context_acknowledged: bool = True,
        reasoning_lens: str | None = None,
    ) -> SSEResult:
        """One real turn, waiting for the whole SSE stream. `mode_confirmed`
        and `context_acknowledged` default to True - skip past the gates - so
        a case has to opt in to testing a gate rather than every other case
        having to remember to silence it."""
        body: dict = {
            "content": content,
            "mode": mode,
            "mode_confirmed": mode_confirmed,
            "context_acknowledged": context_acknowledged,
        }
        if reasoning_lens:
            body["reasoning_lens"] = reasoning_lens
        last_detail = None
        for attempt in range(3):
            started = time.monotonic()
            res = self._request(
                "POST",
                f"{self.base_url}/chat/{conversation_id}/messages",
                headers=self._headers,
                json=body,
            )
            elapsed = time.monotonic() - started
            res.raise_for_status()
            result = _parse_sse(res.text)
            err = result.first("error")
            if err is None:
                result.events.append(("_meta", {"elapsed_seconds": round(elapsed, 1)}))
                return result
            last_detail = err.get("detail", "unknown error")
            # The model circuit breaker (anthropic_client.py) opens after 5
            # consecutive failures and stays open for its cooldown - a burst
            # of concurrent eval cases can trip it and then every case behind
            # it in the queue gets the same short-circuited error, regardless
            # of what it was actually testing. Worth one retry past the
            # cooldown before treating this as a genuine per-case failure.
            if "circuit breaker" in last_detail.lower() and attempt < 2:
                time.sleep(35)
                continue
            break
        raise BackendTurnError(last_detail)

    def delete_conversation(self, conversation_id: str) -> None:
        self._request(
            "DELETE", f"{self.base_url}/chat/conversations/{conversation_id}", headers=self._headers
        )

    def close(self) -> None:
        self._http.close()
