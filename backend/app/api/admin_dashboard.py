"""The administrator's view: who is signed up, what they are costing, and -
from PostHog - what visitors did in the browser.

Read-only, and gated on an explicit list of addresses in configuration
(services/admin_access) rather than on being signed in, because every
response here contains other people's email addresses.
"""

import logging
import re
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.db.session import AsyncSessionLocal, get_db
from app.models import AdminView, Conversation, Message, User, Workspace
from app.schemas.admin_dashboard import (
    AdminOverview,
    AdminUserRow,
    AdminViewCreate,
    AdminViewOut,
    AnalyticsDay,
    AnalyticsOverview,
    AnalyticsSlice,
    DynamicQueryRequest,
    DynamicQueryResult,
    UsageBucket,
)
from app.services import posthog_analytics
from app.services.admin_access import is_admin
from app.services.anthropic_client import generate_structured

logger = logging.getLogger("clardentity.admin")

router = APIRouter(prefix="/admin", tags=["admin"])


async def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if not is_admin(current_user):
        # 404 rather than 403: an endpoint that answers "you are not allowed"
        # has confirmed it exists, which is a map for anyone probing.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return current_user


def add_model_spend(per_model: dict[str, int], usage: dict | None) -> None:
    """Fold one turn's per-model split into a running total.

    This is the meter's own breakdown, so the small model that planned the
    searches is counted separately from the flagship that wrote the answer -
    which is the point of having it. It does not sum to the turn totals for
    anything recorded before the meter kept a split; those turns simply
    contribute nothing here rather than being guessed at and smeared across
    whichever model is currently popular.

    Defensive about the shape because this is JSON off a row that several
    versions of the code have written.
    """
    by_model = (usage or {}).get("by_model")
    if not isinstance(by_model, dict):
        return
    for name, split in by_model.items():
        if not isinstance(name, str) or not isinstance(split, dict):
            continue
        try:
            spent = int(split.get("input_tokens") or 0) + int(split.get("output_tokens") or 0)
        except (TypeError, ValueError):
            continue
        if spent:
            per_model[name] = per_model.get(name, 0) + spent


def _tokens(usage: dict | None) -> tuple[int, int]:
    if not usage:
        return 0, 0
    return int(usage.get("input_tokens") or 0), int(usage.get("output_tokens") or 0)


