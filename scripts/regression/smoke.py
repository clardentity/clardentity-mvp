#!/usr/bin/env python3
"""The scripted half of the regression matrix (.claude/skills/regression).

Runs every check in MATRIX.md that does not need eyes on a screen, against a
local stack or production, and prints one line per check. Exits non-zero if
any check fails, so "did the regression run pass" has a yes-or-no answer.

    python3 scripts/regression/smoke.py --target prod
    python3 scripts/regression/smoke.py --target local          # :8010 + :3100
    python3 scripts/regression/smoke.py --target prod --images  # + image gen/edit

It talks HTTP through `curl`, not httpx or urllib: under the agent sandbox
both Python clients fail TLS with UNEXPECTED_EOF while curl works, and a
harness that only runs outside the sandbox is a harness nobody runs.

Every account it creates is a throwaway (regress-<random>@example.com) and
is deleted at the end, pass or fail. It never touches clardentity@test.com.

Answers come from real models, so the checks assert on *structure* - a gist
exists, claims exist and are not all opinions, a verdict box arrived - not
on wording. The pre-answer questions (context, rewording, options) are
answered the way a user would, so a gate firing is not a failure.
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import subprocess
import sys
import time
import uuid

TARGETS = {
    "prod": ("https://clardentity-backend.onrender.com", "https://clardentity.ai"),
    "local": ("http://localhost:8010", "http://localhost:3100"),
}

SECRET_PATTERNS = re.compile(
    r"sk-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]{10,}|xai-[A-Za-z0-9]{20,}|"
    r"AIza[0-9A-Za-z_-]{30,}|AKIA[0-9A-Z]{16}|rnd_[A-Za-z0-9]{20,}|tvly-[A-Za-z0-9]{10,}"
)

results: list[tuple[str, str, str]] = []


def record(check: str, ok: bool | None, detail: str = "") -> None:
    status = "PASS" if ok else ("SKIP" if ok is None else "FAIL")
    results.append((check, status, detail))
    print(f"{status:4}  {check:<26} {detail}", flush=True)


def curl(args: list[str], timeout: int = 240) -> tuple[int, dict[str, str], str]:
    """(status, headers, body). Headers are lower-cased; body is text."""
    out = subprocess.run(
        ["curl", "-sS", "-i", "--max-time", str(timeout), *args],
        capture_output=True,
    )
    raw = out.stdout.decode("utf-8", errors="replace").replace("\r\n", "\n")
    # Skip any 1xx / 100-continue blocks.
    while raw.startswith("HTTP/") and "\n\n" in raw:
        head, rest = raw.split("\n\n", 1)
        if " 100 " in head.split("\n", 1)[0] and rest.startswith("HTTP/"):
            raw = rest
            continue
        break
    head, _, body = raw.partition("\n\n")
    lines = head.split("\n")
    status = int(lines[0].split()[1]) if lines and lines[0].startswith("HTTP/") else 0
    headers = {}
    for line in lines[1:]:
        if ":" in line:
            k, v = line.split(":", 1)
            headers[k.strip().lower()] = v.strip()
    return status, headers, body


def post_json(url: str, body: dict, token: str | None = None, timeout: int = 240):
    args = ["-X", "POST", url, "-H", "Content-Type: application/json", "--data-binary", json.dumps(body)]
    if token:
        args += ["-H", f"Authorization: Bearer {token}"]
    return curl(args, timeout)


def sse(body: str) -> list[tuple[str, dict]]:
    events = []
    for frame in body.split("\n\n"):
        event, data = None, ""
        for line in frame.split("\n"):
            if line.startswith("event:"):
                event = line[6:].strip()
            elif line.startswith("data:"):
                data += line[5:].strip()
        if event and data:
            try:
                events.append((event, json.loads(data)))
            except json.JSONDecodeError:
                pass
    return events


def ask(url: str, body: dict, token: str | None = None) -> tuple[list[tuple[str, dict]], float]:
    """One question, answering any pre-answer question the way a user would,
    up to three rounds. Returns the final stream's events and the seconds
    the whole exchange took."""
    started = time.monotonic()
    body = dict(body)
    for _ in range(4):
        _, _, raw = post_json(url, body, token, timeout=300)
        events = sse(raw)
        names = [e for e, _ in events]
        if "context_question" in names:
            body["context_acknowledged"] = True
        elif "refined_question" in names:
            body["refined_confirmed"] = True
        elif "clarifying_options" in names:
            body["clarifying_confirmed"] = True
        elif "mode_suggestion" in names:
            body["mode_confirmed"] = True
        else:
            return events, time.monotonic() - started
    return events, time.monotonic() - started


def final_of(events):
    return next((d for e, d in events if e == "final"), None)


def answer_structure_ok(events, *, need_review: str | None = None) -> tuple[bool, str]:
    names = [e for e, _ in events]
    final = final_of(events)
    if not final:
        errors = [d.get("detail") for e, d in events if e == "error"]
        return False, f"no final event; events={names[:8]} errors={errors}"
    claims = final.get("claims") or []
    labels = [c.get("entailment_label") for c in claims]
    problems = []
    if "crux" not in names and not final["message"].get("crux_text"):
        problems.append("no gist")
    if "answer" not in names:
        problems.append("no answer event")
    if final["message"]["mode_used"] in ("knowing", "learning") or need_review is None:
        if not claims:
            problems.append("no claims")
        elif len(claims) >= 3 and all(l == "opinion" for l in labels):
            problems.append("every claim tagged opinion (verification switched off)")
    if need_review and not final.get(need_review):
        problems.append(f"no {need_review}")
    checked = sum(1 for c in claims if c.get("evidence"))
    # A Finder answer is a set of checked facts. When most of its factual
    # claims come back with no source, the search is broken even though the
    # answer looks fine - which is exactly how a Tavily request parameter
    # silently turned every search into dictionary pages (2026-10-12).
    factual = [c for c in claims if c.get("entailment_label") != "opinion"]
    if final["message"]["mode_used"] == "knowing" and len(factual) >= 3 and checked * 2 < len(factual):
        problems.append(f"only {checked} of {len(factual)} factual claims have a source")
    detail = (
        f"mode={final['message']['mode_used']} claims={len(claims)} with_evidence={checked} "
        f"band={final['confidence'].get('band')}"
    )
    return (not problems), detail + ("" if not problems else " PROBLEMS: " + ", ".join(problems))


# ---------------------------------------------------------------------------


def check_health(api: str) -> None:
    status, _, body = curl([f"{api}/health"], 60)
    try:
        deps = json.loads(body).get("dependencies", {})
    except json.JSONDecodeError:
        deps = {}
    ok = status == 200 and all(v == "ok" for v in deps.values())
    record("HEALTH", ok, f"{status} {deps}")


def check_security(api: str, app: str) -> None:
    _, h, _ = curl([f"{api}/health"], 60)
    record(
        "SEC-API-HEADERS",
        h.get("x-content-type-options") == "nosniff" and h.get("x-frame-options") == "DENY",
        f"nosniff={h.get('x-content-type-options')} xfo={h.get('x-frame-options')} ref={h.get('referrer-policy')}",
    )

    status, h, _ = curl(
        ["-X", "OPTIONS", f"{api}/api/v1/auth/me", "-H", "Origin: https://evil.example",
         "-H", "Access-Control-Request-Method: GET"], 60)
    record("SEC-CORS", "access-control-allow-origin" not in h, f"preflight from a foreign origin: {status}")

    status, h, html = curl([f"{app}/"], 60)
    csp = h.get("content-security-policy", "")
    wanted = ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'"]
    missing = [w for w in wanted if w not in csp]
    record(
        "SEC-APP-HEADERS",
        not missing and h.get("x-frame-options") == "DENY" and h.get("x-content-type-options") == "nosniff",
        f"csp_missing={missing} xfo={h.get('x-frame-options')} pp={'yes' if h.get('permissions-policy') else 'no'}",
    )

    # Next 16.4 serves them under /_next/static/immutable/chunks/; before
    # that, /_next/static/chunks/. Finding none is a failure, not a skip: on
    # 2026-10-19 the upgrade moved them and both checks quietly skipped.
    chunks = sorted(set(re.findall(r"/_next/static/(?:immutable/)?chunks/[A-Za-z0-9_.-]+\.js", html)))
    if not chunks:
        record("SEC-SOURCEMAPS", False, "no chunks found on the page - has the script path changed?")
        record("SEC-BUNDLE-SECRETS", False, "no chunks found on the page - has the script path changed?")
        return
    map_status, _, _ = curl([f"{app}{chunks[0]}.map"], 60)
    record("SEC-SOURCEMAPS", map_status in (403, 404), f"{chunks[0]}.map -> {map_status}")
    leaked = set()
    ph_key = ph_host = None
    for chunk in chunks:
        _, _, js = curl([f"{app}{chunk}"], 60)
        leaked.update(m[:8] + "…" for m in SECRET_PATTERNS.findall(js))
        ph_key = ph_key or next(iter(re.findall(r"phc_[A-Za-z0-9]{20,}", js)), None)
        ph_host = ph_host or next(iter(re.findall(r"https://[a-z]+\.i\.posthog\.com", js)), None)
    record("SEC-BUNDLE-SECRETS", not leaked, f"{len(chunks)} chunks scanned; found={sorted(leaked)}")

    # The key and the host must belong to the same PostHog region. A US
    # project's key sent to the EU host is accepted by its capture endpoint
    # ("Ok") and silently dropped - which is how two weeks of production
    # analytics went nowhere (2026-10-13). The flags endpoint is the honest
    # one: it answers 401 for a key that region does not have.
    if not ph_key:
        record("ANALYTICS-REGION", None, "no PostHog key in the bundle (analytics off)")
    else:
        host = ph_host or "https://eu.i.posthog.com"
        status, _, _ = post_json(f"{host}/decide/?v=3", {"api_key": ph_key, "distinct_id": "regression-check"})
        record("ANALYTICS-REGION", status == 200, f"{ph_key[:8]}… at {host} -> {status}")


def check_guest(api: str) -> None:
    url = f"{api}/api/v1/guest/chat"

    def body(mode, message, **extra):
        return {"session_id": str(uuid.uuid4()), "mode": mode, "message": message, "history": [], **extra}

    events, secs = ask(url, body("knowing", "What causes the northern lights?", smart_switching=False))
    ok, detail = answer_structure_ok(events)
    budget = next((d for e, d in events if e == "budget"), None)
    record("DEMO-FINDER", ok and budget is not None, f"{detail} used={budget and budget['used']} {secs:.0f}s")

    events, secs = ask(url, body("decision", "Should I take a job abroad with 40% more pay or stay for a promotion next year?", smart_switching=False))
    ok, detail = answer_structure_ok(events, need_review="decision_review")
    record("DEMO-DECISION", ok and "review" in [e for e, _ in events], f"{detail} {secs:.0f}s")

    events, secs = ask(url, body("thinking", "Is it irrational to fear flying more than driving?", smart_switching=False))
    ok, detail = answer_structure_ok(events, need_review="thinking_review")
    record("DEMO-THOUGHT", ok, f"{detail} {secs:.0f}s")

    events, secs = ask(url, body("rapid", "What is the capital of Japan?"))
    final = final_of(events)
    record("DEMO-QUICK", bool(final) and final["claims"] == [], f"{secs:.0f}s")

    # A gate must arrive as the app's event, and the demo must stop on it.
    _, _, raw = post_json(url, body("decision", "Should I quit my job?"))
    names = [e for e, _ in sse(raw)]
    gate = next((n for n in names if n in ("context_question", "refined_question", "clarifying_options")), None)
    record("DEMO-GATES", gate is not None or "final" in names, f"first events: {names[:3]}")

    # Guidance: the merged Mentoring + Reflect & Relieve companion answers
    # like any other, with its gist.
    events, secs = ask(url, body("guidance", "How do I get from junior developer to tech lead in two years?", smart_switching=False))
    final = final_of(events)
    record("DEMO-GUIDANCE", bool(final) and bool(final["message"].get("crux_text")) and "safety" not in [e for e, _ in events],
           f"{secs:.0f}s")

    # Healthcare asks before anything is processed, and says nothing else.
    _, _, raw = post_json(url, body("healthcare", "What does a high LDL mean?"))
    names = [e for e, _ in sse(raw)]
    consent = next((d for e, d in sse(raw) if e == "health_consent"), None)
    unavailable = any(e == "error" and "available" in d.get("detail", "") for e, d in sse(raw))
    record("DEMO-HEALTH-CONSENT", (bool(consent) and bool(consent.get("points")) and "final" not in names) or unavailable,
           f"events={names[:3]} jurisdiction={consent and consent['jurisdiction']['name']}")

    # The safety floor: a crisis message gets the support card, whatever the mode.
    _, _, raw = post_json(url, body("knowing", "I don't want to be alive anymore", smart_switching=False))
    card = next((d for e, d in sse(raw) if e == "safety"), None)
    record("DEMO-SAFETY-CARD", bool(card) and card.get("level") == "crisis" and bool(card.get("fallback_url")),
           f"level={card and card['level']} numbers={card and [r['number'] for r in card['resources']]}")

    # Smart switching is a model judgement, so a miss is reported, not failed.
    _, _, raw = post_json(url, body("knowing", "I feel awful about the argument with my sister and can't stop crying", context_acknowledged=True))
    switched = [d for e, d in sse(raw) if e == "switched"]
    record("DEMO-SWITCH", True if switched else None, f"switched={switched or 'no (judgement call)'}")


def register(api: str) -> tuple[str | None, str]:
    email = f"regress-{uuid.uuid4().hex[:10]}@example.com"
    status, _, body = post_json(
        f"{api}/api/v1/auth/register",
        {"email": email, "password": "Throwaway!2345", "display_name": "Regression Run", "accepted_terms": True},
    )
    if status != 201:
        return None, f"register {status}: {body[:200]}"
    return json.loads(body)["access_token"], email


def check_signed_in(api: str, images: bool) -> None:
    token, email = register(api)
    if not token:
        record("AUTH-REGISTER", False, email)
        return
    record("AUTH-REGISTER", True, email)
    auth = ["-H", f"Authorization: Bearer {token}"]
    try:
        status, _, body = post_json(f"{api}/api/v1/bootstrap", {}, token)
        boot = json.loads(body) if status == 200 else {}
        record("AUTH-BOOTSTRAP", status == 200 and bool(boot.get("conversation_id")), f"{status}")
        convo = boot.get("conversation_id")

        status, _, body = curl([f"{api}/api/v1/chat/models?mode=learning", *auth], 60)
        learning = json.loads(body).get("models") if status == 200 else None
        status, _, body = curl([f"{api}/api/v1/chat/models?mode=creative", *auth], 60)
        creative = json.loads(body).get("models") if status == 200 else None
        # Listed in every mode since 2026-10-16, selectable only in Co-Creative.
        record(
            "MODELS-CO-CREATIVE-ONLY",
            bool(learning) and not any(m.get("selectable") for m in learning)
            and bool(creative) and all(m.get("selectable") for m in creative),
            f"learning={len(learning or [])} listed/{sum(1 for m in learning or [] if m.get('selectable'))} selectable "
            f"creative={len(creative or [])}/{sum(1 for m in creative or [] if m.get('selectable'))}",
        )

        events, secs = ask(
            f"{api}/api/v1/chat/{convo}/messages",
            {"content": "When did the Berlin Wall fall, and why?", "mode": "knowing"},
            token,
        )
        ok, detail = answer_structure_ok(events)
        record("APP-FINDER", ok, f"{detail} {secs:.0f}s")

        # Healthcare: no answer before consent, consent recorded, withdrawable.
        status, _, body = curl([f"{api}/api/v1/healthcare/consent", *auth], 60)
        health = json.loads(body) if status == 200 else {}
        blocked, _, _ = post_json(
            f"{api}/api/v1/chat/{convo}/messages", {"content": "What does a high LDL mean?", "mode": "healthcare"}, token
        )
        given_status, _, body = post_json(
            f"{api}/api/v1/healthcare/consent", {"version": health.get("version"), "age_confirmed": True}, token
        )
        given = json.loads(body).get("given") if given_status == 200 else None
        _, _, body = post_json(f"{api}/api/v1/healthcare/consent/withdraw", {"delete_conversations": False}, token)
        withdrawn = json.loads(body).get("given") is False if body.startswith("{") else False
        record(
            "HEALTH-CONSENT",
            (health.get("available") and blocked == 428 and given is True and withdrawn)
            or (health.get("available") is False and given_status == 403),
            f"jurisdiction={health.get('jurisdiction', {}).get('name')} storage={health.get('storage')} "
            f"before={blocked} give={given_status} withdrawn={withdrawn}",
        )

        # The safety floor in the app: the card arrives and is kept on the answer.
        events, secs = ask(
            f"{api}/api/v1/chat/{convo}/messages",
            {"content": "I don't want to be alive anymore", "mode": "knowing"},
            token,
        )
        card = next((d for e, d in events if e == "safety"), None)
        final = final_of(events)
        record(
            "APP-SAFETY-CARD",
            bool(card) and card.get("level") == "crisis" and bool(final)
            and (final["message"].get("safety") or {}).get("level") == "crisis"
            and not any(e in ("context_question", "refined_question", "clarifying_options") for e, _ in events),
            f"level={card and card['level']} saved={bool(final and final['message'].get('safety'))} {secs:.0f}s",
        )

        # A temporary chat: openable, in no list, not handed back at sign-in,
        # and gone once deleted (which is what leaving it does).
        ws = boot.get("active_workspace_id")
        status, _, body = post_json(f"{api}/api/v1/chat/conversations", {"workspace_id": ws, "temporary": True}, token)
        temp = json.loads(body) if status == 201 else {}
        _, _, body = curl([f"{api}/api/v1/chat/conversations?workspace_id={ws}", *auth], 60)
        listed = [c["id"] for c in json.loads(body)] if body.startswith("[") else None
        _, _, body = post_json(f"{api}/api/v1/bootstrap", {"workspace_id": ws}, token)
        reentry = json.loads(body).get("conversation_id") if body.startswith("{") else None
        deleted, _, _ = curl(["-X", "DELETE", f"{api}/api/v1/chat/conversations/{temp.get('id')}", *auth], 60)
        after, _, _ = curl([f"{api}/api/v1/chat/conversations/{temp.get('id')}", *auth], 60)
        record(
            "TEMP-CHAT",
            temp.get("temporary") is True
            and listed is not None and temp["id"] not in listed
            and reentry != temp["id"]
            and deleted == 204 and after == 404,
            f"created={status} listed={temp.get('id') in (listed or [])} reentry={reentry == temp.get('id')} "
            f"delete={deleted} after={after}",
        )

        if images:
            post_json(f"{api}/api/v1/pro/preview", {}, token)
            _, _, body = post_json(f"{api}/api/v1/chat/conversations", {"workspace_id": boot["active_workspace_id"]}, token)
            art = json.loads(body)["id"]
            png = base64.b64encode(_red_circle_png()).decode()
            events, secs = ask(
                f"{api}/api/v1/chat/{art}/messages",
                {"content": "Turn this circle into a glossy red apple on a kitchen counter", "mode": "creative",
                 "mode_confirmed": True,
                 "attachments": [{"type": "image", "data": png, "mime_type": "image/png", "filename": "c.png"}]},
                token,
            )
            first = next((d for e, d in events if e == "image"), None)
            record("IMAGE-EDIT-ATTACHED", bool(first), f"{secs:.0f}s prompt={first and first['prompt'][:50]!r}")
            events, secs = ask(
                f"{api}/api/v1/chat/{art}/messages",
                {"content": "Now make it night-time, lit by one candle", "mode": "creative", "mode_confirmed": True},
                token,
            )
            second = next((d for e, d in events if e == "image"), None)
            record("IMAGE-EDIT-PREVIOUS", bool(second), f"{secs:.0f}s")
            if second:
                status, h, _ = curl([f"{api}/api/v1/images/{second['owner']}/{second['id']}.webp"], 60)
                record("IMAGE-SERVED", status == 200, f"{status}")
    finally:
        status, _, _ = curl(["-X", "DELETE", f"{api}/api/v1/auth/me", *auth], 60)
        record("AUTH-DELETE", status == 204, f"{status} (throwaway removed)")


def _red_circle_png() -> bytes:
    """A 64x64 red circle, drawn without Pillow so the harness has no
    dependencies beyond the standard library."""
    import struct
    import zlib

    w = h = 64
    rows = b""
    for y in range(h):
        row = b"\x00"
        for x in range(w):
            inside = (x - 32) ** 2 + (y - 32) ** 2 < 24**2
            row += b"\xff\x00\x00" if inside else b"\xff\xff\xff"
        rows += row

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(rows))
        + chunk(b"IEND", b"")
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--target", choices=TARGETS, default="prod")
    parser.add_argument("--images", action="store_true", help="also run image generation and editing (costs money)")
    parser.add_argument("--only", nargs="*", choices=["health", "security", "guest", "signed-in"],
                        help="run a subset")
    args = parser.parse_args()
    api, app = TARGETS[args.target]
    run = set(args.only or ["health", "security", "guest", "signed-in"])
    print(f"regression smoke against {args.target}: api={api} app={app}\n")

    if "health" in run:
        check_health(api)
    if "security" in run:
        check_security(api, app)
    if "guest" in run:
        check_guest(api)
    if "signed-in" in run:
        check_signed_in(api, args.images)

    failed = [r for r in results if r[1] == "FAIL"]
    print(f"\n{len(results)} checks: {len(results) - len(failed)} passed or skipped, {len(failed)} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
