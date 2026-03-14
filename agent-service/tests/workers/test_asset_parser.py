"""Tests for AssetParser Worker — document parsing and image processing."""
from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

from app.models.asset_map import AssetItem, AssetMap
from app.workers.asset_parser import (
    _extract_code_blocks,
    _extract_headings,
    _extract_tables,
    _generate_asset_id,
    _split_sections,
    classify_image,
    parse_document,
    process_images,
)


# ---------------------------------------------------------------------------
# _extract_headings
# ---------------------------------------------------------------------------

class TestExtractHeadings:
    def test_empty_text(self):
        assert _extract_headings("") == []

    def test_single_h1(self):
        result = _extract_headings("# Title")
        assert result == [{"level": 1, "text": "Title"}]

    def test_multiple_levels(self):
        text = "# H1\n## H2\n### H3"
        result = _extract_headings(text)
        assert len(result) == 3
        assert result[0] == {"level": 1, "text": "H1"}
        assert result[1] == {"level": 2, "text": "H2"}
        assert result[2] == {"level": 3, "text": "H3"}

    def test_ignores_bold_not_headings(self):
        result = _extract_headings("**bold** text\n# Real Heading")
        assert len(result) == 1
        assert result[0]["text"] == "Real Heading"

    def test_no_headings(self):
        result = _extract_headings("Just plain text here.")
        assert result == []


# ---------------------------------------------------------------------------
# _split_sections
# ---------------------------------------------------------------------------

class TestSplitSections:
    def test_no_headings(self):
        result = _split_sections("Plain text only.")
        assert len(result) == 1
        assert result[0]["content"] == "Plain text only."
        assert result[0]["heading"] == ""

    def test_heading_with_content(self):
        text = "# Intro\n\nSome intro text."
        result = _split_sections(text)
        assert len(result) == 1
        assert result[0]["heading"] == "Intro"
        assert "intro text" in result[0]["content"]

    def test_two_sections(self):
        text = "# First\n\nFirst content.\n\n# Second\n\nSecond content."
        result = _split_sections(text)
        assert len(result) == 2
        assert result[0]["heading"] == "First"
        assert result[1]["heading"] == "Second"

    def test_content_before_first_heading(self):
        text = "Preamble.\n\n# Heading\n\nBody."
        result = _split_sections(text)
        # The preamble is the first section with empty heading
        assert result[0]["heading"] == ""
        assert "Preamble" in result[0]["content"]


# ---------------------------------------------------------------------------
# _extract_tables
# ---------------------------------------------------------------------------

class TestExtractTables:
    def test_no_table(self):
        assert _extract_tables("No table here.") == []

    def test_simple_table(self):
        text = "| A | B |\n|---|---|\n| 1 | 2 |"
        result = _extract_tables(text)
        assert len(result) == 1
        assert "| A | B |" in result[0]

    def test_single_row_not_a_table(self):
        # A single pipe-prefixed line is not a table (needs ≥2 rows)
        result = _extract_tables("| A | B |")
        assert result == []

    def test_table_followed_by_text(self):
        text = "Some text.\n\n| Col1 | Col2 |\n|------|------|\n| a    | b    |\n\nMore text."
        result = _extract_tables(text)
        assert len(result) == 1

    def test_multiple_tables(self):
        text = (
            "| A |\n|---|\n| 1 |\n\n"
            "Separator text.\n\n"
            "| B |\n|---|\n| 2 |"
        )
        result = _extract_tables(text)
        assert len(result) == 2


# ---------------------------------------------------------------------------
# _extract_code_blocks
# ---------------------------------------------------------------------------

class TestExtractCodeBlocks:
    def test_no_code_blocks(self):
        code, mermaid = _extract_code_blocks("Plain text.")
        assert code == []
        assert mermaid == []

    def test_python_code_block(self):
        text = "```python\nprint('hello')\n```"
        code, mermaid = _extract_code_blocks(text)
        assert len(code) == 1
        assert "print('hello')" in code[0]
        assert mermaid == []

    def test_mermaid_block(self):
        text = "```mermaid\ngraph TD; A-->B\n```"
        code, mermaid = _extract_code_blocks(text)
        assert code == []
        assert len(mermaid) == 1
        assert "graph TD" in mermaid[0]

    def test_mixed_blocks(self):
        text = (
            "```python\ncode here\n```\n\n"
            "```mermaid\ngraph LR; X-->Y\n```\n\n"
            "```\nplain code\n```"
        )
        code, mermaid = _extract_code_blocks(text)
        assert len(code) == 2
        assert len(mermaid) == 1


