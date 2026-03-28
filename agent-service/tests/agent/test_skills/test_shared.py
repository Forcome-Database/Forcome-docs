"""Tests for shared TipTap format rules."""
from app.agent.skills.shared import TIPTAP_FORMAT_RULES


def test_format_rules_is_string():
    """TIPTAP_FORMAT_RULES must be a non-empty string."""
    assert isinstance(TIPTAP_FORMAT_RULES, str)
    assert len(TIPTAP_FORMAT_RULES) > 500, (
        f"TIPTAP_FORMAT_RULES too short: {len(TIPTAP_FORMAT_RULES)} chars"
    )


def test_format_rules_has_callouts():
    """Must include all 4 callout types."""
    assert ":::info" in TIPTAP_FORMAT_RULES
    assert ":::warning" in TIPTAP_FORMAT_RULES
    assert ":::success" in TIPTAP_FORMAT_RULES
    assert ":::danger" in TIPTAP_FORMAT_RULES


def test_format_rules_has_headings():
    """Must include heading level rules."""
    assert "# Title" in TIPTAP_FORMAT_RULES or "H1" in TIPTAP_FORMAT_RULES
    assert "NEVER skip" in TIPTAP_FORMAT_RULES or "skip levels" in TIPTAP_FORMAT_RULES


def test_format_rules_has_tables():
    """Must include table syntax."""
    assert "| Column" in TIPTAP_FORMAT_RULES or "| " in TIPTAP_FORMAT_RULES
    assert "table" in TIPTAP_FORMAT_RULES.lower()


def test_format_rules_has_code_blocks():
    """Must include code block syntax."""
    assert "```" in TIPTAP_FORMAT_RULES


def test_format_rules_has_images():
    """Must include image syntax."""
    assert "![" in TIPTAP_FORMAT_RULES


def test_format_rules_has_links():
    """Must include link syntax."""
    assert "[Descriptive" in TIPTAP_FORMAT_RULES or "link text" in TIPTAP_FORMAT_RULES


def test_format_rules_has_collapsible():
    """Must include collapsible/details syntax."""
    assert "<details>" in TIPTAP_FORMAT_RULES


def test_format_rules_has_content_quality():
    """Must include mandatory and forbidden content patterns."""
    assert "MANDATORY" in TIPTAP_FORMAT_RULES
    assert "FORBIDDEN" in TIPTAP_FORMAT_RULES


def test_format_rules_has_forbidden_chinese_patterns():
    """Must list forbidden Chinese cliches."""
    assert "综上所述" in TIPTAP_FORMAT_RULES
    assert "赋能" in TIPTAP_FORMAT_RULES


def test_format_rules_has_critical_constraints():
    """Must include critical constraints section."""
    assert "Critical Constraints" in TIPTAP_FORMAT_RULES or "MUST FOLLOW" in TIPTAP_FORMAT_RULES


def test_format_rules_has_image_url_constraint():
    """Must require image URLs in output."""
    assert "MUST" in TIPTAP_FORMAT_RULES
    assert "image" in TIPTAP_FORMAT_RULES.lower()


def test_format_rules_has_technical_terms_constraint():
    """Must include constraint about preserving technical terms."""
    assert "Technical" in TIPTAP_FORMAT_RULES or "technical" in TIPTAP_FORMAT_RULES
    assert "commands" in TIPTAP_FORMAT_RULES.lower() or "version" in TIPTAP_FORMAT_RULES.lower()
