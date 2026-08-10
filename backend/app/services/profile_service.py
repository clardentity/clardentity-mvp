"""Long-lived user profile: an evolving personality.md plus the 25-role
classification behind it.

Built by inference from the user's own conversations and uploaded documents,
never from an onboarding questionnaire - the product goal is that someone can
start using it immediately and have it get to know them over time.

Two rules the rest of the code depends on:
  * A profile the user has edited is never overwritten by inference
    (`user_edited`). A correction that silently reverts is worse than no
    profile at all.
  * Inferred roles are validated against the taxonomy before they are stored,
    so a hallucinated role or a contradictory pair like brother+sister cannot
    reach the profile.
"""

import json
import re
import uuid
from dataclasses import dataclass

from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Conversation, Document, Message, UserProfile, WorkspaceMember
from app.services import taxonomy
from app.services.openai_client import generate_text

# Enough of the user's own words to characterise them without sending an
# unbounded history to the model on every rebuild.
_MESSAGE_WINDOW = 60
_MESSAGE_CHARS = 12000

# Rebuild only after this many new user messages, so a long conversation
# doesn't trigger a profile rebuild on every turn.
REBUILD_EVERY_N_MESSAGES = 8


@dataclass
class InferredProfile:
    personality_md: str
    roles: list[dict]


_INSTRUCTIONS = (
    "You maintain a durable profile of one person, written for that person to read.\n\n"
    "From their own messages and document titles, infer:\n"
    "1. A short markdown profile covering: how they tend to think and decide, the "
    "subjects and domains they return to, their apparent context and constraints, and "
    "how they seem to prefer information delivered. Write it in the second person "
    "(\"You tend to...\"). Be specific to the evidence and brief - a few short sections, "
    "no filler. If the evidence is thin, say so plainly and keep it short rather than "
    "padding with generic statements.\n"
    "2. Which of the life roles below they occupy, based only on what the evidence "
    "actually shows.\n\n"
    "Rules that matter:\n"
    "- Infer only what the evidence supports. Do not guess at gender, age, nationality, "
    "religion, health, or family structure that is not evidenced. An empty roles list is "
    "a correct answer when nothing is clearly indicated.\n"
    "- Never state a sensitive attribute as fact on weak evidence; omit it instead.\n"
    "- For each role, give a short `evidence` phrase quoting or paraphrasing what "
    "indicated it, so the person can check your reasoning.\n\n"
    "Respond with ONLY a JSON object, no markdown fencing:\n"
    '{"personality_md": "...", "roles": [{"role_id": "...", '
    '"qualifiers": {"qualifier_id": ["value"]}, "evidence": "..."}]}\n\n'
    "ROLES:\n"
)