@router.get("/overview", response_model=AdminOverview)
async def overview(
    days: int = Query(30, ge=1, le=365),
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminOverview:
    """Everything the dashboard needs in one round trip: the roster, the
    totals, the per-user split that draws the pie, and a daily series.

    Token usage is read from messages.token_usage, which the chat route
    writes per turn (services/token_meter). Turns answered before that was
    added carry no usage and count as zero - visible in the "turns without a
    usage record" figure rather than quietly smeared across the rest.
    """
    since = datetime.now(UTC) - timedelta(days=days)

    users = (await db.execute(select(User).order_by(User.created_at.desc()))).scalars().all()

    # One pass over assistant messages, joined back to the account that owns
    # the workspace the conversation lives in.
    rows = (
        await db.execute(
            select(
                Workspace.owner_id,
                Message.token_usage,
                Message.created_at,
                Message.mode_used,
            )
            .select_from(Message)
            .join(Conversation, Conversation.id == Message.conversation_id)
            .join(Workspace, Workspace.id == Conversation.workspace_id)
            .where(Message.role == "assistant")
        )
    ).all()

    per_user: dict[uuid.UUID, dict] = {}
    per_day: dict[str, int] = {}
    per_mode: dict[str, int] = {}
    per_model: dict[str, int] = {}
    total_in = total_out = 0
    unmetered = 0

    for owner_id, usage, created_at, mode in rows:
        tin, tout = _tokens(usage)
        if not usage:
            unmetered += 1
        total_in += tin
        total_out += tout
        bucket = per_user.setdefault(owner_id, {"input": 0, "output": 0, "turns": 0})
        bucket["input"] += tin
        bucket["output"] += tout
        bucket["turns"] += 1
        if created_at and created_at >= since:
            day = created_at.strftime("%Y-%m-%d")
            per_day[day] = per_day.get(day, 0) + tin + tout
        if mode:
            per_mode[mode] = per_mode.get(mode, 0) + tin + tout
        add_model_spend(per_model, usage)

    # Questions asked, counted separately so a user with no answers yet still
    # shows their activity.
    asked = dict(
        (
            await db.execute(
                select(Workspace.owner_id, func.count(Message.id))
                .select_from(Message)
                .join(Conversation, Conversation.id == Message.conversation_id)
                .join(Workspace, Workspace.id == Conversation.workspace_id)
                .where(Message.role == "user")
                .group_by(Workspace.owner_id)
            )
        ).all()
    )
    last_seen = dict(
        (
            await db.execute(
                select(Workspace.owner_id, func.max(Message.created_at))
                .select_from(Message)
                .join(Conversation, Conversation.id == Message.conversation_id)
                .join(Workspace, Workspace.id == Conversation.workspace_id)
                .group_by(Workspace.owner_id)
            )
        ).all()
    )

    roster = []
    for u in users:
        bucket = per_user.get(u.id, {"input": 0, "output": 0, "turns": 0})
        roster.append(
            AdminUserRow(
                id=u.id,
                email=u.email,
                display_name=u.display_name,
                created_at=u.created_at,
                last_active_at=last_seen.get(u.id),
                location=u.location_label,
                accepted_terms=u.terms_accepted_at is not None,
                onboarded=u.onboarding_completed_at is not None,
                preview_unlocked=u.preview_unlocked_at is not None,
                questions_asked=int(asked.get(u.id, 0)),
                answers=bucket["turns"],
                input_tokens=bucket["input"],
                output_tokens=bucket["output"],
                total_tokens=bucket["input"] + bucket["output"],
            )
        )

    return AdminOverview(
        generated_at=datetime.now(UTC),
        window_days=days,
        user_count=len(users),
        active_user_count=sum(1 for r in roster if r.answers > 0),
        conversation_count=int(await db.scalar(select(func.count(Conversation.id))) or 0),
        answer_count=len(rows),
        turns_without_usage=unmetered,
        input_tokens=total_in,
        output_tokens=total_out,
        total_tokens=total_in + total_out,
        users=roster,
        by_day=[UsageBucket(label=d, tokens=t) for d, t in sorted(per_day.items())],
        by_mode=[
            UsageBucket(label=m, tokens=t)
            for m, t in sorted(per_mode.items(), key=lambda kv: -kv[1])
        ],
        by_model=[
            UsageBucket(label=m, tokens=t)
            for m, t in sorted(per_model.items(), key=lambda kv: -kv[1])
        ],
    )


# ---------------------------------------------------------------------------
# The dynamic view: a question in English, answered from the database (or,
# since 2026-10-13, from PostHog's analytics events - see _execute).
#
# WrenAI does this as a service of its own; running it would mean another
# deployment, another vector store and another thing to keep upright for a
# feature used by one person. The same job here is one model call and a hard
# gate: the model may only write a single read-only SELECT over an allowed
# set of tables, the statement is checked before it runs, and it runs under a
# read-only transaction with a row cap. The model's opinion is a suggestion;
# the gate is what makes it safe.
# ---------------------------------------------------------------------------

# Tables the question may touch. Deliberately excludes messages.content,
# documents and chunks - an administrator asking a question about usage has
# no business reading what people wrote, and a view that could would be the
# opposite of what the privacy notice promises.
_ALLOWED_TABLES = {
    "users",
    "workspaces",
    "conversations",
    "messages",
    "message_claims",
    "documents",
    "pro_interest",
}
_FORBIDDEN_COLUMNS = {
    "content",
    "password_hash",
    "transcript",
    "claim_text",
    "excerpt",
    "title",
    "filename",
}
_SCHEMA_NOTE = """
users(id, email, display_name, created_at, location_label, location_country,
      onboarding_completed_at, terms_accepted_at, preview_unlocked_at)
workspaces(id, owner_id -> users.id, name, created_at)
conversations(id, workspace_id -> workspaces.id, title, default_mode,
              pinned_at, created_at)
messages(id, conversation_id -> conversations.id, role ('user'|'assistant'),
         mode_used, confidence_score, confidence_band, token_usage (jsonb with
         input_tokens, output_tokens, total_tokens, calls, by_model),
         feedback (jsonb with rating), created_at)
message_claims(id, message_id -> messages.id, claim_score, entailment_label,
               distortion_flag, created_at)
documents(id, workspace_id -> workspaces.id, file_type, status, created_at)
pro_interest(id, user_id -> users.id, requested_model, created_at)
"""

_SQL_SCHEMA = {
    "type": "object",
    "properties": {
        "sql": {"type": "string"},
        "chart": {"type": "string", "enum": ["table", "bar", "pie", "line"]},
        "label_column": {"type": "string"},
        "value_column": {"type": "string"},
        "explanation": {"type": "string"},
    },
    "required": ["sql", "chart", "explanation"],
    "additionalProperties": False,
}

_STATEMENT_SPLIT = re.compile(r";\s*\S")
_WRITE_WORDS = re.compile(
    r"\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|"
    r"vacuum|comment|call|do|merge|set|begin|commit|rollback)\b",
    re.I,
)


def _vet(sql: str) -> str:
    """Refuse anything that is not one plain read. Checked here rather than
    trusted to the prompt: a model told to write only SELECTs will still,
    occasionally, write something else, and this is a database with everyone's
    data in it."""
    statement = sql.strip().rstrip(";").strip()
    if not statement:
        raise HTTPException(status_code=400, detail="No query was produced")
    if _STATEMENT_SPLIT.search(sql.strip()):
        raise HTTPException(status_code=400, detail="Only one statement at a time")
    if not re.match(r"^(select|with)\b", statement, re.I):
        raise HTTPException(status_code=400, detail="Only SELECT queries are allowed")
    if _WRITE_WORDS.search(statement):
        raise HTTPException(status_code=400, detail="That query would change data")
    lowered = statement.lower()
    for column in _FORBIDDEN_COLUMNS:
        if re.search(rf"\b{column}\b", lowered):
            raise HTTPException(
                status_code=400,
                detail=f"The dashboard does not read {column} - it holds what people wrote",
            )
    # Names a CTE defines are references to the query's own intermediate
    # results, not to tables, so they are allowed alongside the real ones.
    defined = set(re.findall(r"\b([a-z_][a-z0-9_]*)\s+as\s*\(", lowered))
    for table in re.findall(r"\b(?:from|join)\s+([a-z_][a-z0-9_]*)", lowered):
        if table not in _ALLOWED_TABLES and table not in defined:
            raise HTTPException(status_code=400, detail=f"Table {table} is not available here")
    _vet_shape(lowered)
    return statement


# Whole rows and system functions: the column list above is a word match, so
# `SELECT m FROM messages m`, `SELECT u.* FROM users u` or `to_jsonb(m)` read
# every column of a row - content and password hashes included - without
# naming one; a quoted or comma-joined table slipped past the table list;
# and pg_terminate_backend and friends run even in a read-only transaction.
_REFUSED_FUNCTIONS = re.compile(
    r"\b(to_jsonb?|row_to_json|json_agg|jsonb_agg|json_object_agg|jsonb_object_agg|"
    r"array_agg|string_agg|row|pg_[a-z_]+|current_setting|set_config|dblink[a-z_]*|"
    r"lo_[a-z_]+|query_to_xml|table_to_xml|txid_[a-z_]+)\s*\(",
)
_SOURCE = re.compile(r"\b(?:from|join)\s+([a-z_][a-z0-9_]*)(?:\s+(?:as\s+)?([a-z_][a-z0-9_]*))?")
_NOT_ALIASES = {
    "on", "where", "join", "left", "right", "inner", "outer", "full", "cross", "group",
    "order", "limit", "having", "union", "using", "natural", "lateral", "offset", "window",
}


def _vet_shape(lowered: str) -> None:
    def refuse(why: str) -> None:
        raise HTTPException(status_code=400, detail=why)

    if '"' in lowered or "`" in lowered:
        refuse("Quoted names are not allowed here")
    if re.search(r"\b(pg_catalog|information_schema|pg_stat[a-z_]*)\b", lowered):
        refuse("System tables are not available here")
    if _REFUSED_FUNCTIONS.search(lowered):
        refuse("That function is not available here - name the columns you need")
    if re.search(r"\bfrom\s+[a-z_][a-z0-9_]*(?:\s+(?:as\s+)?[a-z_][a-z0-9_]*)?\s*,", lowered):
        refuse("Use JOIN ... ON rather than a comma between tables")
    sources = _SOURCE.findall(lowered)
    if any(t in _ALLOWED_TABLES for t, _ in sources) and "*" in re.sub(
        r"count\s*\(\s*\*\s*\)", "", lowered
    ):
        refuse("Name the columns you need rather than *")
    # A table or alias standing on its own - not `alias.column`, and not
    # where it is introduced - is the whole row.
    # Only real tables and their aliases: a CTE's columns were already
    # vetted where the CTE was written.
    real = [(t, a) for t, a in sources if t in _ALLOWED_TABLES]
    names = {t for t, _ in real} | {a for _, a in real if a and a not in _NOT_ALIASES}
    scrubbed = _SOURCE.sub(" ", lowered)
    for name in names:
        if re.search(rf"(?<![.\w]){re.escape(name)}\b(?!\s*\.)", scrubbed):
            refuse("Name the columns you need rather than a whole row")


_HOGQL_TABLES = {"events", "persons", "sessions"}


def _vet_hogql(query: str) -> str:
    """The analytics side of _vet. HogQL has no statement that writes, so this
    is about scope: one SELECT, over the event tables, nothing else in the
    project. PostHog holds no content to protect (see services/posthog_analytics),
    which is why there is no column list here."""
    statement = query.strip().rstrip(";").strip()
    if not statement:
        raise HTTPException(status_code=400, detail="No query was produced")
    if _STATEMENT_SPLIT.search(query.strip()):
        raise HTTPException(status_code=400, detail="Only one statement at a time")
    if not re.match(r"^(select|with)\b", statement, re.I):
        raise HTTPException(status_code=400, detail="Only SELECT queries are allowed")
    lowered = statement.lower()
    defined = set(re.findall(r"\b([a-z_][a-z0-9_]*)\s+as\s*\(", lowered))
    for table in re.findall(r"\b(?:from|join)\s+([a-z_][a-z0-9_.]*)", lowered):
        if table not in _HOGQL_TABLES and table not in defined:
            raise HTTPException(status_code=400, detail=f"Table {table} is not available here")
    return statement


async def _run_database(statement: str) -> tuple[list[str], list[list]]:
    # A separate session set read-only for the duration, so even a query that
    # slipped past the checks above cannot write. The statement timeout stops
    # a careless cross join taking the instance with it.
    async with AsyncSessionLocal() as db:
        try:
            await db.execute(text("SET LOCAL transaction_read_only = on"))
            await db.execute(text("SET LOCAL statement_timeout = '10s'"))
            result = await db.execute(text(statement))
            columns = list(result.keys())
            rows = [list(r) for r in result.fetchmany(500)]
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001 - the query is user-shaped input
            logger.info("dashboard query failed: %s", exc)
            raise HTTPException(
                status_code=400, detail=f"That query did not run: {str(exc)[:200]}"
            ) from exc
        finally:
            await db.rollback()
    return columns, rows


async def _run_analytics(statement: str, *, name: str) -> tuple[list[str], list[list]]:
    try:
        columns, rows = await posthog_analytics.run_hogql(statement, name=name)
    except posthog_analytics.AnalyticsUnavailable as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return columns, rows[:500]


_UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


async def _with_accounts(
    columns: list[str], rows: list[list], label_column: str | None
) -> tuple[list[str], list[list], str | None]:
    """PostHog knows a signed-in visitor only by their account id - that is
    all the app sends it. Where an analytics answer has a column of those
    ids, the account's email is put next to it, so a row reads as a person
    without anything having been copied out of the database into PostHog."""
    for index in reversed(range(len(columns))):
        ids = {str(r[index]) for r in rows if r[index] is not None and _UUID.match(str(r[index]))}
        if not ids:
            continue
        async with AsyncSessionLocal() as db:
            found = dict(
                (
                    await db.execute(
                        select(User.id, User.email).where(User.id.in_([uuid.UUID(i) for i in ids]))
                    )
                ).all()
            )
        if not found:
            continue
        emails = {str(k): v for k, v in found.items()}
        name = f"{columns[index]}_account"
        columns = [*columns[: index + 1], name, *columns[index + 1 :]]
        rows = [[*r[: index + 1], emails.get(str(r[index])), *r[index + 1 :]] for r in rows]
        if label_column == columns[index]:
            label_column = name
    return columns, rows, label_column


_DATABASE_INSTRUCTIONS = (
    "For source 'database', write one read-only PostgreSQL query over our own "
    "database - accounts, conversations, answers, tokens, feedback, for everyone.\n"
    f"The only tables and columns available are:\n{_SCHEMA_NOTE}\n"
    "Rules: a single SELECT (a leading WITH is fine); never any statement "
    "that writes; never read message content, claim text, document "
    "filenames, conversation titles or password hashes - those hold what "
    "users wrote and are off limits; always alias computed columns readably; "
    "add LIMIT 200 unless the question is an aggregate that returns fewer "
    "rows. Token usage lives in messages.token_usage as jsonb - read it with "
    "(token_usage->>'total_tokens')::bigint and coalesce it to 0.\n"
)

_ANALYTICS_INSTRUCTIONS = (
    "For source 'analytics', write one HogQL query (PostHog's ClickHouse-flavoured "
    "SQL) over the product analytics events - what visitors did in the browser, "
    "only those who allowed analytics.\n"
    f"{posthog_analytics.HOGQL_NOTE}\n"
    "Rules: a single SELECT from events; read properties as properties.<name>; "
    "people are count(DISTINCT distinct_id); days are toDate(timestamp); always "
    "filter timestamp to a window (the last 30 days unless the question says "
    "otherwise, e.g. timestamp >= now() - INTERVAL 30 DAY); alias computed "
    "columns readably; add LIMIT 200.\n"
)

_CHOOSE_SOURCE = (
    "Choose the source from the question: 'database' for accounts, sign-ups, "
    "questions asked, answers, tokens, cost, feedback and anything that must "
    "count everyone; 'analytics' for what happened in the browser - the "
    "landing-page demo, gates shown, locked companions tapped, plans opened, "
    "tours, themes, devices, pages viewed.\n"
)


def _plan_schema(with_source: bool) -> dict:
    schema = {
        "type": "object",
        "properties": dict(_SQL_SCHEMA["properties"]),
        "required": list(_SQL_SCHEMA["required"]),
        "additionalProperties": False,
    }
    if with_source:
        schema["properties"]["source"] = {"type": "string", "enum": ["database", "analytics"]}
        schema["required"].append("source")
    return schema


async def _execute(source: str, query: str, *, name: str) -> tuple[str, list[str], list[list]]:
    """Check and run one query against the store it was written for."""
    if source == "analytics":
        statement = _vet_hogql(query)
        columns, rows = await _run_analytics(statement, name=name)
    else:
        statement = _vet(query)
        columns, rows = await _run_database(statement)
    return statement, columns, rows


@router.post("/query", response_model=DynamicQueryResult)
async def dynamic_query(
    payload: DynamicQueryRequest,
    _: User = Depends(require_admin),
) -> DynamicQueryResult:
    """Ask for a view in English; get rows and a chart suggestion back - from
    our database, or from PostHog's analytics events, whichever the question
    is about (or whichever was asked for)."""
    question = payload.question.strip()
    if not question:
        raise HTTPException(status_code=400, detail="Ask a question first")

    analytics_ready = posthog_analytics.configured()
    if payload.source == "analytics" and not analytics_ready:
        raise HTTPException(status_code=400, detail="Analytics is not connected yet")
    choosing = payload.source == "auto" and analytics_ready
    fixed = None if choosing else ("analytics" if payload.source == "analytics" else "database")

    parts = ["You answer the administrator's question about their own product's usage with one read-only query.\n"]
    if fixed in (None, "database"):
        parts.append(_DATABASE_INSTRUCTIONS)
    if fixed in (None, "analytics"):
        parts.append(_ANALYTICS_INSTRUCTIONS)
    if choosing:
        parts.append(_CHOOSE_SOURCE)
    else:
        parts.append(f"The source is '{fixed}'.\n")
    parts.append(
        "Pick the chart that suits the answer: pie for a share of a whole, bar "
        "for a comparison across categories, line for a series over time, table "
        "otherwise. Name the label and value columns for the chart. Explain in "
        "one sentence what the query returns."
    )

    plan = await generate_structured(
        instructions="".join(parts),
        input_text=question,
        schema=_plan_schema(choosing),
        schema_name="dashboard_query",
        fast=False,
    )
    source = plan.get("source") if choosing else fixed
    if source not in ("database", "analytics"):
        source = "database"

    statement, columns, rows = await _execute(source, plan.get("sql", ""), name=question[:80])
    label_column = plan.get("label_column")
    if source == "analytics":
        columns, rows, label_column = await _with_accounts(columns, rows, label_column)

    return DynamicQueryResult(
        question=question,
        sql=statement,
        explanation=plan.get("explanation", ""),
        chart=plan.get("chart", "table"),
        label_column=label_column,
        value_column=plan.get("value_column"),
        columns=columns,
        rows=[[_jsonable(v) for v in row] for row in rows],
        source=source,
    )


def _jsonable(value):
    if isinstance(value, (datetime,)):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


# ---------------------------------------------------------------------------
# Analytics: what visitors did in the browser, read from PostHog.
# ---------------------------------------------------------------------------


@router.get("/analytics", response_model=AnalyticsOverview)
async def analytics_overview(
    days: int = Query(30, ge=1, le=365),
    _: User = Depends(require_admin),
) -> AnalyticsOverview:
    """The fixed analytics views. Never an error page: not connected, or
    PostHog not answering, comes back as a state the panel can explain,
    because the database half of the dashboard does not depend on it."""
    now = datetime.now(UTC)
    if not posthog_analytics.configured():
        return AnalyticsOverview(configured=False, window_days=days, generated_at=now)
    try:
        view = await posthog_analytics.overview(days)
    except posthog_analytics.AnalyticsUnavailable as exc:
        return AnalyticsOverview(configured=True, error=str(exc), window_days=days, generated_at=now)

    def slices(rows: list[dict]) -> list[AnalyticsSlice]:
        return [AnalyticsSlice(label=r["label"], value=r["value"]) for r in rows if r["value"] > 0]

    return AnalyticsOverview(
        configured=True,
        window_days=days,
        generated_at=now,
        visitors=view.visitors,
        signed_in_visitors=view.signed_in_visitors,
        events=view.events,
        by_day=[AnalyticsDay(**d) for d in view.by_day],
        demo_funnel=[AnalyticsSlice(**r) for r in posthog_analytics.demo_funnel(view)],
        demo_gated=slices(view.series("guest_demo_gated", people=True)),
        modes_picked=slices(view.series("mode_picked")),
        questions_by_mode=slices(view.series("question_asked")),
        gates=slices(view.series("gate_shown")),
        locked_modes=slices(view.series("locked_mode_tapped", people=True)),
        upgrade_interest=slices(
            [
                {"label": "Tapped a locked companion", "value": view.total("locked_mode_tapped", people=True)},
                {"label": "Opened the plans", "value": view.total("plans_opened", people=True)},
                {"label": "Turned on preview", "value": view.total("preview_opened", people=True)},
            ]
        ),
        feedback=slices(view.series("feedback_given")),
        devices=slices(view.series("app_opened", people=True)),
        problems=slices(
            [
                {"label": "Answers failed", "value": view.total("answer_failed")},
                {"label": "Connections dropped", "value": view.total("stream_dropped")},
            ]
        ),
    )


# ---------------------------------------------------------------------------
# Pinned views: the dashboard is whatever the administrator has asked for.
# ---------------------------------------------------------------------------


@router.get("/views", response_model=list[AdminViewOut])
async def list_views(
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> list[AdminViewOut]:
    rows = (await db.execute(select(AdminView).order_by(AdminView.created_at))).scalars().all()
    return [AdminViewOut.model_validate(v) for v in rows]


@router.post("/views", response_model=AdminViewOut, status_code=status.HTTP_201_CREATED)
async def pin_view(
    payload: AdminViewCreate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminViewOut:
    query = _vet_hogql(payload.query) if payload.source == "analytics" else _vet(payload.query)
    view = AdminView(
        title=payload.title.strip(),
        source=payload.source,
        query=query,
        chart=payload.chart,
        label_column=payload.label_column,
        value_column=payload.value_column,
        explanation=payload.explanation,
        created_by=admin.id,
    )
    db.add(view)
    await db.commit()
    await db.refresh(view)
    return AdminViewOut.model_validate(view)


@router.delete("/views/{view_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unpin_view(
    view_id: uuid.UUID,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> None:
    view = await db.get(AdminView, view_id)
    if view is None:
        raise HTTPException(status_code=404, detail="Not found")
    await db.delete(view)
    await db.commit()


@router.get("/views/{view_id}/result", response_model=DynamicQueryResult)
async def run_view(
    view_id: uuid.UUID,
    _: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> DynamicQueryResult:
    """Run a pinned view now. No model call: the stored query is checked
    again and run as it is, so a pinned tile is live and free to refresh."""
    view = await db.get(AdminView, view_id)
    if view is None:
        raise HTTPException(status_code=404, detail="Not found")
    statement, columns, rows = await _execute(view.source, view.query, name=view.title[:80])
    label_column = view.label_column
    if view.source == "analytics":
        columns, rows, label_column = await _with_accounts(columns, rows, label_column)
    return DynamicQueryResult(
        question=view.title,
        sql=statement,
        explanation=view.explanation or "",
        chart=view.chart,
        label_column=label_column,
        value_column=view.value_column,
        columns=columns,
        rows=[[_jsonable(v) for v in row] for row in rows],
        source=view.source,
    )