# ---------------------------------------------------------------------------
# _generate_asset_id
# ---------------------------------------------------------------------------

class TestGenerateAssetId:
    def test_generates_string(self):
        assert isinstance(_generate_asset_id("content"), str)

    def test_has_prefix(self):
        result = _generate_asset_id("content", "table")
        assert result.startswith("table-")

    def test_stable_for_same_input(self):
        id1 = _generate_asset_id("same content")
        id2 = _generate_asset_id("same content")
        assert id1 == id2

    def test_different_content_gives_different_ids(self):
        id1 = _generate_asset_id("content A")
        id2 = _generate_asset_id("content B")
        assert id1 != id2


# ---------------------------------------------------------------------------
# parse_document
# ---------------------------------------------------------------------------

SAMPLE_MARKDOWN = """\
[Document: test.md]

# Introduction

This is the introduction section with some text.

## Details

Here are some details.

| Col A | Col B |
|-------|-------|
| val1  | val2  |

```python
def hello():
    print("world")
```

```mermaid
graph TD; A-->B
```
"""


class TestParseDocument:
    def _make_docling_response(self, text: str, images: list | None = None):
        return json.dumps({
            "text": text,
            "images": images or [],
            "image_count": len(images or []),
        })

    def test_returns_asset_map(self):
        with patch(
            "app.workers.asset_parser._docling_parser_invoke",
            return_value=self._make_docling_response(SAMPLE_MARKDOWN),
        ):
            result = parse_document("abc", "test.md", "text/markdown")
        assert isinstance(result, AssetMap)

    def test_extracts_headings(self):
        with patch(
            "app.workers.asset_parser._docling_parser_invoke",
            return_value=self._make_docling_response(SAMPLE_MARKDOWN),
        ):
            result = parse_document("abc", "test.md", "text/markdown")
        heading_items = result.items_by_type("heading_structure")
        assert len(heading_items) == 1
        content = json.loads(heading_items[0].content)
        texts = [h["text"] for h in content]
        assert "Introduction" in texts
        assert "Details" in texts

    def test_extracts_text_sections(self):
        with patch(
            "app.workers.asset_parser._docling_parser_invoke",
            return_value=self._make_docling_response(SAMPLE_MARKDOWN),
        ):
            result = parse_document("abc", "test.md", "text/markdown")
        text_items = result.items_by_type("text")
        assert len(text_items) >= 2
        # Check word counts in summaries
        for item in text_items:
            assert "words" in item.summary

    def test_extracts_table(self):
        with patch(
            "app.workers.asset_parser._docling_parser_invoke",
            return_value=self._make_docling_response(SAMPLE_MARKDOWN),
        ):
            result = parse_document("abc", "test.md", "text/markdown")
        table_items = result.items_by_type("table")
        assert len(table_items) == 1
        assert "Col A" in table_items[0].content

    def test_extracts_code_block(self):
        with patch(
            "app.workers.asset_parser._docling_parser_invoke",
            return_value=self._make_docling_response(SAMPLE_MARKDOWN),
        ):
            result = parse_document("abc", "test.md", "text/markdown")
        code_items = result.items_by_type("code")
        assert len(code_items) == 1
        assert "print" in code_items[0].content

    def test_extracts_mermaid_block(self):
        with patch(
            "app.workers.asset_parser._docling_parser_invoke",
            return_value=self._make_docling_response(SAMPLE_MARKDOWN),
        ):
            result = parse_document("abc", "test.md", "text/markdown")
        mermaid_items = result.items_by_type("mermaid")
        assert len(mermaid_items) == 1
        assert "graph TD" in mermaid_items[0].content

    def test_source_word_count_positive(self):
        with patch(
            "app.workers.asset_parser._docling_parser_invoke",
            return_value=self._make_docling_response(SAMPLE_MARKDOWN),
        ):
            result = parse_document("abc", "test.md", "text/markdown")
        assert result.source_word_count > 0

    def test_source_section_counts(self):
        with patch(
            "app.workers.asset_parser._docling_parser_invoke",
            return_value=self._make_docling_response(SAMPLE_MARKDOWN),
        ):
            result = parse_document("abc", "test.md", "text/markdown")
        assert isinstance(result.source_section_counts, dict)
        assert len(result.source_section_counts) > 0

    def test_source_label_set(self):
        with patch(
            "app.workers.asset_parser._docling_parser_invoke",
            return_value=self._make_docling_response(SAMPLE_MARKDOWN),
        ):
            result = parse_document("abc", "test.md", "text/markdown")
        for item in result.items:
            assert item.source == "test.md"

    def test_empty_document(self):
        with patch(
            "app.workers.asset_parser._docling_parser_invoke",
            return_value=self._make_docling_response(""),
        ):
            result = parse_document("abc", "empty.md", "text/markdown")
        assert isinstance(result, AssetMap)
        assert result.source_word_count == 0


