"""Tests for finalize tool — merge_sections and compute_word_count."""
from __future__ import annotations

import pytest

from app.orchestrator.tools.finalize import compute_word_count, merge_sections


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
