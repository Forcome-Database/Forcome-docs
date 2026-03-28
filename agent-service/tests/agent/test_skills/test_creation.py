"""Tests for CREATION_SKILL — creation skill composed from framework + shared rules."""
from app.agent.skills.creation import CREATION_SKILL
from app.agent.skills.shared import TIPTAP_FORMAT_RULES


def test_creation_skill_is_string():
    """CREATION_SKILL must be a non-empty string."""
    assert isinstance(CREATION_SKILL, str)
    assert len(CREATION_SKILL) > 3000, (
        f"CREATION_SKILL too short: {len(CREATION_SKILL)} chars, need > 3000"
    )


def test_creation_skill_has_thinking_framework():
    """Must contain the 6-step thinking framework."""
    assert "Thinking Framework" in CREATION_SKILL
    assert "UNDERSTAND" in CREATION_SKILL
    assert "COLLECT" in CREATION_SKILL
    assert "ANALYZE" in CREATION_SKILL
    assert "PLAN" in CREATION_SKILL
    assert "GENERATE" in CREATION_SKILL
    assert "VERIFY" in CREATION_SKILL


def test_creation_skill_thinking_framework_in_top_15_percent():
    """Thinking framework header must appear in top 15% of the skill (primacy bias)."""
    idx = CREATION_SKILL.find("Thinking Framework")
    total = len(CREATION_SKILL)
    assert idx != -1, "Thinking Framework not found"
    pct = idx / total
    assert pct < 0.15, (
        f"Thinking Framework starts at {pct:.1%} of skill, should be < 15% (primacy bias)"
    )


def test_creation_skill_has_few_shot_example():
    """Must contain at least one few-shot output example."""
    assert "### Example" in CREATION_SKILL or "### 示例" in CREATION_SKILL


def test_creation_skill_has_analysis_dimensions():
    """Must include the four explicit analysis dimensions."""
    text = CREATION_SKILL.lower()
    assert "content structure" in text
    assert "information density" in text
    assert "audience" in text
    assert "image-text" in text


def test_creation_skill_has_tool_usage_strategy():
    """Must include tool usage strategy section."""
    assert "Tool Usage Strategy" in CREATION_SKILL or "tool usage" in CREATION_SKILL.lower()
    assert "URL Tasks" in CREATION_SKILL or "scrape_url" in CREATION_SKILL
    assert "Research Tasks" in CREATION_SKILL or "search_web" in CREATION_SKILL


def test_creation_skill_has_error_recovery():
    """Must include error recovery strategy."""
    assert "Error Recovery" in CREATION_SKILL or "error" in CREATION_SKILL.lower()
    assert "ONE ATTEMPT" in CREATION_SKILL or "alternative" in CREATION_SKILL.lower()


def test_creation_skill_has_output_depth_calibration():
    """Must include output depth calibration based on source length."""
    text = CREATION_SKILL
    assert "Depth Calibration" in text or "depth" in text.lower()
    assert "source" in text.lower()


def test_creation_skill_includes_shared_format_rules():
    """CREATION_SKILL must include TIPTAP_FORMAT_RULES content."""
    # Check that key sections from shared rules appear in creation skill
    assert ":::info" in CREATION_SKILL
    assert ":::warning" in CREATION_SKILL
    assert "MANDATORY" in CREATION_SKILL
    assert "FORBIDDEN" in CREATION_SKILL
    assert "综上所述" in CREATION_SKILL
    assert "赋能" in CREATION_SKILL
    assert "<details>" in CREATION_SKILL


def test_creation_skill_has_callout_syntax():
    """Must include all 4 callout types (via shared rules)."""
    assert ":::info" in CREATION_SKILL
    assert ":::warning" in CREATION_SKILL
    assert ":::success" in CREATION_SKILL
    assert ":::danger" in CREATION_SKILL


def test_creation_skill_heading_rules_present():
    """Must contain heading level rules."""
    assert "# Title" in CREATION_SKILL or "H1" in CREATION_SKILL


def test_creation_skill_format_section_after_thinking():
    """Format section must come AFTER thinking framework (structure check)."""
    thinking_idx = CREATION_SKILL.find("Thinking Framework")
    format_idx = CREATION_SKILL.find("Markdown Format") or CREATION_SKILL.find("## Markdown")
    # Format section should exist and be after thinking framework
    assert thinking_idx != -1, "Thinking Framework not found"
    # The format rules section (from shared) should follow the thinking section
    callout_idx = CREATION_SKILL.find(":::info")
    assert callout_idx > thinking_idx, (
        "Callout syntax (format rules) should appear after thinking framework"
    )


def test_creation_skill_no_universal_compression():
    """Must NOT contain universal compression anti-patterns."""
    forbidden = [
        "NEVER pad content with filler",
        "better to be concise than verbose",
    ]
    for phrase in forbidden:
        assert phrase not in CREATION_SKILL, f"Found compression anti-pattern: '{phrase}'"


def test_creation_skill_task_aware_depth():
    """Depth guidance must be task-aware, not one-size-fits-all."""
    text = CREATION_SKILL.lower()
    assert "source" in text
    assert "depth" in text or "completeness" in text


def test_creation_skill_ends_with_format_rules():
    """TIPTAP_FORMAT_RULES content should appear near the end of CREATION_SKILL."""
    # The shared format rules are appended, so critical constraints should be near end
    constraints_idx = CREATION_SKILL.find("Critical Constraints")
    if constraints_idx == -1:
        constraints_idx = CREATION_SKILL.find("MUST FOLLOW")
    total = len(CREATION_SKILL)
    assert constraints_idx != -1, "Critical Constraints section not found"
    pct = constraints_idx / total
    assert pct > 0.55, (
        f"Critical Constraints at {pct:.1%}, should be in lower 45% of skill (recency bias)"
    )