# ---------------------------------------------------------------------------
# classify_image
# ---------------------------------------------------------------------------

class TestClassifyImage:
    def test_screenshot(self):
        assert classify_image("This is a screenshot of the login page") == "screenshot"

    def test_diagram(self):
        assert classify_image("An architecture diagram showing components") == "diagram"

    def test_chart(self):
        assert classify_image("A bar chart showing monthly revenue") == "chart"

    def test_photo(self):
        assert classify_image("A photograph of a mountain landscape") == "photo"

    def test_illustration(self):
        assert classify_image("A cartoon illustration of a robot") == "illustration"

    def test_other(self):
        assert classify_image("Something unrecognizable") == "other"

    def test_case_insensitive(self):
        assert classify_image("SCREENSHOT of the UI") == "screenshot"


# ---------------------------------------------------------------------------
# process_images
# ---------------------------------------------------------------------------

class TestProcessImages:
    def _make_images(self, n: int = 1) -> list[dict]:
        return [
            {"index": i, "b64": f"base64data{i}", "desc": f"Image {i}"}
            for i in range(n)
        ]

    def test_empty_images_returns_empty_list(self):
        result = process_images([], "doc.pdf", "page-123")
        assert result == []

    def test_returns_asset_items(self):
        with (
            patch(
                "app.workers.asset_parser._docmost_upload_invoke",
                return_value="https://example.com/img/test.png",
            ),
            patch(
                "app.workers.asset_parser._vlm_understand_invoke",
                return_value="A diagram showing the workflow",
            ),
        ):
            result = process_images(self._make_images(2), "doc.pdf", "page-123")

        assert len(result) == 2
        for item in result:
            assert isinstance(item, AssetItem)
            assert item.type == "image"

    def test_content_is_url(self):
        with (
            patch(
                "app.workers.asset_parser._docmost_upload_invoke",
                return_value="https://example.com/img/test.png",
            ),
            patch(
                "app.workers.asset_parser._vlm_understand_invoke",
                return_value="A photograph of a cat",
            ),
        ):
            result = process_images(self._make_images(1), "doc.pdf", "page-123")

        assert result[0].content == "https://example.com/img/test.png"

    def test_vlm_failure_uses_docling_description(self):
        with (
            patch(
                "app.workers.asset_parser._docmost_upload_invoke",
                return_value="https://example.com/img/test.png",
            ),
            patch(
                "app.workers.asset_parser._vlm_understand_invoke",
                side_effect=RuntimeError("VLM unavailable"),
            ),
        ):
            images = [{"index": 0, "b64": "somedata", "desc": "Fallback description"}]
            result = process_images(images, "doc.pdf", "page-123")

        assert len(result) == 1
        assert "Fallback description" in result[0].summary

    def test_upload_failure_skips_image(self):
        with (
            patch(
                "app.workers.asset_parser._docmost_upload_invoke",
                side_effect=RuntimeError("Upload failed"),
            ),
            patch(
                "app.workers.asset_parser._vlm_understand_invoke",
                return_value="A diagram",
            ),
        ):
            result = process_images(self._make_images(3), "doc.pdf", "page-123")

        assert result == []

    def test_image_classification_in_summary(self):
        with (
            patch(
                "app.workers.asset_parser._docmost_upload_invoke",
                return_value="https://example.com/img/chart.png",
            ),
            patch(
                "app.workers.asset_parser._vlm_understand_invoke",
                return_value="A bar chart showing sales data",
            ),
        ):
            result = process_images(self._make_images(1), "doc.pdf", "page-123")

        assert "[chart]" in result[0].summary

    def test_skips_images_without_b64(self):
        images = [{"index": 0, "b64": "", "desc": "Empty image"}]
        result = process_images(images, "doc.pdf", "page-123")
        assert result == []
