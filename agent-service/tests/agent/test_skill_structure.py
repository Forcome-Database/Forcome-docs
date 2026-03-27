"""验证 Skill 提示词的结构满足 think-heavy 设计要求。"""
import pytest
import re
from app.agent.skill import TIPTAP_CREATION_SKILL


def test_skill_starts_with_thinking_framework():
    """思考框架必须在提示词的前 40% 位置。"""
    lines = TIPTAP_CREATION_SKILL.strip().split("\n")
    total = len(lines)
    format_start = None
    for i, line in enumerate(lines):
        if line.startswith("## ") and ("Format" in line or "格式" in line):
            format_start = i
            break
    assert format_start is not None, "Must have a format section"
    assert format_start / total >= 0.35, (
        f"Thinking framework ends at line {format_start}/{total} "
        f"({format_start/total:.0%}), should be >= 35%"
    )


def test_skill_has_analysis_dimensions():
    """必须包含显式的分析维度框架。"""
    text = TIPTAP_CREATION_SKILL
    required_dimensions = [
        "content structure",
        "information density",
        "audience",
        "image-text",
    ]
    for dim in required_dimensions:
        assert dim.lower() in text.lower(), f"Missing analysis dimension: {dim}"


def test_skill_has_few_shot_example():
    """必须包含至少一个 few-shot 输出示例。"""
    assert "### Example" in TIPTAP_CREATION_SKILL or "### 示例" in TIPTAP_CREATION_SKILL


def test_skill_no_universal_compression():
    """不能包含通用压缩指令。"""
    text = TIPTAP_CREATION_SKILL
    forbidden = [
        "NEVER pad content with filler",
        "better to be concise than verbose",
    ]
    for phrase in forbidden:
        assert phrase not in text, f"Found compression bias: '{phrase}'"


def test_skill_has_task_aware_length():
    """长度指导必须是任务感知的，而非一刀切。"""
    text = TIPTAP_CREATION_SKILL
    assert "source" in text.lower() and ("depth" in text.lower() or "completeness" in text.lower())


def test_critical_constraints_in_last_30_percent():
    """图片 URL 和禁止模式等关键约束应在后 30%（recency bias）。"""
    lines = TIPTAP_CREATION_SKILL.strip().split("\n")
    total = len(lines)
    for i, line in enumerate(lines):
        if "MUST appear" in line and "image" in line.lower():
            assert i / total >= 0.65, (
                f"Image URL constraint at line {i}/{total} ({i/total:.0%}), "
                f"should be in last 35% for recency bias"
            )
            break
    else:
        pytest.fail("Could not find 'MUST appear' + 'image' constraint line in skill")
