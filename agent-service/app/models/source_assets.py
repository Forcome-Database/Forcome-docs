from __future__ import annotations

from pydantic import BaseModel, Field


class SourceLocation(BaseModel):
    source_file: str
    page_number: int | None = None
    heading: str = ""
    index: int | None = None


class SourceImagePayload(BaseModel):
    index: int = 0
    b64: str = ""
    desc: str = ""
    mime_type: str = "image/png"
    page: int | None = None
    page_number: int | None = None
    heading: str = ""
    bbox: list[float] = Field(default_factory=list)
    nearby_text: str = ""
    confidence: float = 0.0
    parser: str = "docling"
    is_fallback: bool = False

    @property
    def resolved_page_number(self) -> int | None:
        return self.page_number if self.page_number is not None else self.page

    def to_data_uri(self) -> str:
        return f"data:{self.mime_type};base64,{self.b64}"


class DocumentParseResult(BaseModel):
    text: str = ""
    images: list[SourceImagePayload] = Field(default_factory=list)
    structure: list[dict] = Field(default_factory=list)
    blocks: list[dict] = Field(default_factory=list)
