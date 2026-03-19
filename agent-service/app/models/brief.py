from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, Field, field_validator

ImageStrategy = Literal[
    "reuse_source_only",
    "prefer_source_then_generate",
    "generate_new_only",
    "none",
]

_LEGACY_IMAGE_STRATEGY_MAP = {
    "reuse_source": "reuse_source_only",
    "mixed": "prefer_source_then_generate",
    "generate_new": "generate_new_only",
    "none": "none",
}


def normalize_image_strategy(value: str | None) -> ImageStrategy:
    normalized = _LEGACY_IMAGE_STRATEGY_MAP.get(value or "", value or "prefer_source_then_generate")
    if normalized not in {
        "reuse_source_only",
        "prefer_source_then_generate",
        "generate_new_only",
        "none",
    }:
        return "prefer_source_then_generate"
    return normalized  # type: ignore[return-value]


class CreationBrief(BaseModel):
    """Smart Brief — captures user intent and creation parameters."""
    audience: str = ""
    goal: str = ""
    target_length: int = 0
    length_tolerance: float = 0.1
    style: str = ""
    tone: str = ""
    structure_strategy: Literal["copy_source", "ai_recommend", "user_defined"] = "ai_recommend"
    image_strategy: ImageStrategy = "prefer_source_then_generate"
    constraints: list[str] = Field(default_factory=list)

    @field_validator("image_strategy", mode="before")
    @classmethod
    def normalize_image_strategy_value(cls, value: str | None) -> ImageStrategy:
        return normalize_image_strategy(value)
