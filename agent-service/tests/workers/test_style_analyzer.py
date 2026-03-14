"""Tests for workspace style analyzer."""
from __future__ import annotations

import pytest

from app.workers.style_analyzer import (
    analyze_paragraph_lengths,
    analyze_heading_style,
    analyze_formality,
    extract_common_terms,
    generate_style_guide,
)


class TestAnalyzeParagraphLengths:
    def test_empty_text_returns_zeros(self):
        result = analyze_paragraph_lengths("")
        assert result["avg"] == 0
        assert result["short"] == 0
        assert result["long"] == 0

    def test_single_short_paragraph(self):
        text = "This is a short paragraph."
        result = analyze_paragraph_lengths(text)
        assert result["avg"] > 0
        assert result["total"] == 1
        assert result["short"] == 1
        assert result["long"] == 0

    def test_multiple_paragraphs_avg(self):
        text = "Short para.\n\n" + ("word " * 50) + "\n\n" + ("word " * 150)
        result = analyze_paragraph_lengths(text)
        assert result["total"] == 3
        assert result["long"] >= 1

    def test_counts_short_under_30_words(self):
        text = "A few words here.\n\nAnother small chunk.\n\nThird tiny para."
        result = analyze_paragraph_lengths(text)
        assert result["short"] == 3

    def test_counts_long_over_100_words(self):
        long_para = "word " * 110
        text = f"Short.\n\n{long_para}\n\n{long_para}"
        result = analyze_paragraph_lengths(text)
        assert result["long"] == 2


class TestAnalyzeHeadingStyle:
    def test_no_headings_returns_unknown(self):
        result = analyze_heading_style("Just plain text, no headings.")
        assert result == "unknown"

    def test_question_headings_detected(self):
        text = "## What is AI?\n\n## How does it work?\n\n## Why does it matter?"
        result = analyze_heading_style(text)
        assert result == "question-based"

    def test_howto_headings_detected(self):
        text = "## How to install Python\n\n## How to write tests\n\n## How to deploy"
        result = analyze_heading_style(text)
        assert result == "how-to"

    def test_noun_phrase_headings_default(self):
        text = "## Introduction\n\n## Architecture Overview\n\n## Implementation Details\n\n## Conclusion"
        result = analyze_heading_style(text)
        assert result == "noun-phrase"

    def test_chinese_howto_detected(self):
        text = "## 如何安装\n\n## 如何配置\n\n## 如何部署\n\n## Overview"
        result = analyze_heading_style(text)
        assert result == "how-to"


class TestAnalyzeFormality:
    def test_formal_text(self):
        text = "Therefore, the analysis indicates significant findings. Furthermore, the data demonstrates. Consequently, we conclude."
        result = analyze_formality(text)
        assert result == "formal"

    def test_casual_text(self):
        text = "哈哈 this is fun btw lol ok 嗯 吧 啊 呢 great stuff"
        result = analyze_formality(text)
        assert result == "casual"

    def test_neutral_text(self):
        text = "This document describes the system architecture. The components are well designed."
        result = analyze_formality(text)
        assert result == "neutral"

    def test_empty_text_is_neutral(self):
        result = analyze_formality("")
        assert result == "neutral"


class TestExtractCommonTerms:
    def test_no_quoted_terms_returns_empty(self):
        result = extract_common_terms("Plain text without any quoted terms here.")
        assert result == []

    def test_frequently_quoted_term_included(self):
        # A term appearing 3+ times
        text = '"machine learning" is great. We use "machine learning" daily. "machine learning" is the future.'
        result = extract_common_terms(text, min_count=3)
        assert "machine learning" in result

    def test_rare_terms_excluded(self):
        # Only appears once
        text = '"unique term" appears once. Other content here.'
        result = extract_common_terms(text, min_count=3)
        assert "unique term" not in result

    def test_returns_at_most_10_terms(self):
        # Generate 15 terms each appearing 3 times
        terms = [f"term{i}" for i in range(15)]
        text = " ".join(f'"{t}" "{t}" "{t}"' for t in terms)
        result = extract_common_terms(text, min_count=3)
        assert len(result) <= 10

    def test_chinese_quoted_terms(self):
        text = '「机器学习」技术很重要。使用「机器学习」可以解决问题。「机器学习」的应用很广。'
        result = extract_common_terms(text, min_count=3)
        assert "机器学习" in result


class TestGenerateStyleGuide:
    def test_empty_texts_returns_empty_string(self):
        result = generate_style_guide([])
        assert result == ""

    def test_returns_style_guide_string(self):
        texts = [
            "## Introduction\n\nThis is a formal document. Therefore, we present findings. Furthermore, the analysis shows clear patterns.\n\n## Methodology\n\nConsequently, the results are significant.",
            "## Results\n\nThe data shows improvement. Furthermore, the metrics confirm our hypothesis.",
        ]
        result = generate_style_guide(texts)
        assert "Writing style guide" in result
        assert "Average paragraph" in result
        assert "Heading style" in result
        assert "Formality" in result

    def test_includes_common_terms_when_present(self):
        repeated = '"neural network" ' * 4
        texts = [f"## AI\n\n{repeated}\n\n## ML\n\n{repeated}"]
        result = generate_style_guide(texts)
        # Common terms line should appear if terms found
        if "neural network" in result:
            assert "Common terms" in result

    def test_single_text_works(self):
        texts = ["## Title\n\nSome content here.\n\n## Section\n\nMore content."]
        result = generate_style_guide(texts)
        assert len(result) > 0
        assert "Writing style guide" in result
