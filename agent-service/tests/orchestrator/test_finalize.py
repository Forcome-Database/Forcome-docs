"""Tests for finalize tool — merge_sections and compute_word_count."""
from __future__ import annotations

import pytest

from app.models.asset_map import AssetItem, AssetMap
from app.orchestrator.tools.finalize import (
    compute_word_count,
    merge_sections,
    resolve_final_image_placeholders,
)


# ---------------------------------------------------------------------------
# merge_sections
# ---------------------------------------------------------------------------

class TestMergeSections:
    def test_single_section(self):
        result = merge_sections(["Hello world"])
        assert result == "Hello world"

    def test_multiple_sections_joined_by_blank_line(self):
        result = merge_sections(["Section A", "Section B"])
        assert result == "Section A\n\nSection B"

    def test_three_sections(self):
        result = merge_sections(["One", "Two", "Three"])
        assert result == "One\n\nTwo\n\nThree"

    def test_empty_list(self):
        result = merge_sections([])
        assert result == ""

    def test_all_empty_strings(self):
        result = merge_sections(["", "", ""])
        assert result == ""

    def test_whitespace_only_sections_excluded(self):
        result = merge_sections(["Content", "   ", "\t\n", "More content"])
        assert result == "Content\n\nMore content"

    def test_plain_text_preserved(self):
        text = "This is plain text without any markdown."
        result = merge_sections([text])
        assert result == text

    def test_markdown_heading_preserved(self):
        sections = ["# Introduction\n\nSome content.", "## Details\n\nMore details."]
        result = merge_sections(sections)
        assert "# Introduction" in result
        assert "## Details" in result

    def test_sections_stripped(self):
        """Leading/trailing whitespace in each section is stripped."""
        result = merge_sections(["  Hello  ", "  World  "])
        assert result == "Hello\n\nWorld"

    def test_single_empty_section(self):
        result = merge_sections([""])
        assert result == ""

    def test_mixed_empty_and_content(self):
        result = merge_sections(["First", "", "Third"])
        assert result == "First\n\nThird"

    def test_returns_string(self):
        result = merge_sections(["text"])
        assert isinstance(result, str)

    def test_large_number_of_sections(self):
        sections = [f"Section {i}" for i in range(10)]
        result = merge_sections(sections)
        parts = result.split("\n\n")
        assert len(parts) == 10

    def test_dict_sections_strip_redundant_leading_heading_matching_section_title(self):
        sections = [
            {
                "title": "Address and Subscription",
                "level": 2,
                "content": "## Address and Subscription\n\nKeep the original instructions.",
            }
        ]
        result = merge_sections(sections)
        assert result == "## Address and Subscription\n\nKeep the original instructions."

    def test_promotes_first_structured_section_title_to_h1_when_root_title_missing(self):
        sections = [
            {
                "title": "",
                "level": 1,
                "content": "",
            },
            {
                "title": "采购退货业务标准操作程序 (SOP)",
                "level": 3,
                "content": "一、目标单据检索与定位\n\n根据发票号（IV）在系统中检索待处理记录。",
            },
            {
                "title": "附录",
                "level": 3,
                "content": "补充说明",
            },
        ]

        result = merge_sections(sections)

        assert result.startswith("# 采购退货业务标准操作程序 (SOP)\n\n一、目标单据检索与定位")
        assert "### 采购退货业务标准操作程序 (SOP)" not in result

    def test_does_not_promote_regular_first_section_title_when_content_is_plain_intro(self):
        sections = [
            {
                "title": "",
                "level": 1,
                "content": "",
            },
            {
                "title": "Overview",
                "level": 2,
                "content": "This section introduces the topic in plain prose.",
            },
        ]

        result = merge_sections(sections)

        assert result == "## Overview\n\nThis section introduces the topic in plain prose."

    def test_uses_explicit_root_title_as_h1_even_when_first_section_is_numbered(self):
        sections = [
            {
                "title": "Purchase Return SOP",
                "level": 1,
                "content": "",
            },
            {
                "title": "4. Submit Review",
                "level": 3,
                "content": "Look up the pending record before approval.",
            },
        ]

        result = merge_sections(sections)

        assert result.startswith("# Purchase Return SOP\n\n### 4. Submit Review")
        assert result.count("# Purchase Return SOP") == 1


class TestResolveFinalImagePlaceholders:
    def test_rewrites_asset_placeholder_to_exact_attachment_url(self):
        asset_map = AssetMap(
            items=[
                AssetItem(
                    id="img-1",
                    type="image",
                    content="/api/files/file-1/source.png",
                )
            ]
        )

        result = resolve_final_image_placeholders(
            "正文\n\n![原图](asset://img-1)",
            asset_map,
        )

        assert "![原图](/api/files/file-1/source.png)" in result
        assert "asset://img-1" not in result


# ---------------------------------------------------------------------------
# compute_word_count
# ---------------------------------------------------------------------------

class TestComputeWordCount:
    def test_empty_string(self):
        assert compute_word_count("") == 0

    def test_single_english_word(self):
        assert compute_word_count("Hello") == 1

    def test_multiple_english_words(self):
        assert compute_word_count("Hello world foo bar") == 4

    def test_chinese_characters(self):
        # Each Chinese character counts as one word
        assert compute_word_count("你好世界") == 4

    def test_mixed_english_and_chinese(self):
        count = compute_word_count("Hello 你好 world 世界")
        # "Hello" + "你" + "好" + "world" + "世" + "界" = 6
        assert count == 6

    def test_whitespace_only(self):
        assert compute_word_count("   \n\t  ") == 0

    def test_punctuation_not_counted(self):
        count = compute_word_count("Hello, world!")
        assert count == 2

    def test_multiline_text(self):
        text = "Line one.\nLine two.\nLine three."
        count = compute_word_count(text)
        assert count == 6

    def test_markdown_text(self):
        text = "# Introduction\n\nThis is a paragraph with five words."
        count = compute_word_count(text)
        # "Introduction" + "This" + "is" + "a" + "paragraph" + "with" + "five" + "words" = 8
        assert count == 8

    def test_delegates_to_count_words(self):
        """Verify compute_word_count and count_words give identical results."""
        from app.utils.text import count_words

        sample = "The quick brown fox jumps over the lazy dog"
        assert compute_word_count(sample) == count_words(sample)
