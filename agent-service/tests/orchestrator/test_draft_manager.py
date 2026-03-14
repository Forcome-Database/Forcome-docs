"""Tests for DraftStore in-memory draft manager."""
from __future__ import annotations
import pytest
from app.models.draft import SectionDraft
from app.orchestrator.draft_manager import DraftStore


@pytest.fixture
def store():
    """Fresh DraftStore instance per test."""
    return DraftStore()


def make_sections(*ids: str) -> list[SectionDraft]:
    return [
        SectionDraft(section_id=sid, content=f"Content of {sid}", word_count=3)
        for sid in ids
    ]


# ── save & retrieve ──────────────────────────────────────────────────────────

def test_save_and_get_draft(store):
    sections = make_sections("s1", "s2")
    key = store.save_draft(
        workspace_id="ws1",
        page_id="pg1",
        task_id="t1",
        sections=sections,
        blueprint_ref="bp-abc",
    )
    assert key == "ws1:pg1:t1"
    draft = store.get_draft("ws1", "pg1", "t1")
    assert draft is not None
    assert draft["blueprint_ref"] == "bp-abc"
    assert len(draft["sections"]) == 2
    assert draft["sections"][0]["section_id"] == "s1"
    assert draft["sections"][1]["section_id"] == "s2"


def test_get_draft_returns_none_for_missing_key(store):
    result = store.get_draft("ws1", "pg1", "nonexistent")
    assert result is None


def test_save_draft_without_blueprint_ref(store):
    store.save_draft(
        workspace_id="ws1",
        page_id="pg1",
        task_id="t1",
        sections=make_sections("s1"),
    )
    draft = store.get_draft("ws1", "pg1", "t1")
    assert draft["blueprint_ref"] == ""


# ── update section ───────────────────────────────────────────────────────────

def test_update_section_modifies_content(store):
    store.save_draft(
        workspace_id="ws1",
        page_id="pg1",
        task_id="t1",
        sections=make_sections("s1", "s2"),
    )
    ok = store.update_section("ws1", "pg1", "t1", "s1", "New content here", 3)
    assert ok is True
    draft = store.get_draft("ws1", "pg1", "t1")
    s1 = next(s for s in draft["sections"] if s["section_id"] == "s1")
    assert s1["content"] == "New content here"
    assert s1["word_count"] == 3


def test_update_section_returns_false_for_missing_draft(store):
    ok = store.update_section("ws1", "pg1", "missing", "s1", "x", 1)
    assert ok is False


def test_update_section_returns_false_for_missing_section_id(store):
    store.save_draft(
        workspace_id="ws1",
        page_id="pg1",
        task_id="t1",
        sections=make_sections("s1"),
    )
    ok = store.update_section("ws1", "pg1", "t1", "nonexistent", "x", 1)
    assert ok is False


# ── delete ───────────────────────────────────────────────────────────────────

def test_delete_draft_removes_entry(store):
    store.save_draft(
        workspace_id="ws1",
        page_id="pg1",
        task_id="t1",
        sections=make_sections("s1"),
    )
    ok = store.delete_draft("ws1", "pg1", "t1")
    assert ok is True
    assert store.get_draft("ws1", "pg1", "t1") is None


def test_delete_draft_returns_false_for_nonexistent(store):
    ok = store.delete_draft("ws1", "pg1", "ghost")
    assert ok is False


# ── list drafts ───────────────────────────────────────────────────────────────

def test_list_drafts_by_workspace_and_page(store):
    store.save_draft(workspace_id="ws1", page_id="pg1", task_id="t1", sections=make_sections("s1"))
    store.save_draft(workspace_id="ws1", page_id="pg1", task_id="t2", sections=make_sections("s2"))
    store.save_draft(workspace_id="ws1", page_id="pg2", task_id="t3", sections=make_sections("s3"))

    keys = store.list_drafts("ws1", "pg1")
    assert "ws1:pg1:t1" in keys
    assert "ws1:pg1:t2" in keys
    assert "ws1:pg2:t3" not in keys


def test_list_drafts_empty_when_none(store):
    assert store.list_drafts("ws_x", "pg_x") == []


# ── merged content ────────────────────────────────────────────────────────────

def test_get_merged_content_joins_sections(store):
    sections = [
        SectionDraft(section_id="s1", content="First section", word_count=2),
        SectionDraft(section_id="s2", content="Second section", word_count=2),
        SectionDraft(section_id="s3", content="Third section", word_count=2),
    ]
    store.save_draft(workspace_id="ws1", page_id="pg1", task_id="t1", sections=sections)
    merged = store.get_merged_content("ws1", "pg1", "t1")
    assert merged == "First section\n\nSecond section\n\nThird section"


def test_get_merged_content_skips_empty_sections(store):
    sections = [
        SectionDraft(section_id="s1", content="Intro", word_count=1),
        SectionDraft(section_id="s2", content="", word_count=0),
        SectionDraft(section_id="s3", content="Conclusion", word_count=1),
    ]
    store.save_draft(workspace_id="ws1", page_id="pg1", task_id="t1", sections=sections)
    merged = store.get_merged_content("ws1", "pg1", "t1")
    assert merged == "Intro\n\nConclusion"


def test_get_merged_content_returns_empty_for_missing_draft(store):
    result = store.get_merged_content("ws1", "pg1", "no_such_task")
    assert result == ""
