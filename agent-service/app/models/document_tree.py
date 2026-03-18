from __future__ import annotations

from pydantic import BaseModel, Field


DOCUMENT_TITLE_NODE_ID = "document:title"


def build_section_node_id(section_id: str) -> str:
    return f"section:{section_id}"


class DocumentNode(BaseModel):
    node_id: str
    title: str
    level: int
    content: str = ""
    section_id: str | None = None


class DocumentTree(BaseModel):
    root: DocumentNode = Field(
        default_factory=lambda: DocumentNode(
            node_id=DOCUMENT_TITLE_NODE_ID,
            title="",
            level=1,
            content="",
        )
    )
    sections: list[DocumentNode] = Field(default_factory=list)
