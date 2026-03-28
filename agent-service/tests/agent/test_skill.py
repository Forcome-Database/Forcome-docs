"""测试 TipTap 创作 Skill 的覆盖度和关键规则存在性。"""
from app.agent.skill import TIPTAP_CREATION_SKILL


def test_skill_length():
    """Skill 必须足够详细（2000+ tokens ≈ 3000+ 字符）。"""
    assert len(TIPTAP_CREATION_SKILL) > 3000, (
        f"Skill too short: {len(TIPTAP_CREATION_SKILL)} chars, need > 3000"
    )


def test_skill_callout_syntax():
    """必须包含所有 4 种 callout 类型。"""
    assert ":::info" in TIPTAP_CREATION_SKILL
    assert ":::warning" in TIPTAP_CREATION_SKILL
    assert ":::success" in TIPTAP_CREATION_SKILL
    assert ":::danger" in TIPTAP_CREATION_SKILL


def test_skill_image_rules():
    """必须包含 MUST/NEVER 强制规则和图片语法。"""
    assert "MUST" in TIPTAP_CREATION_SKILL
    assert "NEVER" in TIPTAP_CREATION_SKILL
    assert "![" in TIPTAP_CREATION_SKILL


def test_skill_heading_rules():
    """必须说明标题层级规则。"""
    assert "# Title" in TIPTAP_CREATION_SKILL or "H1" in TIPTAP_CREATION_SKILL


def test_skill_forbidden_patterns():
    """必须列出禁止使用的中文套话。"""
    assert "综上所述" in TIPTAP_CREATION_SKILL
    assert "赋能" in TIPTAP_CREATION_SKILL


def test_skill_workflow_protocol():
    """必须包含工具调用工作流。"""
    assert "CALL TOOLS" in TIPTAP_CREATION_SKILL or "UNDERSTAND" in TIPTAP_CREATION_SKILL


def test_skill_table_section():
    """必须包含表格语法说明。"""
    assert "Table" in TIPTAP_CREATION_SKILL or "table" in TIPTAP_CREATION_SKILL


def test_skill_details_section():
    """必须包含折叠面板语法。"""
    assert "<details>" in TIPTAP_CREATION_SKILL


def test_skill_has_error_recovery():
    """必须包含错误恢复策略。"""
    assert "Error" in TIPTAP_CREATION_SKILL or "error" in TIPTAP_CREATION_SKILL
