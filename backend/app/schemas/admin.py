from typing import Any

from pydantic import BaseModel


class AdminSettingsOut(BaseModel):
    settings: dict[str, Any]


class AdminSettingUpdate(BaseModel):
    key: str
    value: Any
