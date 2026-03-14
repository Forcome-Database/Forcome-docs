from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, Field


class CreationBrief(BaseModel):
    """Smart Brief — captures user intent and creation parameters."""
    audience: str = ""
    goal: str = ""
    target_length: int = 0
    length_tolerance: float = 0.1
    style: str = ""
    tone: str = ""
    structure_strategy: Literal["copy_source", "ai_recommend", "user_defined"] = "ai_recommend"
    image_strategy: Literal["reuse_source", "generate_new", "mixed", "none"] = "mixed"
    constraints: list[str] = Field(default_factory=list)
