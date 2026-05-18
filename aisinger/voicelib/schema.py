from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Tier = Literal["simple", "mid", "pro"]


class Voice(BaseModel):
    id: str
    name: str
    tier: Tier
    artifacts: dict[str, str] = Field(default_factory=dict)
    meta: dict = Field(default_factory=dict)
