from datetime import datetime

from pydantic import BaseModel, Field


class RoleQualifierOut(BaseModel):
    id: str
    label: str
    exclusive: bool
    options: list[str]


class RoleOut(BaseModel):
    id: str
    index: int
    label: str
    description: str
    group: str
    qualifiers: list[RoleQualifierOut]


class ProfileRoleOut(BaseModel):
    role_id: str
    label: str
    qualifiers: dict[str, list[str]] = {}
    evidence: str = ""


class ProfileAspectOut(BaseModel):
    id: str
    label: str
    value: str
    #: "inferred" or "user". Only inferred entries are replaced on a rebuild.
    source: str = "inferred"


class ProfileAspectIn(BaseModel):
    label: str
    value: str


class ProfileOut(BaseModel):
    personality_md: str | None
    # What this user calls their companion in each mode, keyed by mode id.
    # Absent keys mean the mode goes by its own label.
    companion_names: dict[str, str] = {}
    aspects: list[ProfileAspectOut] = []
    roles: list[ProfileRoleOut] = []
    # True once the user has edited it: inference stops overwriting from then on.
    user_edited: bool = False
    updated_at: datetime | None = None


class ProfileUpdate(BaseModel):
    personality_md: str | None = Field(default=None, max_length=20000)
    # Omit to leave names untouched; send {} to clear them all.
    companion_names: dict[str, str] | None = None
    # Omit to leave roles untouched; send [] to clear them.
    roles: list[ProfileRoleOut] | None = None
