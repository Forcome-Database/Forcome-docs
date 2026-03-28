"""Tests for EDITING_SKILL — concise editing-focused skill."""
from app.agent.skills.editing import EDITING_SKILL
from app.agent.skills.shared import TIPTAP_FORMAT_RULES


def test_editing_skill_is_string():
    """EDITING_SKILL must be a non-empty string."""
    assert isinstance(EDITING_SKILL, str)
    assert len(EDITING_SKILL) > 500, (
        f"EDITING_SKILL too short: {len(EDITING_SKILL)} chars"
    )


def test_editing_skill_core_is_concise():
    """EDITING_SKILL total length should be reasonable (core < 4000 chars before shared rules)."""
    # The core editing section (before appended shared rules) should be concise
    # We'll check the total is not excessively long
    shared_len = len(TIPTAP_FORMAT_RULES)
    # The core part = total - shared rules length (approximately)
    # Give some tolerance for separator text
    core_approx = len(EDITING_SKILL) - shared_len
    assert core_approx < 4000, (
        f"Editing skill core is ~{core_approx} chars, should be < 4000 chars (concise)"
    )


def test_editing_skill_has_current_document_marker():
    """Must reference [CURRENT DOCUMENT] marker for reading the current doc."""
    assert "[CURRENT DOCUMENT]" in EDITING_SKILL


def test_editing_skill_has_change_request_types():
    """Must mention common change request types."""
    text = EDITING_SKILL.lower()
    # Should mention at least some editing operations
    editing_terms = ["add", "remove", "rewrite", "restructure"]
    found = [t for t in editing_terms if t in text]
    assert len(found) >= 2, (
        f"Editing skill should mention editing operations like add/remove/rewrite/restructure; "
        f"found: {found}"
    )


def test_editing_skill_output_complete_document():
    """Must instruct to output the COMPLETE updated document."""
    text = EDITING_SKILL
    assert "COMPLETE" in text or "complete" in text.lower()
    assert "updated" in text.lower() or "full" in text.lower()


def test_editing_skill_no_code_block_wrapping():
    """Must explicitly warn against wrapping output in code blocks."""
    text = EDITING_SKILL
    assert "code block" in text.lower() or "```" in text


def test_editing_skill_no_conversational_framing():
    """Must warn against non-document content in output."""
    text = EDITING_SKILL.lower()
    assert "corrupt" in text or "conversational" in text or "framing" in text


def test_editing_skill_preserve_unchanged():
    """Must instruct to preserve all unchanged sections exactly."""
    text = EDITING_SKILL.lower()
    assert "preserve" in text or "unchanged" in text or "exactly" in text


def test_editing_skill_minimal_tool_calls():
    """Must note that most editing tasks need zero tool calls."""
    text = EDITING_SKILL.lower()
    assert "zero" in text or "no tool" in text or "most editing" in text or "minimal" in text


def test_editing_skill_includes_shared_format_rules():
    """EDITING_SKILL must include TIPTAP_FORMAT_RULES content."""
    assert ":::info" in EDITING_SKILL
    assert ":::warning" in EDITING_SKILL
    assert "MANDATORY" in EDITING_SKILL
    assert "FORBIDDEN" in EDITING_SKILL
    assert "综上所述" in EDITING_SKILL
    assert "赋能" in EDITING_SKILL
    assert "<details>" in EDITING_SKILL


def test_editing_skill_has_callout_syntax():
    """Must include all 4 callout types (via shared rules)."""
    assert ":::info" in EDITING_SKILL
    assert ":::warning" in EDITING_SKILL
    assert ":::success" in EDITING_SKILL
    assert ":::danger" in EDITING_SKILL


def test_editing_skill_has_heading_rules():
    """Must include heading level rules (via shared rules)."""
    assert "# Title" in EDITING_SKILL or "H1" in EDITING_SKILL


def test_editing_skill_has_forbidden_patterns():
    """Must include forbidden Chinese cliches (via shared rules)."""
    assert "综上所述" in EDITING_SKILL
    assert "赋能" in EDITING_SKILL


def test_editing_skill_tiptap_output_format():
    """Must specify TipTap Markdown as output format."""
    text = EDITING_SKILL
    assert "TipTap" in text or "tiptap" in text.lower() or "Markdown" in text


def test_editing_skill_no_thinking_framework_steps():
    """Editing skill should NOT have the 6-step creation thinking framework."""
    creation_steps = ["COLLECT with Purpose", "ANALYZE Deeply", "PLAN the Output Structure"]
    found = [s for s in creation_steps if s in EDITING_SKILL]
    assert len(found) == 0, (
        f"Editing skill should not include creation-specific steps: {found}"
    )


def test_editing_skill_has_document_markers():
    """Editing skill must instruct agent to use <document> tags."""
    assert "<document>" in EDITING_SKILL
    assert "</document>" in EDITING_SKILL


def test_editing_skill_has_corruption_warning():
    """Editing skill must frame non-doc content as data corruption."""
    assert "corrupt" in EDITING_SKILL.lower()