def _strip_fence(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return text.strip()


async def gather_evidence(db: AsyncSession, user_id: uuid.UUID) -> tuple[str, int]:
    """The user's own words plus their document titles, and how many of their
    messages exist in total (used to decide when a rebuild is due).
    """
    workspace_ids = (
        select(WorkspaceMember.workspace_id)
        .where(WorkspaceMember.user_id == user_id)
        .scalar_subquery()
    )
    conversation_ids = (
        select(Conversation.id)
        .where(Conversation.workspace_id.in_(workspace_ids))
        .scalar_subquery()
    )

    total = await db.scalar(
        select(func.count())
        .select_from(Message)
        .where(Message.conversation_id.in_(conversation_ids), Message.role == "user")
    )

    rows = await db.execute(
        select(Message.content)
        .where(Message.conversation_id.in_(conversation_ids), Message.role == "user")
        .order_by(desc(Message.created_at))
        .limit(_MESSAGE_WINDOW)
    )
    messages = [c for (c,) in rows.all() if c]

    doc_rows = await db.execute(
        select(Document.filename).where(Document.workspace_id.in_(workspace_ids)).limit(40)
    )
    filenames = [f for (f,) in doc_rows.all() if f]

    parts = []
    if messages:
        # Oldest first reads as a trajectory rather than a reverse-chronological dump.
        joined = "\n".join(f"- {m}" for m in reversed(messages))
        parts.append(f"THEIR MESSAGES:\n{joined[:_MESSAGE_CHARS]}")
    if filenames:
        parts.append("DOCUMENTS THEY UPLOADED:\n" + "\n".join(f"- {f}" for f in filenames))

    return ("\n\n".join(parts), total or 0)


async def infer_profile(evidence: str) -> InferredProfile | None:
    """Never raises - a failed inference simply leaves the existing profile alone."""
    if not evidence.strip():
        return None

    try:
        raw = await generate_text(
            fast=True,
            instructions=_INSTRUCTIONS + taxonomy.role_vocabulary(),
            input_text=evidence,
        )
        parsed = json.loads(_strip_fence(raw))
    except Exception:
        return None

    personality = parsed.get("personality_md")
    if not isinstance(personality, str) or not personality.strip():
        return None

    roles: list[dict] = []
    seen: set[str] = set()
    for entry in parsed.get("roles") or []:
        if not isinstance(entry, dict):
            continue
        role_id = entry.get("role_id")
        role = taxonomy.get_role(role_id)
        # Anything outside the 25-role taxonomy is dropped rather than stored.
        if role is None or role.id in seen:
            continue
        seen.add(role.id)
        roles.append(
            {
                "role_id": role.id,
                "qualifiers": taxonomy.validate_role_selection(
                    role.id, entry.get("qualifiers") or {}
                ),
                "evidence": str(entry.get("evidence") or "")[:300],
            }
        )

    return InferredProfile(personality_md=personality.strip(), roles=roles)


async def get_profile(db: AsyncSession, user_id: uuid.UUID) -> UserProfile | None:
    return await db.get(UserProfile, user_id)


async def should_rebuild(db: AsyncSession, user_id: uuid.UUID) -> bool:
    profile = await get_profile(db, user_id)
    if profile is not None and profile.user_edited:
        return False
    _, total = await gather_evidence(db, user_id)
    if total == 0:
        return False
    last = profile.messages_at_last_build if profile else 0
    return (total - last) >= REBUILD_EVERY_N_MESSAGES


async def rebuild_profile(db: AsyncSession, user_id: uuid.UUID) -> UserProfile | None:
    """Regenerate and persist. A hand-edited profile is left untouched."""
    profile = await get_profile(db, user_id)
    if profile is not None and profile.user_edited:
        return profile

    evidence, total = await gather_evidence(db, user_id)
    inferred = await infer_profile(evidence)
    if inferred is None:
        return profile

    if profile is None:
        profile = UserProfile(user_id=user_id)
        db.add(profile)

    profile.personality_md = inferred.personality_md
    profile.roles = inferred.roles
    profile.messages_at_last_build = total
    await db.commit()
    await db.refresh(profile)
    return profile


def profile_prompt_block(profile: UserProfile | None) -> str | None:
    """Compact profile context for the generation prompt.

    Deliberately framed as background that may be stale or wrong, so the model
    adapts tone and framing to the person without treating inferences about
    them as established fact.
    """
    if profile is None or not profile.personality_md:
        return None

    lines = [
        "ABOUT THIS USER (accumulated from earlier sessions; background only - it may "
        "be incomplete or out of date, so never assert it back to them as fact and "
        "never let it override what they say now):",
        profile.personality_md.strip()[:1500],
    ]

    labels = []
    for entry in profile.roles or []:
        role = taxonomy.get_role(entry.get("role_id"))
        if role is None:
            continue
        quals = [v for values in (entry.get("qualifiers") or {}).values() for v in values]
        labels.append(f"{role.label} ({', '.join(quals)})" if quals else role.label)
    if labels:
        lines.append("Life roles they appear to occupy: " + "; ".join(labels))

    return "\n".join(lines)
