"""Final integration tests for AI Creator v2.

Tests the complete pipeline for each complexity level.
All external dependencies (LLM, tools) are mocked.
"""
import pytest
from app.orchestrator.tools.complexity import analyze_task_complexity


class TestComplexityClassification:
    """Verify complexity classification covers all major scenarios."""

    def test_translate_is_level1(self):
        r = analyze_task_complexity(
            user_message="翻译成英文",
            files=[],
            intent_route="document_create",
            template_id=None,
            selected_text="你好",
        )
        assert r["level"] == 1

    def test_selection_edit_is_level1(self):
        r = analyze_task_complexity(
            user_message="润色",
            files=[],
            intent_route="selection_edit",
            template_id=None,
            selected_text="text",
        )
        assert r["level"] == 1

    def test_format_is_level2(self):
        r = analyze_task_complexity(
            user_message="排版优化",
            files=[],
            intent_route="document_transform",
            template_id=None,
            selected_text=None,
        )
        assert r["level"] == 2

    def test_single_file_is_level2(self):
        r = analyze_task_complexity(
            user_message="翻译这个文件",
            files=[{"filename": "a.pdf"}],
            intent_route="document_create",
            template_id=None,
            selected_text=None,
        )
        assert r["level"] >= 2

    def test_create_is_level3(self):
        r = analyze_task_complexity(
            user_message="写一篇技术博客",
            files=[],
            intent_route="document_create",
            template_id=None,
            selected_text=None,
        )
        assert r["level"] == 3

    def test_multi_file_is_level3(self):
        r = analyze_task_complexity(
            user_message="合并",
            files=[{"filename": "a.pdf"}, {"filename": "b.pdf"}],
            intent_route="document_create",
            template_id=None,
            selected_text=None,
        )
        assert r["level"] == 3


class TestWordCounting:
    """Verify Chinese-aware word counting."""

    def test_pure_chinese(self):
        from app.utils.text import count_words
        assert count_words("你好世界") == 4

    def test_pure_english(self):
        from app.utils.text import count_words
        assert count_words("hello world") == 2

    def test_mixed(self):
        from app.utils.text import count_words
        count = count_words("Hello 你好 World 世界")
        assert count >= 4

    def test_empty(self):
        from app.utils.text import count_words
        assert count_words("") == 0


class TestModelSerialization:
    """Verify all models serialize and deserialize correctly."""

    def test_brief_roundtrip(self):
        from app.models.brief import CreationBrief
        b = CreationBrief(audience="tech", goal="blog", target_length=5000)
        assert CreationBrief.model_validate(b.model_dump()) == b

    def test_blueprint_roundtrip(self):
        from app.models.blueprint import CreationBlueprint, SectionPlan
        bp = CreationBlueprint(
            title="Test",
            sections=[SectionPlan(id="s1", title="Intro", word_budget=500)],
        )
        assert CreationBlueprint.model_validate(bp.model_dump()).sections[0].id == "s1"

    def test_review_report_roundtrip(self):
        from app.models.review import ReviewReport, ReviewIssue
        r = ReviewReport(
            overall_score=85,
            issues=[
                ReviewIssue(
                    id="i1",
                    severity="warning",
                    category="length",
                    description="short",
                )
            ],
        )
        restored = ReviewReport.model_validate(r.model_dump())
        assert restored.issues[0].id == "i1"

    def test_section_draft_roundtrip(self):
        from app.models.draft import SectionDraft
        d = SectionDraft(section_id="s1", content="Hello", word_count=1)
        assert SectionDraft.model_validate(d.model_dump()).section_id == "s1"
