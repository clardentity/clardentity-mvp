from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AdminSetting

# §11.8 / FR14: model selection, temperature, top-k, scoring weights, avatar
# gesture map, feature flags - all overridable at runtime via /admin, all
# with these as the documented-spec defaults when nothing is stored yet.
DEFAULTS: dict[str, Any] = {
    "openai_model": None,  # null = use OPENAI_MODEL from the environment
    "openai_temperature": None,  # null = don't send temperature at all
    "retrieval_top_k": 5,
    "scoring_weights": {
        "claim_score_weight": 0.6,
        "citation_coverage_weight": 0.25,
        "relevance_weight": 0.15,
        "distortion_penalty": 15,
        "likely_fact_cutoff": 90,
        "plausible_cutoff": 70,
    },
    "avatar_gesture_map": {
        "knowing": "presenting",
        "thinking": "chin_stroke",
        "decision": "weighing_scales",
        "learning": "open_hand_explaining",
    },
    "feature_flags": {
        "tts_enabled": True,
        "image_input_enabled": True,
    },
}


async def get_all_settings(db: AsyncSession) -> dict[str, Any]:
    rows = await db.execute(select(AdminSetting))
    stored = {row.key: row.value for row in rows.scalars().all()}
    return {**DEFAULTS, **stored}


async def get_setting(db: AsyncSession, key: str) -> Any:
    row = await db.get(AdminSetting, key)
    if row is not None:
        return row.value
    return DEFAULTS.get(key)


async def set_setting(db: AsyncSession, key: str, value: Any) -> None:
    row = await db.get(AdminSetting, key)
    if row is None:
        db.add(AdminSetting(key=key, value=value))
    else:
        row.value = value
    await db.commit()
