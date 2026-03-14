"""Tests for the cross-section consistency checker."""
from __future__ import annotations
import pytest
from app.models.draft import SectionDraft
from app.models.blueprint import CreationBlueprint, SectionPlan
from app.workers.consistency_checker import (
    ConsistencyIssue,
    check_heading_continuity,
    check_term_consistency,
    check_cross_references,
    check_empty_sections,
    run_consistency_checks,
)


# ── helpers ──────────────────────────────────────────────────────────────────

def make_blueprint(*sections: tuple[str, str, int]) -> CreationBlueprint:
    """sections: (id, title, level)"""
    return CreationBlueprint(
        title="Test Doc",
        sections=[SectionPlan(id=sid, title=title, level=level) for sid, title, level in sections],
    )


def make_draft(section_id: str, content: str, word_count: int = 10) -> SectionDraft:
    return SectionDraft(section_id=section_id, content=content, word_count=word_count)


# ── ConsistencyIssue ─────────────────────────────────────────────────────────

def test_consistency_issue_to_dict():
    issue = ConsistencyIssue(section_id="s1", category="heading_level", description="Bad heading")
    d = issue.to_dict()
    assert d == {"section_id": "s1", "category": "heading_level", "description": "Bad heading"}


def test_consistency_issue_none_section_id():
    issue = ConsistencyIssue(section_id=None, category="term_inconsistency", description="Mixed terms")
    assert issue.to_dict()["section_id"] is None


# ── heading continuity ────────────────────────────────────────────────────────

def test_heading_continuity_detects_h1_in_h2_section():
    """H2 section that contains an H1 heading is invalid."""
    blueprint = make_blueprint(("s1", "Overview", 2))
    drafts = [make_draft("s1", "# Top-level heading\n\nSome text here")]
    issues = check_heading_continuity(drafts, blueprint)
    assert len(issues) == 1
    assert issues[0].category == "heading_level"
    assert issues[0].section_id == "s1"
    assert "H1" in issues[0].description
    assert "H2" in issues[0].description


def test_heading_continuity_no_issue_when_subheadings_deeper():
    """H3 inside an H2 section is valid."""
    blueprint = make_blueprint(("s1", "Overview", 2))
    drafts = [make_draft("s1", "### Sub-topic\n\nSome text here")]
    issues = check_heading_continuity(drafts, blueprint)
    assert issues == []


def test_heading_continuity_same_level_triggers_issue():
    """H2 heading inside an H2 section should be flagged."""
    blueprint = make_blueprint(("s1", "Methods", 2))
    drafts = [make_draft("s1", "## Another H2\n\nContent")]
    issues = check_heading_continuity(drafts, blueprint)
    assert len(issues) == 1
    assert issues[0].category == "heading_level"


def test_heading_continuity_no_headings_in_content():
    """Plain prose with no headings passes."""
    blueprint = make_blueprint(("s1", "Intro", 2))
    drafts = [make_draft("s1", "Just some plain prose without headings.")]
    issues = check_heading_continuity(drafts, blueprint)
    assert issues == []


# ── term consistency ──────────────────────────────────────────────────────────

def test_term_inconsistency_detected_across_sections():
    """'API Key' and 'api key' used in different sections → flagged."""
    drafts = [
        make_draft("s1", 'Use the "API Key" to authenticate.'),
        make_draft("s2", 'Store your "api key" securely.'),
    ]
    issues = check_term_consistency(drafts)
    assert any(i.category == "term_inconsistency" for i in issues)
    # Both variants should appear in description
    issue = next(i for i in issues if i.category == "term_inconsistency")
    assert "API Key" in issue.description or "api key" in issue.description


def test_term_consistency_no_issue_when_consistent():
    """Same term used consistently across sections → no issue."""
    drafts = [
        make_draft("s1", 'Use the "API Key" to authenticate.'),
        make_draft("s2", 'The "API Key" should be rotated regularly.'),
    ]
    issues = check_term_consistency(drafts)
    assert issues == []


def test_term_inconsistency_skips_short_terms():
    """Two-char or shorter normalized terms are ignored."""
    drafts = [
        make_draft("s1", '"AI" is great.'),
        make_draft("s2", '"ai" is here.'),
    ]
    issues = check_term_consistency(drafts)
    # 'ai' has length 2 which is not > 2, so should not be flagged
    assert not any(i.category == "term_inconsistency" for i in issues)


# ── cross references ──────────────────────────────────────────────────────────

def test_cross_reference_invalid_chapter_number():
    """Reference to chapter 99 in a 3-section doc is flagged."""
    blueprint = make_blueprint(("s1", "Intro", 2), ("s2", "Body", 2), ("s3", "Conclusion", 2))
    drafts = [make_draft("s1", "As mentioned in section 99, the approach works.")]
    issues = check_cross_references(drafts, blueprint)
    assert any(i.category == "cross_reference" for i in issues)
    issue = next(i for i in issues if i.category == "cross_reference")
    assert "99" in issue.description


def test_cross_reference_valid_chapter_no_issue():
    """Reference to chapter 2 in a 3-section doc is fine."""
    blueprint = make_blueprint(("s1", "Intro", 2), ("s2", "Body", 2), ("s3", "Conclusion", 2))
    drafts = [make_draft("s1", "See section 2 for details.")]
    issues = check_cross_references(drafts, blueprint)
    assert issues == []


def test_cross_reference_no_refs_no_issues():
    """No cross-references → no issues."""
    blueprint = make_blueprint(("s1", "Intro", 2))
    drafts = [make_draft("s1", "Just some content without any references.")]
    issues = check_cross_references(drafts, blueprint)
    assert issues == []


# ── empty sections ────────────────────────────────────────────────────────────

def test_empty_section_detected():
    drafts = [make_draft("s1", "", word_count=0)]
    issues = check_empty_sections(drafts)
    assert len(issues) == 1
    assert issues[0].category == "empty_section"
    assert issues[0].section_id == "s1"


def test_short_section_detected():
    drafts = [make_draft("s1", "Too short.", word_count=2)]
    issues = check_empty_sections(drafts)
    assert len(issues) == 1
    assert issues[0].category == "empty_section"


def test_sufficient_content_no_empty_issue():
    content = "A" * 60  # 60 chars >= 50 threshold
    drafts = [make_draft("s1", content, word_count=10)]
    issues = check_empty_sections(drafts)
    assert issues == []


# ── run_consistency_checks (combined) ────────────────────────────────────────

def test_run_consistency_checks_combines_all():
    """All checkers are invoked and results combined."""
    blueprint = make_blueprint(("s1", "Intro", 2), ("s2", "Body", 2))
    drafts = [
        make_draft("s1", "# Bad H1\n\n" + "x" * 60),  # heading issue
        make_draft("s2", "short", word_count=1),         # empty section issue
    ]
    issues = run_consistency_checks(drafts, blueprint)
    categories = {i.category for i in issues}
    assert "heading_level" in categories
    assert "empty_section" in categories


def test_run_consistency_checks_no_issues_clean_doc():
    blueprint = make_blueprint(("s1", "Intro", 2), ("s2", "Body", 2))
    content = "This is a well-written section with sufficient content for the checker." * 2
    drafts = [
        make_draft("s1", content),
        make_draft("s2", content),
    ]
    issues = run_consistency_checks(drafts, blueprint)
    assert issues == []
