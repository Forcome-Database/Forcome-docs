"""Draft Manager — stores and retrieves section drafts.

In Phase 5, this will be backed by Redis with TTL. For now, uses in-memory dict.
"""
from __future__ import annotations
import json
import time
from typing import Any
from app.models.draft import SectionDraft


class DraftStore:
    """In-memory draft storage (will be replaced with Redis in Phase 5)."""

    def __init__(self):
        self._drafts: dict[str, dict[str, Any]] = {}  # key → draft data

    def _make_key(self, workspace_id: str, page_id: str, task_id: str = "") -> str:
        parts = [workspace_id, page_id]
        if task_id:
            parts.append(task_id)
        return ":".join(parts)

    def save_draft(
        self,
        *,
        workspace_id: str,
        page_id: str,
        task_id: str,
        sections: list[SectionDraft],
        blueprint_ref: str = "",
    ) -> str:
        key = self._make_key(workspace_id, page_id, task_id)
        self._drafts[key] = {
            "sections": [s.model_dump() for s in sections],
            "blueprint_ref": blueprint_ref,
            "created_at": time.time(),
            "updated_at": time.time(),
        }
        return key

    def get_draft(self, workspace_id: str, page_id: str, task_id: str = "") -> dict | None:
        key = self._make_key(workspace_id, page_id, task_id)
        return self._drafts.get(key)

    def update_section(
        self,
        workspace_id: str,
        page_id: str,
        task_id: str,
        section_id: str,
        new_content: str,
        new_word_count: int,
    ) -> bool:
        key = self._make_key(workspace_id, page_id, task_id)
        draft = self._drafts.get(key)
        if not draft:
            return False
        for section in draft["sections"]:
            if section["section_id"] == section_id:
                section["content"] = new_content
                section["word_count"] = new_word_count
                draft["updated_at"] = time.time()
                return True
        return False

    def delete_draft(self, workspace_id: str, page_id: str, task_id: str = "") -> bool:
        key = self._make_key(workspace_id, page_id, task_id)
        return self._drafts.pop(key, None) is not None

    def list_drafts(self, workspace_id: str, page_id: str) -> list[str]:
        prefix = self._make_key(workspace_id, page_id)
        return [k for k in self._drafts if k.startswith(prefix)]

    def get_merged_content(self, workspace_id: str, page_id: str, task_id: str) -> str:
        draft = self.get_draft(workspace_id, page_id, task_id)
        if not draft:
            return ""
        sections = draft["sections"]
        return "\n\n".join(s["content"] for s in sections if s.get("content"))


# Module-level singleton
draft_store = DraftStore()
