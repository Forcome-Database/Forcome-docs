"""Tests for task complexity analyzer."""
from __future__ import annotations

import pytest

from app.orchestrator.tools.complexity import analyze_task_complexity, ComplexityResult


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _analyze(
    msg: str = "",
    files: list | None = None,
    intent: str = "document_create",
    template_id: str | None = None,
    selected_text: str | None = None,
) -> ComplexityResult:
    return analyze_task_complexity(
        user_message=msg,
        files=files or [],
        intent_route=intent,
        template_id=template_id,
        selected_text=selected_text,
    )


# ---------------------------------------------------------------------------
# Level 1 tests
# ---------------------------------------------------------------------------

class TestLevel1:
    def test_selection_edit_intent_always_level1(self):
        result = _analyze(msg="rewrite everything", intent="selection_edit")
        assert result["level"] == 1
        assert "selection_edit" in result["reasoning"]

    def test_selection_edit_with_files_still_level1(self):
        """selection_edit intent takes priority over file count."""
        result = _analyze(
            msg="fix this",
            files=[{"name": "a.pdf"}, {"name": "b.pdf"}],
            intent="selection_edit",
        )
        assert result["level"] == 1

    def test_translate_keyword(self):
        result = _analyze(msg="translate this paragraph to French")
        assert result["level"] == 1

    def test_fix_spelling_keyword(self):
        result = _analyze(msg="fix spelling in this text")
        assert result["level"] == 1

    def test_fix_grammar_keyword(self):
        result = _analyze(msg="fix grammar and punctuation")
        assert result["level"] == 1

    def test_change_tone_keyword(self):
        result = _analyze(msg="change tone to be more formal")
        assert result["level"] == 1

    def test_proofread_keyword(self):
        result = _analyze(msg="proofread this document")
        assert result["level"] == 1

    def test_shorten_keyword(self):
        result = _analyze(msg="make this shorter please")
        assert result["level"] == 1

    def test_simplify_keyword(self):
        result = _analyze(msg="simplify this explanation")
        assert result["level"] == 1

    def test_chinese_translate_keyword(self):
        result = _analyze(msg="帮我翻译这段文字成英文")
        assert result["level"] == 1

    def test_chinese_correct_keyword(self):
        result = _analyze(msg="帮我纠错这篇文章")
        assert result["level"] == 1

    def test_chinese_polish_keyword(self):
        result = _analyze(msg="请帮我润色一下")
        assert result["level"] == 1

    def test_l1_keyword_with_l3_keyword_not_level1(self):
        """If both L1 and L3 keywords present, L3 wins over L1."""
        result = _analyze(msg="translate and rewrite this document")
        # L3 keyword 'rewrite' overrides L1 keyword 'translate'
        assert result["level"] != 1

    def test_l1_keyword_with_file_not_level1(self):
        """L1 keyword with file should not be Level 1 (file presence overrides)."""
        result = _analyze(msg="translate this", files=[{"name": "doc.pdf"}])
        # Has 1 file → Rule 6 (Level 2) or Rule 5 (Level 3)
        assert result["level"] != 1


# ---------------------------------------------------------------------------
# Level 2 tests
# ---------------------------------------------------------------------------

class TestLevel2:
    def test_format_keyword(self):
        result = _analyze(msg="please format this document properly")
        assert result["level"] == 2

    def test_continue_keyword(self):
        result = _analyze(msg="continue writing this article")
        assert result["level"] == 2

    def test_expand_keyword(self):
        result = _analyze(msg="expand on this idea")
        assert result["level"] == 2

    def test_restructure_keyword(self):
        result = _analyze(msg="restructure this content")
        assert result["level"] == 2

    def test_single_file_no_l3_keywords(self):
        result = _analyze(
            msg="help me with this",
            files=[{"name": "notes.pdf"}],
        )
        assert result["level"] == 2

    def test_single_file_with_l2_keyword(self):
        result = _analyze(
            msg="expand on this uploaded document",
            files=[{"name": "doc.docx"}],
        )
        # Single file rule triggers before L2 keyword, but both lead to Level 2
        assert result["level"] == 2

    def test_chinese_continue_keyword(self):
        result = _analyze(msg="帮我续写这篇文章")
        assert result["level"] == 2

    def test_chinese_expand_keyword(self):
        result = _analyze(msg="扩展一下这个内容")
        assert result["level"] == 2


# ---------------------------------------------------------------------------
# Level 3 tests
# ---------------------------------------------------------------------------

class TestLevel3:
    def test_create_keyword(self):
        result = _analyze(msg="create a business proposal")
        assert result["level"] == 3

    def test_write_keyword(self):
        result = _analyze(msg="write a blog post about AI")
        assert result["level"] == 3

    def test_rewrite_keyword(self):
        result = _analyze(msg="rewrite this article from scratch")
        assert result["level"] == 3

    def test_compose_keyword(self):
        result = _analyze(msg="compose an email to the client")
        assert result["level"] == 3

    def test_design_keyword(self):
        result = _analyze(msg="design a project plan")
        assert result["level"] == 3

    def test_generate_keyword(self):
        result = _analyze(msg="generate a product description")
        assert result["level"] == 3

    def test_draft_keyword(self):
        result = _analyze(msg="draft a cover letter")
        assert result["level"] == 3

    def test_multiple_files_always_level3(self):
        result = _analyze(
            msg="help me",
            files=[{"name": "a.pdf"}, {"name": "b.pdf"}],
        )
        assert result["level"] == 3

    def test_multiple_files_three(self):
        result = _analyze(
            msg="summarize",
            files=[{"name": "a.pdf"}, {"name": "b.pdf"}, {"name": "c.pdf"}],
        )
        assert result["level"] == 3
        assert "3" in result["reasoning"]

    def test_template_with_document_create_intent(self):
        result = _analyze(
            msg="help me write something",
            template_id="tpl-123",
            intent="document_create",
        )
        assert result["level"] == 3
        assert "template" in result["reasoning"]

    def test_template_with_other_intent_not_forced_level3(self):
        """Template without document_create intent doesn't trigger Rule 4."""
        result = _analyze(
            msg="format this",
            template_id="tpl-123",
            intent="document_transform",
        )
        # Falls through to L2 keyword rule
        assert result["level"] == 2

    def test_chinese_write_keyword(self):
        result = _analyze(msg="帮我写一篇市场分析报告")
        assert result["level"] == 3

    def test_chinese_create_keyword(self):
        result = _analyze(msg="创作一首诗歌")
        assert result["level"] == 3

    def test_chinese_generate_keyword(self):
        result = _analyze(msg="生成一份产品介绍")
        assert result["level"] == 3

    def test_default_no_keywords_no_files(self):
        result = _analyze(msg="something vague without keywords")
        assert result["level"] == 3
        assert "default" in result["reasoning"]

    def test_empty_message_defaults_level3(self):
        result = _analyze(msg="")
        assert result["level"] == 3


# ---------------------------------------------------------------------------
# Return type validation
# ---------------------------------------------------------------------------

class TestReturnType:
    def test_returns_typed_dict_with_level_and_reasoning(self):
        result = _analyze(msg="translate this")
        assert "level" in result
        assert "reasoning" in result
        assert isinstance(result["level"], int)
        assert isinstance(result["reasoning"], str)

    def test_level_is_always_1_2_or_3(self):
        messages = [
            "translate this",
            "format this",
            "write a blog post",
            "something random",
        ]
        for msg in messages:
            result = _analyze(msg=msg)
            assert result["level"] in (1, 2, 3), f"Unexpected level for: {msg}"
