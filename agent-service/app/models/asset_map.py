from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, Field


class AssetItem(BaseModel):
    """A single extracted asset from source material."""
    id: str
    type: Literal["text", "image", "table", "code", "mermaid", "heading_structure"]
    source: str = ""
    content: str = ""
    summary: str = ""
    suggested_usage: str = ""
    reuse_decision: Literal["reuse", "adapt", "skip"] | None = None
    origin: Literal["uploaded_source", "page_context", "generated_image"] | None = None
    content_hash: str = ""
    caption: str = ""
    source_page: int | None = None
    source_heading: str = ""
    mime_type: str = ""
    source_ref: str = ""


class AssetMap(BaseModel):
    """Collection of all assets extracted from source materials."""
    items: list[AssetItem] = Field(default_factory=list)
    source_structure: list[dict] = Field(default_factory=list)
    source_word_count: int = 0
    source_section_counts: dict[str, int] = Field(default_factory=dict)
    document_title: str = ""
    source_markdown: str = ""

    def items_by_type(self, asset_type: str) -> list[AssetItem]:
        return [item for item in self.items if item.type == asset_type]

    def reusable_items(self) -> list[AssetItem]:
        return [item for item in self.items if item.reuse_decision == "reuse"]
