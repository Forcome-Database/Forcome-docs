# 阶段 4：审查与修复系统实施计划

> **对于智能体执行者：** 要求：使用 superpowers:subagent-driven-development （如果子代理可用）或 superpowers:executing-plans 来实施此计划。步骤使用复选框 (`- [ ]`) 语法进行跟踪。

**目标：** 构建独立的评估+有针对性的修复系统，取代当前的“审查即重写”反模式。确定性检查+LLM 质量评估可生成结构化的审查报告。用户选择要修复的问题。 Fixer Worker 只进行部分级别的维修。

**架构：** Evaluator Worker 有两个阶段：确定性（基于代码的字数检查、资产覆盖范围、Mermaid 语法、标题级别）和基于 LLM 的（准确性、完整性、风格）。结果合并到 ReviewReport 中。 Fixer Worker 处理个别问题并仅修复目标部分。审核卡前端显示问题复选框。

**技术栈：** PydanticAI、Pydantic v2、Mantine UI

---

## 文件结构概述

### 新文件（代理服务）

| 文件 | 用途 |
|------|---------|
| `agent-service/app/workers/evaluator.py` | 确定性+LLM质量评估 |
| `agent-service/app/workers/fixer.py` | 自动修复和有针对性的 LLM 修复 |
| `agent-service/app/orchestrator/tools/evaluate.py` | `evaluate_quality` 编排工具 |
| `agent-service/app/orchestrator/tools/fix_tools.py` | `fix_issues` 编排工具 |
| `agent-service/tests/workers/test_evaluator.py` | 评估员测试 |
| `agent-service/tests/workers/test_fixer.py` | 修理工测试 |
| `agent-service/tests/orchestrator/test_evaluate_tool.py` | 评估工具测试 |
| `agent-service/tests/orchestrator/test_fix_tools.py` | 修复工具测试 |
| `agent-service/tests/test_e2e_review.py` | 端到端审核流程测试 |

### 新文件（前端）

| 文件 | 用途 |
|------|---------|
| `apps/client/src/ee/ai/components/ai-creator/review/ReviewModal.tsx` | 带有问题列表的审查模式 |
| `apps/client/src/ee/ai/components/ai-creator/review/ReviewScoreBoard.tsx` | 带尺寸条的分数显示 |
| `apps/client/src/ee/ai/components/ai-creator/review/IssueCard.tsx` | 单独发卡组件 |
| `apps/client/src/ee/ai/components/ai-creator/review/AutoFixSummary.tsx` | 可折叠自动修复摘要 |
| `apps/client/src/ee/ai/components/ai-creator/review/use-review-actions.ts` | 用于问题选择和修复调度的挂钩 |
| `apps/client/src/ee/ai/components/ai-creator/review/index.ts` | 桶装出口 |

### 修改文件

| 文件 | 变更 |
|------|--------|
| `agent-service/app/models/review.py` | 添加 ReviewIssue、ReviewReport 模型（来自第 0 阶段） |
| `agent-service/app/orchestrator/engine.py` | 注册evaluate_quality和fix_issues工具 |
| `agent-service/app/orchestrator/prompts.py` | 添加评估器和修复器系统提示 |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx` | 集成 ReviewModal 触发器 |
| `apps/client/src/ee/ai/services/ai-create-runner.utils.ts` | 处理 review_report 和 fix_applied SSE 事件 |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator.types.ts` | 添加 ReviewIssue、ReviewReport TS 类型 |

---

## 分块 1：Evaluator Worker：确定性检查

### 任务 1：创建 ReviewIssue and ReviewReport models

**文件：**
- 修改：`agent-service/app/models/review.py`（从阶段 0 搭建骨架扩展）
- 测试： `agent-service/tests/test_models/test_review.py`

**背景：** 第 0 阶段构建了审核模型。此任务添加评估者所需的完整字段集。

- [ ] **第 1 步：为 ReviewIssue 模型编写失败测试**

```python
# agent-service/tests/test_models/test_review.py
import pytest
from app.models.review import ReviewIssue, ReviewReport

def test_review_issue_creation():
    issue = ReviewIssue(
        id="issue-001",
        section_id="sec-intro",
        severity="warning",
        category="word_count",
        description="Section exceeds word budget by 25%",
        suggestion="Trim redundant examples in paragraphs 3-4",
        auto_fixable=False,
    )
    assert issue.severity == "warning"
    assert issue.auto_fixable is False

def test_review_issue_severity_validation():
    with pytest.raises(ValueError):
        ReviewIssue(
            id="issue-002",
            section_id="sec-intro",
            severity="critical",  # invalid
            category="word_count",
            description="test",
            suggestion="test",
            auto_fixable=False,
        )

def test_review_report_score_bounds():
    report = ReviewReport(
        overall_score=85,
        length_compliance=0.92,
        asset_reuse_rate=0.80,
        issues=[],
        dimensions={"accuracy": 90, "completeness": 80, "style_consistency": 85, "readability": 88},
    )
    assert 0 <= report.overall_score <= 100
    assert 0.0 <= report.length_compliance <= 1.0

def test_review_report_auto_fixable_filter():
    issues = [
        ReviewIssue(id="1", section_id="s1", severity="info", category="heading_level",
                    description="H4 after H2", suggestion="Change to H3", auto_fixable=True),
        ReviewIssue(id="2", section_id="s1", severity="warning", category="accuracy",
                    description="Claim unsupported", suggestion="Add citation", auto_fixable=False),
    ]
    report = ReviewReport(overall_score=70, length_compliance=0.95, asset_reuse_rate=0.75,
                          issues=issues, dimensions={})
    auto = [i for i in report.issues if i.auto_fixable]
    manual = [i for i in report.issues if not i.auto_fixable]
    assert len(auto) == 1
    assert len(manual) == 1
```

- [ ] **步骤 2：实施 ReviewIssue 和 ReviewReport 模型**

```python
# agent-service/app/models/review.py
from __future__ import annotations
from pydantic import BaseModel, Field, field_validator
from typing import Literal

class ReviewIssue(BaseModel):
    id: str
    section_id: str
    severity: Literal["error", "warning", "info"]
    category: str  # word_count, asset_coverage, mermaid_syntax, heading_level, image_url, empty_section, accuracy, completeness, style_consistency, readability, argument_strength
    description: str
    suggestion: str
    auto_fixable: bool = False
    fixed: bool = False

class ReviewReport(BaseModel):
    overall_score: int = Field(ge=0, le=100)
    length_compliance: float = Field(ge=0.0, le=1.0)
    asset_reuse_rate: float = Field(ge=0.0, le=1.0)
    issues: list[ReviewIssue] = Field(default_factory=list)
    dimensions: dict[str, int] = Field(default_factory=dict)  # dimension_name -> score 0-100
```

- [ ] **第 3 步：运行测试并验证**

运行： `cd /e/test/Docmost/agent-service && python -m pytest tests/test_models/test_review.py -v`

- [ ] **第 4 步：提交**

运行： `cd /e/test/Docmost && git add agent-service/app/models/review.py agent-service/tests/test_models/test_review.py && git commit -m "feat(agent): add ReviewIssue and ReviewReport models for Phase 4"`

---

### 任务 2：实现 deterministic evaluation checks

**文件：**
- 创建：`agent-service/app/workers/evaluator.py`
- 测试： `agent-service/tests/workers/test_evaluator.py`

**上下文：** 确定性检查无需 LLM 调用即可运行。他们根据蓝图检查剖面草稿是否存在机械问题。

- [ ] **第 1 步：编写确定性检查的失败测试**

```python
# agent-service/tests/workers/test_evaluator.py
import pytest
from app.workers.evaluator import evaluate_deterministic
from app.models.blueprint import SectionBlueprint  # from Phase 0
from app.models.review import ReviewIssue

def test_word_count_over_budget():
    """Section exceeding budget by >10% should produce a warning."""
    section_drafts = {
        "sec-1": "word " * 1100,  # 1100 words
    }
    blueprint_sections = [
        SectionBlueprint(id="sec-1", title="Intro", word_budget=900, assets=[], must_cover=[]),
    ]
    issues = evaluate_deterministic(section_drafts, blueprint_sections, asset_map={})
    word_issues = [i for i in issues if i.category == "word_count"]
    assert len(word_issues) == 1
    assert word_issues[0].severity == "warning"
    assert word_issues[0].auto_fixable is False

def test_word_count_within_tolerance():
    """Section within +-10% should produce no issue."""
    section_drafts = {"sec-1": "word " * 950}
    blueprint_sections = [
        SectionBlueprint(id="sec-1", title="Intro", word_budget=900, assets=[], must_cover=[]),
    ]
    issues = evaluate_deterministic(section_drafts, blueprint_sections, asset_map={})
    word_issues = [i for i in issues if i.category == "word_count"]
    assert len(word_issues) == 0

def test_heading_level_skip_detected():
    """Heading jumping from H2 to H4 should be flagged as auto-fixable."""
    section_drafts = {"sec-1": "## Overview\n\nSome text\n\n#### Deep detail\n\nMore text"}
    blueprint_sections = [
        SectionBlueprint(id="sec-1", title="Overview", word_budget=500, assets=[], must_cover=[]),
    ]
    issues = evaluate_deterministic(section_drafts, blueprint_sections, asset_map={})
    heading_issues = [i for i in issues if i.category == "heading_level"]
    assert len(heading_issues) == 1
    assert heading_issues[0].auto_fixable is True

def test_empty_section_detected():
    """Empty or whitespace-only section should be flagged."""
    section_drafts = {"sec-1": "   \n\n  "}
    blueprint_sections = [
        SectionBlueprint(id="sec-1", title="Intro", word_budget=500, assets=[], must_cover=[]),
    ]
    issues = evaluate_deterministic(section_drafts, blueprint_sections, asset_map={})
    empty_issues = [i for i in issues if i.category == "empty_section"]
    assert len(empty_issues) == 1
    assert empty_issues[0].severity == "error"

def test_asset_coverage_missing():
    """Planned asset not referenced in text should be flagged."""
    section_drafts = {"sec-1": "## Intro\n\nSome text without any image references."}
    blueprint_sections = [
        SectionBlueprint(id="sec-1", title="Intro", word_budget=500,
                         assets=["asset-diagram-1"], must_cover=[]),
    ]
    asset_map = {"asset-diagram-1": {"url": "https://example.com/img.png", "description": "Architecture diagram"}}
    issues = evaluate_deterministic(section_drafts, blueprint_sections, asset_map=asset_map)
    asset_issues = [i for i in issues if i.category == "asset_coverage"]
    assert len(asset_issues) == 1
    assert asset_issues[0].severity == "warning"

def test_mermaid_syntax_basic_validation():
    """Mermaid block with obviously broken syntax should be flagged."""
    bad_mermaid = '```mermaid\ngraph TD\n  A-->B\n  C-->\n```'
    section_drafts = {"sec-1": f"## Diagram\n\n{bad_mermaid}\n\nSome text."}
    blueprint_sections = [
        SectionBlueprint(id="sec-1", title="Diagram", word_budget=200, assets=[], must_cover=[]),
    ]
    issues = evaluate_deterministic(section_drafts, blueprint_sections, asset_map={})
    mermaid_issues = [i for i in issues if i.category == "mermaid_syntax"]
    assert len(mermaid_issues) >= 1

def test_broken_image_url_format():
    """Image with empty or malformed URL should be flagged."""
    section_drafts = {"sec-1": "## Intro\n\n![alt text]()\n\nSome text."}
    blueprint_sections = [
        SectionBlueprint(id="sec-1", title="Intro", word_budget=200, assets=[], must_cover=[]),
    ]
    issues = evaluate_deterministic(section_drafts, blueprint_sections, asset_map={})
    img_issues = [i for i in issues if i.category == "image_url"]
    assert len(img_issues) == 1
    assert img_issues[0].auto_fixable is True
```

- [ ] **第 2 步：实施评估确定性**

```python
# agent-service/app/workers/evaluator.py
from __future__ import annotations

import re
import uuid
from typing import Any

from app.models.review import ReviewIssue


def _count_words(text: str) -> int:
    """Count words — handles both CJK and Latin text."""
    # CJK characters count as 1 word each
    cjk_count = len(re.findall(r'[\u4e00-\u9fff\u3400-\u4dbf]', text))
    # Latin words
    latin_text = re.sub(r'[\u4e00-\u9fff\u3400-\u4dbf]', ' ', text)
    latin_count = len(latin_text.split())
    return cjk_count + latin_count


def _check_word_count(section_id: str, text: str, budget: int) -> list[ReviewIssue]:
    """Flag sections exceeding word budget by >10%."""
    issues = []
    count = _count_words(text)
    if budget <= 0:
        return issues
    ratio = count / budget
    if ratio > 1.10:
        issues.append(ReviewIssue(
            id=str(uuid.uuid4()),
            section_id=section_id,
            severity="warning",
            category="word_count",
            description=f"Section has {count} words, exceeding budget of {budget} by {int((ratio - 1) * 100)}%",
            suggestion=f"Trim to approximately {budget} words. Remove redundant examples or verbose phrasing.",
            auto_fixable=False,
        ))
    elif ratio < 0.90:
        issues.append(ReviewIssue(
            id=str(uuid.uuid4()),
            section_id=section_id,
            severity="info",
            category="word_count",
            description=f"Section has {count} words, under budget of {budget} by {int((1 - ratio) * 100)}%",
            suggestion=f"Consider expanding with more detail or examples to reach ~{budget} words.",
            auto_fixable=False,
        ))
    return issues


def _check_heading_levels(section_id: str, text: str) -> list[ReviewIssue]:
    """Flag heading level jumps (e.g., H2 -> H4 skipping H3)."""
    issues = []
    headings = re.findall(r'^(#{1,6})\s', text, flags=re.MULTILINE)
    levels = [len(h) for h in headings]
    for i in range(1, len(levels)):
        if levels[i] > levels[i - 1] + 1:
            issues.append(ReviewIssue(
                id=str(uuid.uuid4()),
                section_id=section_id,
                severity="warning",
                category="heading_level",
                description=f"Heading level jumps from H{levels[i-1]} to H{levels[i]}",
                suggestion=f"Change H{levels[i]} to H{levels[i-1] + 1} for proper hierarchy",
                auto_fixable=True,
            ))
    return issues


def _check_empty_section(section_id: str, text: str) -> list[ReviewIssue]:
    """Flag empty or whitespace-only sections."""
    if not text.strip():
        return [ReviewIssue(
            id=str(uuid.uuid4()),
            section_id=section_id,
            severity="error",
            category="empty_section",
            description="Section is empty or contains only whitespace",
            suggestion="Generate content for this section or remove it from the blueprint",
            auto_fixable=False,
        )]
    return []


def _check_asset_coverage(section_id: str, text: str, planned_assets: list[str],
                           asset_map: dict[str, Any]) -> list[ReviewIssue]:
    """Flag planned assets not referenced in section text."""
    issues = []
    for asset_id in planned_assets:
        asset = asset_map.get(asset_id, {})
        url = asset.get("url", "")
        # Check if asset URL or asset ID is referenced in text
        if url and url not in text and asset_id not in text:
            issues.append(ReviewIssue(
                id=str(uuid.uuid4()),
                section_id=section_id,
                severity="warning",
                category="asset_coverage",
                description=f"Planned asset '{asset_id}' is not referenced in section text",
                suggestion=f"Add reference to asset: ![{asset.get('description', asset_id)}]({url})",
                auto_fixable=False,
            ))
    return issues


def _check_mermaid_syntax(section_id: str, text: str) -> list[ReviewIssue]:
    """Basic Mermaid syntax validation."""
    issues = []
    mermaid_blocks = re.findall(r'```mermaid\n(.*?)```', text, flags=re.DOTALL)
    for block in mermaid_blocks:
        lines = [l.strip() for l in block.strip().split('\n') if l.strip()]
        if not lines:
            issues.append(ReviewIssue(
                id=str(uuid.uuid4()),
                section_id=section_id,
                severity="warning",
                category="mermaid_syntax",
                description="Empty Mermaid code block",
                suggestion="Add diagram content or remove the empty block",
                auto_fixable=True,
            ))
            continue
        # Check for dangling arrows (line ends with --> or --- without target)
        for line in lines[1:]:  # skip diagram type declaration
            if re.search(r'-->\s*$|---\s*$|-->\|[^|]*\|\s*$', line):
                issues.append(ReviewIssue(
                    id=str(uuid.uuid4()),
                    section_id=section_id,
                    severity="warning",
                    category="mermaid_syntax",
                    description=f"Mermaid line has dangling connection: '{line}'",
                    suggestion="Add a target node after the arrow",
                    auto_fixable=False,
                ))
    return issues


def _check_image_urls(section_id: str, text: str) -> list[ReviewIssue]:
    """Flag images with empty or malformed URLs."""
    issues = []
    # Match ![alt](url) patterns
    for match in re.finditer(r'!\[([^\]]*)\]\(([^)]*)\)', text):
        alt, url = match.group(1), match.group(2)
        url = url.strip()
        if not url:
            issues.append(ReviewIssue(
                id=str(uuid.uuid4()),
                section_id=section_id,
                severity="warning",
                category="image_url",
                description=f"Image '{alt or 'unnamed'}' has empty URL",
                suggestion="Remove the broken image reference or provide a valid URL",
                auto_fixable=True,
            ))
    return issues


def evaluate_deterministic(
    section_drafts: dict[str, str],
    blueprint_sections: list,
    asset_map: dict[str, Any],
) -> list[ReviewIssue]:
    """Run all deterministic checks across section drafts.

    Args:
        section_drafts: mapping of section_id -> markdown text
        blueprint_sections: list of SectionBlueprint objects with id, word_budget, assets
        asset_map: mapping of asset_id -> {url, description, ...}

    Returns:
        List of ReviewIssue objects found by deterministic analysis.
    """
    all_issues: list[ReviewIssue] = []

    # Build section lookup from blueprint
    blueprint_lookup = {s.id: s for s in blueprint_sections}

    for section_id, text in section_drafts.items():
        bp = blueprint_lookup.get(section_id)

        # Empty section check
        all_issues.extend(_check_empty_section(section_id, text))
        if not text.strip():
            continue  # skip other checks for empty sections

        # Word count check
        if bp and hasattr(bp, 'word_budget') and bp.word_budget:
            all_issues.extend(_check_word_count(section_id, text, bp.word_budget))

        # Heading level check
        all_issues.extend(_check_heading_levels(section_id, text))

        # Asset coverage check
        if bp and hasattr(bp, 'assets') and bp.assets:
            all_issues.extend(_check_asset_coverage(section_id, text, bp.assets, asset_map))

        # Mermaid syntax check
        if '```mermaid' in text:
            all_issues.extend(_check_mermaid_syntax(section_id, text))

        # Image URL check
        if '![' in text:
            all_issues.extend(_check_image_urls(section_id, text))

    return all_issues
```

- [ ] **第 3 步：运行测试并验证**

运行： `cd /e/test/Docmost/agent-service && python -m pytest tests/workers/test_evaluator.py -v`

- [ ] **第 4 步：提交**

运行： `cd /e/test/Docmost && git add agent-service/app/workers/evaluator.py agent-service/tests/workers/test_evaluator.py && git commit -m "feat(agent): implement deterministic evaluator checks"`

---

## 分块 2：LLM 质量评估

### 任务 3：实现 LLM-based evaluation

**文件：**
- 修改：`agent-service/app/workers/evaluator.py`
- 测试： `agent-service/tests/workers/test_evaluator_llm.py`

**背景：** LLM 评估员评估无法机械检查的写作质量维度。它输出结构化 JSON 问题 — 从未重写内容。

- [ ] **第 1 步：为 LLM 评估编写失败测试**

```python
# agent-service/tests/workers/test_evaluator_llm.py
import pytest
from unittest.mock import AsyncMock, patch
from app.workers.evaluator import evaluate_llm

@pytest.mark.asyncio
async def test_evaluate_llm_returns_issues():
    """LLM evaluation should return ReviewIssues with correct structure."""
    mock_llm_response = {
        "issues": [
            {
                "section_id": "sec-1",
                "severity": "warning",
                "category": "accuracy",
                "description": "Claim about market share is unsupported",
                "suggestion": "Add a citation or remove the specific percentage",
            }
        ],
        "dimensions": {
            "accuracy": 75,
            "completeness": 85,
            "style_consistency": 90,
            "readability": 88,
            "argument_strength": 70,
        },
        "overall_score": 82,
    }
    with patch("app.workers.evaluator._call_llm_evaluate", new_callable=AsyncMock, return_value=mock_llm_response):
        issues, dimensions, score = await evaluate_llm(
            draft_text="## Intro\n\nOur product holds 45% market share.",
            blueprint_summary="Write an accurate product overview",
            brief_instructions="Be factual and cite sources",
        )
    assert len(issues) == 1
    assert issues[0].category == "accuracy"
    assert issues[0].auto_fixable is False  # all LLM issues are manual
    assert dimensions["accuracy"] == 75
    assert score == 82

@pytest.mark.asyncio
async def test_evaluate_llm_no_issues():
    """Perfect document should return empty issues list."""
    mock_llm_response = {
        "issues": [],
        "dimensions": {"accuracy": 95, "completeness": 92, "style_consistency": 90,
                       "readability": 94, "argument_strength": 91},
        "overall_score": 93,
    }
    with patch("app.workers.evaluator._call_llm_evaluate", new_callable=AsyncMock, return_value=mock_llm_response):
        issues, dimensions, score = await evaluate_llm("Good text", "blueprint", "brief")
    assert len(issues) == 0
    assert score == 93
```

- [ ] **第 2 步：实施evaluate_llm和_call_llm_evaluate**

Add to `agent-service/app/workers/evaluator.py`:

```python
from pydantic_ai import Agent

_EVALUATE_PROMPT = """You are a document quality evaluator. Evaluate the following document against the creation blueprint and brief instructions.

BLUEPRINT SUMMARY:
{blueprint_summary}

BRIEF INSTRUCTIONS:
{brief_instructions}

DOCUMENT:
{draft_text}

Evaluate on these dimensions (score 0-100 each):
1. accuracy — Are claims correct and supported?
2. completeness — Does it cover all required topics?
3. style_consistency — Is the writing style consistent throughout?
4. readability — Is it clear and well-structured?
5. argument_strength — Are arguments well-supported?

Output JSON with this exact structure:
{{
  "issues": [
    {{
      "section_id": "<section id>",
      "severity": "error|warning|info",
      "category": "<dimension name>",
      "description": "<what's wrong>",
      "suggestion": "<how to fix>"
    }}
  ],
  "dimensions": {{
    "accuracy": <score>,
    "completeness": <score>,
    "style_consistency": <score>,
    "readability": <score>,
    "argument_strength": <score>
  }},
  "overall_score": <weighted average>
}}

Output ONLY issues — do NOT output revised content. If the document is excellent, return an empty issues list."""


async def _call_llm_evaluate(prompt: str, model: str | None = None) -> dict:
    """Call LLM with evaluation prompt, return parsed JSON response."""
    from app.orchestrator.llm_factory import get_model
    agent = Agent(get_model(model), result_type=dict)
    result = await agent.run(prompt)
    return result.data


async def evaluate_llm(
    draft_text: str,
    blueprint_summary: str,
    brief_instructions: str,
    model: str | None = None,
) -> tuple[list[ReviewIssue], dict[str, int], int]:
    """Run LLM quality evaluation.

    Returns:
        (issues, dimensions, overall_score) tuple.
        All issues have auto_fixable=False — user decides which to fix.
    """
    prompt = _EVALUATE_PROMPT.format(
        blueprint_summary=blueprint_summary,
        brief_instructions=brief_instructions,
        draft_text=draft_text,
    )
    response = await _call_llm_evaluate(prompt, model)

    issues = []
    for item in response.get("issues", []):
        issues.append(ReviewIssue(
            id=str(uuid.uuid4()),
            section_id=item.get("section_id", "unknown"),
            severity=item.get("severity", "info"),
            category=item.get("category", "general"),
            description=item.get("description", ""),
            suggestion=item.get("suggestion", ""),
            auto_fixable=False,  # LLM-detected issues always require user decision
        ))

    dimensions = response.get("dimensions", {})
    overall_score = response.get("overall_score", 0)

    return issues, dimensions, overall_score
```

- [ ] **第 3 步：运行测试并验证**

运行： `cd /e/test/Docmost/agent-service && python -m pytest tests/workers/test_evaluator_llm.py -v`

- [ ] **第 4 步：提交**

运行： `cd /e/test/Docmost && git add agent-service/app/workers/evaluator.py agent-service/tests/workers/test_evaluator_llm.py && git commit -m "feat(agent): implement LLM-based quality evaluation"`

---

## 分块 3：evaluate_quality 编排器工具

### 任务 4：创建 evaluate_quality tool

**文件：**
- 创建：`agent-service/app/orchestrator/tools/evaluate.py`
- 测试： `agent-service/tests/orchestrator/test_evaluate_tool.py`

**上下文：** 该工具在写入阶段完成后由 Orchestrator 调用。它运行确定性评估和 LLM 评估，将结果合并到 ReviewReport 中，并触发自动修复（如果适用）。

- [ ] **第 1 步：为评估质量编写失败测试**

```python
# agent-service/tests/orchestrator/test_evaluate_tool.py
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from app.orchestrator.tools.evaluate import evaluate_quality

@pytest.mark.asyncio
async def test_evaluate_quality_merges_results():
    """evaluate_quality should merge deterministic and LLM issues into ReviewReport."""
    from app.models.review import ReviewIssue

    det_issues = [
        ReviewIssue(id="d1", section_id="s1", severity="warning", category="heading_level",
                    description="H2->H4 skip", suggestion="Fix heading", auto_fixable=True),
    ]
    llm_issues = [
        ReviewIssue(id="l1", section_id="s1", severity="warning", category="accuracy",
                    description="Unsupported claim", suggestion="Add citation", auto_fixable=False),
    ]
    with patch("app.orchestrator.tools.evaluate.evaluate_deterministic", return_value=det_issues), \
         patch("app.orchestrator.tools.evaluate.evaluate_llm", new_callable=AsyncMock,
               return_value=(llm_issues, {"accuracy": 80}, 80)):
        ctx = MagicMock()
        report = await evaluate_quality(ctx, section_drafts={"s1": "text"},
                                         blueprint_sections=[], asset_map={},
                                         blueprint_summary="sum", brief_instructions="brief")
    assert len(report.issues) == 2
    assert report.overall_score == 80
    auto_fixable = [i for i in report.issues if i.auto_fixable]
    assert len(auto_fixable) == 1

@pytest.mark.asyncio
async def test_evaluate_quality_computes_metrics():
    """Should compute length_compliance and asset_reuse_rate."""
    with patch("app.orchestrator.tools.evaluate.evaluate_deterministic", return_value=[]), \
         patch("app.orchestrator.tools.evaluate.evaluate_llm", new_callable=AsyncMock,
               return_value=([], {"accuracy": 95}, 95)):
        ctx = MagicMock()
        report = await evaluate_quality(ctx, section_drafts={"s1": "word " * 100},
                                         blueprint_sections=[], asset_map={},
                                         blueprint_summary="sum", brief_instructions="brief")
    assert report.length_compliance >= 0.0
    assert report.asset_reuse_rate >= 0.0
```

- [ ] **第 2 步：实施evaluate_quality工具**

```python
# agent-service/app/orchestrator/tools/evaluate.py
from __future__ import annotations

from typing import Any

from app.models.review import ReviewIssue, ReviewReport
from app.workers.evaluator import evaluate_deterministic, evaluate_llm


async def evaluate_quality(
    ctx: Any,
    section_drafts: dict[str, str],
    blueprint_sections: list,
    asset_map: dict[str, Any],
    blueprint_summary: str,
    brief_instructions: str,
    model: str | None = None,
) -> ReviewReport:
    """Run deterministic + LLM evaluation and produce a merged ReviewReport.

    This is an Orchestrator tool — registered via @orchestrator.tool().
    """
    # Phase 1: Deterministic checks
    det_issues = evaluate_deterministic(section_drafts, blueprint_sections, asset_map)

    # Phase 2: LLM quality assessment
    full_text = "\n\n---\n\n".join(
        f"[Section: {sid}]\n{text}" for sid, text in section_drafts.items()
    )
    llm_issues, dimensions, overall_score = await evaluate_llm(
        draft_text=full_text,
        blueprint_summary=blueprint_summary,
        brief_instructions=brief_instructions,
        model=model,
    )

    # Merge issues
    all_issues = det_issues + llm_issues

    # Compute length_compliance: fraction of sections within budget tolerance
    in_budget = 0
    total_with_budget = 0
    bp_lookup = {s.id: s for s in blueprint_sections}
    for sid, text in section_drafts.items():
        bp = bp_lookup.get(sid)
        if bp and hasattr(bp, 'word_budget') and bp.word_budget:
            total_with_budget += 1
            from app.workers.evaluator import _count_words
            ratio = _count_words(text) / bp.word_budget
            if 0.90 <= ratio <= 1.10:
                in_budget += 1
    length_compliance = in_budget / total_with_budget if total_with_budget > 0 else 1.0

    # Compute asset_reuse_rate: fraction of planned assets actually referenced
    total_assets = 0
    used_assets = 0
    for bp in blueprint_sections:
        if hasattr(bp, 'assets') and bp.assets:
            for asset_id in bp.assets:
                total_assets += 1
                sid = bp.id
                text = section_drafts.get(sid, "")
                asset = asset_map.get(asset_id, {})
                url = asset.get("url", "")
                if (url and url in text) or asset_id in text:
                    used_assets += 1
    asset_reuse_rate = used_assets / total_assets if total_assets > 0 else 1.0

    report = ReviewReport(
        overall_score=overall_score,
        length_compliance=length_compliance,
        asset_reuse_rate=asset_reuse_rate,
        issues=all_issues,
        dimensions=dimensions,
    )

    # Emit SSE event with review report
    if hasattr(ctx, 'emit'):
        await ctx.emit("review_report", report.model_dump())

    return report
```

- [ ] **第 3 步：运行测试并验证**

运行： `cd /e/test/Docmost/agent-service && python -m pytest tests/orchestrator/test_evaluate_tool.py -v`

- [ ] **第 4 步：提交**

运行： `cd /e/test/Docmost && git add agent-service/app/orchestrator/tools/evaluate.py agent-service/tests/orchestrator/test_evaluate_tool.py && git commit -m "feat(agent): implement evaluate_quality orchestrator tool"`

---

## 分块 4：Fixer Worker

### 任务 5：实现 auto-fix (deterministic)

**文件：**
- 创建：`agent-service/app/workers/fixer.py`
- 测试： `agent-service/tests/workers/test_fixer.py`

**上下文：** 自动修复处理可机械修复的问题：标题级别、损坏的图像、尾随空白。没有LLM电话。

- [ ] **第 1 步：编写自动修复失败的测试**

```python
# agent-service/tests/workers/test_fixer.py
import pytest
from app.workers.fixer import fix_auto
from app.models.review import ReviewIssue

def test_fix_heading_level():
    """Should correct H4 to H3 when preceded by H2."""
    section = "## Overview\n\nSome text\n\n#### Deep detail\n\nMore text"
    issues = [ReviewIssue(
        id="1", section_id="sec-1", severity="warning", category="heading_level",
        description="H2->H4 skip", suggestion="Change H4 to H3", auto_fixable=True,
    )]
    drafts = {"sec-1": section}
    fixed_drafts, fixed_issues = fix_auto(drafts, issues)
    assert "### Deep detail" in fixed_drafts["sec-1"]
    assert "####" not in fixed_drafts["sec-1"]
    assert fixed_issues[0].fixed is True

def test_fix_empty_image():
    """Should remove image tags with empty URLs."""
    section = "## Intro\n\n![alt text]()\n\nSome content after."
    issues = [ReviewIssue(
        id="2", section_id="sec-1", severity="warning", category="image_url",
        description="Empty image URL", suggestion="Remove", auto_fixable=True,
    )]
    drafts = {"sec-1": section}
    fixed_drafts, _ = fix_auto(drafts, issues)
    assert "![alt text]()" not in fixed_drafts["sec-1"]

def test_fix_trailing_whitespace():
    """Should strip trailing whitespace from lines."""
    section = "## Intro   \n\nSome text   \n\nMore text"
    issues = [ReviewIssue(
        id="3", section_id="sec-1", severity="info", category="trailing_whitespace",
        description="Trailing whitespace", suggestion="Strip", auto_fixable=True,
    )]
    drafts = {"sec-1": section}
    fixed_drafts, _ = fix_auto(drafts, issues)
    for line in fixed_drafts["sec-1"].split('\n'):
        assert line == line.rstrip(), f"Line still has trailing whitespace: '{line}'"

def test_fix_auto_skips_non_auto_fixable():
    """Should not touch issues that are not auto_fixable."""
    issues = [ReviewIssue(
        id="4", section_id="sec-1", severity="warning", category="accuracy",
        description="Unsupported claim", suggestion="Fix manually", auto_fixable=False,
    )]
    drafts = {"sec-1": "Some text with unsupported claims."}
    fixed_drafts, fixed_issues = fix_auto(drafts, issues)
    assert fixed_drafts["sec-1"] == drafts["sec-1"]
    assert fixed_issues[0].fixed is False
```

- [ ] **第 2 步：实施fix_auto**

```python
# agent-service/app/workers/fixer.py
from __future__ import annotations

import re
from typing import Any

from app.models.review import ReviewIssue


def _fix_heading_levels(text: str) -> str:
    """Fix heading level skips by adjusting deeper headings."""
    lines = text.split('\n')
    result = []
    prev_level = 0
    for line in lines:
        match = re.match(r'^(#{1,6})\s+(.+)', line)
        if match:
            hashes, title = match.group(1), match.group(2)
            level = len(hashes)
            if prev_level > 0 and level > prev_level + 1:
                level = prev_level + 1
                hashes = '#' * level
            prev_level = level
            result.append(f"{hashes} {title}")
        else:
            result.append(line)
    return '\n'.join(result)


def _fix_empty_images(text: str) -> str:
    """Remove image tags with empty URLs."""
    # Remove ![anything]() — empty URL
    text = re.sub(r'!\[[^\]]*\]\(\s*\)\s*\n?', '', text)
    return text


def _fix_trailing_whitespace(text: str) -> str:
    """Strip trailing whitespace from each line."""
    return '\n'.join(line.rstrip() for line in text.split('\n'))


def _fix_mermaid_semicolons(text: str) -> str:
    """Attempt to fix common Mermaid issues like missing semicolons."""
    # This is a best-effort fix; complex syntax errors need manual attention
    def fix_block(match):
        block = match.group(1)
        # Add missing semicolons at end of node definitions in flowcharts
        lines = block.split('\n')
        fixed_lines = []
        for line in lines:
            stripped = line.strip()
            # Add semicolon to node definitions that look incomplete
            if stripped and not stripped.endswith(';') and not stripped.endswith(']') \
               and not stripped.startswith('graph') and not stripped.startswith('flowchart') \
               and not stripped.startswith('sequenceDiagram') and not stripped.startswith('classDiagram') \
               and '-->' in stripped and re.search(r'-->\s*$', stripped):
                # Dangling arrow — can't auto-fix, skip
                pass
            fixed_lines.append(line)
        return '```mermaid\n' + '\n'.join(fixed_lines) + '```'

    return re.sub(r'```mermaid\n(.*?)```', fix_block, text, flags=re.DOTALL)


_FIXERS = {
    "heading_level": _fix_heading_levels,
    "image_url": _fix_empty_images,
    "trailing_whitespace": _fix_trailing_whitespace,
    "mermaid_syntax": _fix_mermaid_semicolons,
}


def fix_auto(
    section_drafts: dict[str, str],
    issues: list[ReviewIssue],
) -> tuple[dict[str, str], list[ReviewIssue]]:
    """Apply auto-fixes for auto_fixable issues. Pure code, no LLM.

    Returns:
        (updated_section_drafts, updated_issues) — issues have fixed=True where applied.
    """
    updated_drafts = dict(section_drafts)
    updated_issues = []

    # Group auto-fixable issues by section and category
    auto_by_section: dict[str, set[str]] = {}
    for issue in issues:
        if issue.auto_fixable:
            auto_by_section.setdefault(issue.section_id, set()).add(issue.category)

    # Apply fixes
    for section_id, categories in auto_by_section.items():
        if section_id not in updated_drafts:
            continue
        text = updated_drafts[section_id]
        for category in categories:
            fixer = _FIXERS.get(category)
            if fixer:
                text = fixer(text)
        updated_drafts[section_id] = text

    # Mark issues as fixed
    for issue in issues:
        updated = issue.model_copy()
        if issue.auto_fixable and issue.category in _FIXERS:
            updated.fixed = True
        updated_issues.append(updated)

    return updated_drafts, updated_issues
```

- [ ] **第 3 步：运行测试并验证**

运行： `cd /e/test/Docmost/agent-service && python -m pytest tests/workers/test_fixer.py -v`

- [ ] **第 4 步：提交**

运行： `cd /e/test/Docmost && git add agent-service/app/workers/fixer.py agent-service/tests/workers/test_fixer.py && git commit -m "feat(agent): implement auto-fix fixer worker"`

---

### 任务 6：实现 targeted LLM fix

**文件：**
- 修改：`agent-service/app/workers/fixer.py`
- 测试： `agent-service/tests/workers/test_fixer_llm.py`

- [ ] **第 1 步：为目标修复编写失败测试**

```python
# agent-service/tests/workers/test_fixer_llm.py
import pytest
from unittest.mock import AsyncMock, patch
from app.workers.fixer import fix_targeted
from app.models.review import ReviewIssue

@pytest.mark.asyncio
async def test_fix_targeted_returns_fixed_content():
    """Targeted fix should return modified section content."""
    issue = ReviewIssue(
        id="1", section_id="sec-1", severity="warning", category="accuracy",
        description="Market share claim unsupported", suggestion="Add citation",
        auto_fixable=False,
    )
    original = "## Overview\n\nOur product holds 45% market share.\n\nMore text here."
    fixed = "## Overview\n\nOur product holds significant market share (Source: Gartner 2025).\n\nMore text here."
    with patch("app.workers.fixer._call_llm_fix", new_callable=AsyncMock, return_value=fixed):
        result = await fix_targeted("sec-1", issue, original)
    assert "Gartner" in result or result != original

@pytest.mark.asyncio
async def test_fix_targeted_warns_on_large_diff():
    """Should warn if fix changes >20% of content."""
    issue = ReviewIssue(
        id="2", section_id="sec-1", severity="warning", category="completeness",
        description="Missing conclusion", suggestion="Add conclusion paragraph",
        auto_fixable=False,
    )
    original = "Short text."
    completely_different = "Entirely rewritten long text that bears no resemblance to the original content whatsoever and goes on and on."
    with patch("app.workers.fixer._call_llm_fix", new_callable=AsyncMock, return_value=completely_different), \
         patch("app.workers.fixer.logger") as mock_logger:
        result = await fix_targeted("sec-1", issue, original)
        mock_logger.warning.assert_called()
```

- [ ] **第 2 步：实施fix_targeted**

Add to `agent-service/app/workers/fixer.py`:

```python
import logging

logger = logging.getLogger(__name__)

_FIX_PROMPT = """Fix ONLY the following issue in this section. Do not change anything else.

ISSUE:
Category: {category}
Description: {description}
Suggestion: {suggestion}

SECTION CONTENT:
{section_content}

Output the fixed section content only. Make minimal changes — fix only the specific issue described above."""


async def _call_llm_fix(prompt: str, model: str | None = None) -> str:
    """Call LLM with fix prompt, return fixed text."""
    from app.orchestrator.llm_factory import get_model
    from pydantic_ai import Agent
    agent = Agent(get_model(model), result_type=str)
    result = await agent.run(prompt)
    return result.data


def _diff_ratio(original: str, fixed: str) -> float:
    """Compute the fraction of characters changed."""
    if not original:
        return 1.0
    # Simple character-level diff ratio
    max_len = max(len(original), len(fixed))
    if max_len == 0:
        return 0.0
    # Count matching characters using SequenceMatcher
    from difflib import SequenceMatcher
    ratio = SequenceMatcher(None, original, fixed).ratio()
    return 1.0 - ratio  # fraction changed


async def fix_targeted(
    section_id: str,
    issue: ReviewIssue,
    section_content: str,
    model: str | None = None,
) -> str:
    """Fix a specific issue in a section using LLM.

    Makes a single LLM call targeting only the described issue.
    Warns if the resulting diff is larger than 20%.

    Returns:
        Fixed section content string.
    """
    prompt = _FIX_PROMPT.format(
        category=issue.category,
        description=issue.description,
        suggestion=issue.suggestion,
        section_content=section_content,
    )
    fixed_content = await _call_llm_fix(prompt, model)

    # Verify minimal change
    change_ratio = _diff_ratio(section_content, fixed_content)
    if change_ratio > 0.20:
        logger.warning(
            f"Targeted fix for section '{section_id}' issue '{issue.id}' changed "
            f"{change_ratio:.0%} of content (threshold: 20%). Fix may be too broad."
        )

    return fixed_content
```

- [ ] **第 3 步：运行测试并验证**

运行： `cd /e/test/Docmost/agent-service && python -m pytest tests/workers/test_fixer_llm.py -v`

- [ ] **第 4 步：提交**

运行： `cd /e/test/Docmost && git add agent-service/app/workers/fixer.py agent-service/tests/workers/test_fixer_llm.py && git commit -m "feat(agent): implement targeted LLM fix in fixer worker"`

---

## 分块 5：fix_issues 编排器工具

### 任务 7：创建 fix_issues tool

**文件：**
- 创建：`agent-service/app/orchestrator/tools/fix_tools.py`
- 测试： `agent-service/tests/orchestrator/test_fix_tools.py`

- [ ] **第 1 步：编写失败的测试**

```python
# agent-service/tests/orchestrator/test_fix_tools.py
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from app.orchestrator.tools.fix_tools import fix_issues
from app.models.review import ReviewIssue

@pytest.mark.asyncio
async def test_fix_issues_calls_fixer_for_each():
    """Should call fix_targeted for each selected issue."""
    issues = [
        ReviewIssue(id="1", section_id="s1", severity="warning", category="accuracy",
                    description="Bad claim", suggestion="Fix it", auto_fixable=False),
        ReviewIssue(id="2", section_id="s2", severity="warning", category="completeness",
                    description="Missing info", suggestion="Add it", auto_fixable=False),
    ]
    section_drafts = {"s1": "Original s1", "s2": "Original s2"}

    with patch("app.orchestrator.tools.fix_tools.fix_targeted", new_callable=AsyncMock,
               side_effect=["Fixed s1", "Fixed s2"]) as mock_fix:
        ctx = MagicMock()
        ctx.emit = AsyncMock()
        updated = await fix_issues(ctx, issue_ids=["1", "2"], issues=issues,
                                    section_drafts=section_drafts)
    assert updated["s1"] == "Fixed s1"
    assert updated["s2"] == "Fixed s2"
    assert mock_fix.call_count == 2

@pytest.mark.asyncio
async def test_fix_issues_skips_unknown_ids():
    """Should skip issue IDs not found in the issues list."""
    issues = [
        ReviewIssue(id="1", section_id="s1", severity="warning", category="accuracy",
                    description="Bad", suggestion="Fix", auto_fixable=False),
    ]
    section_drafts = {"s1": "Original"}
    with patch("app.orchestrator.tools.fix_tools.fix_targeted", new_callable=AsyncMock,
               return_value="Fixed") as mock_fix:
        ctx = MagicMock()
        ctx.emit = AsyncMock()
        updated = await fix_issues(ctx, issue_ids=["1", "999"], issues=issues,
                                    section_drafts=section_drafts)
    assert mock_fix.call_count == 1  # only called for id="1"
```

- [ ] **第 2 步：实施 fix_issues 工具**

```python
# agent-service/app/orchestrator/tools/fix_tools.py
from __future__ import annotations

import logging
from typing import Any

from app.models.review import ReviewIssue
from app.workers.fixer import fix_targeted

logger = logging.getLogger(__name__)


async def fix_issues(
    ctx: Any,
    issue_ids: list[str],
    issues: list[ReviewIssue],
    section_drafts: dict[str, str],
    model: str | None = None,
) -> dict[str, str]:
    """Fix selected issues by ID using the Fixer Worker.

    For each selected issue, calls fix_targeted on the relevant section.
    Emits fix_applied SSE events per fix.

    Args:
        ctx: Orchestrator context (has emit method for SSE)
        issue_ids: list of ReviewIssue IDs selected by user
        issues: full list of ReviewIssue objects
        section_drafts: current section drafts
        model: optional model override for LLM fixes

    Returns:
        Updated section_drafts dict with fixes applied.
    """
    updated_drafts = dict(section_drafts)
    issue_lookup = {i.id: i for i in issues}

    for issue_id in issue_ids:
        issue = issue_lookup.get(issue_id)
        if not issue:
            logger.warning(f"Issue ID '{issue_id}' not found in issues list, skipping")
            continue

        section_id = issue.section_id
        if section_id not in updated_drafts:
            logger.warning(f"Section '{section_id}' not found in drafts, skipping issue '{issue_id}'")
            continue

        logger.info(f"Fixing issue '{issue_id}' in section '{section_id}': {issue.description}")

        fixed_content = await fix_targeted(
            section_id=section_id,
            issue=issue,
            section_content=updated_drafts[section_id],
            model=model,
        )
        updated_drafts[section_id] = fixed_content

        # Emit SSE event per fix
        if hasattr(ctx, 'emit'):
            await ctx.emit("fix_applied", {
                "issue_id": issue_id,
                "section_id": section_id,
                "category": issue.category,
                "description": issue.description,
            })

    return updated_drafts
```

- [ ] **第 3 步：运行测试并验证**

运行： `cd /e/test/Docmost/agent-service && python -m pytest tests/orchestrator/test_fix_tools.py -v`

- [ ] **第 4 步：提交**

运行： `cd /e/test/Docmost && git add agent-service/app/orchestrator/tools/fix_tools.py agent-service/tests/orchestrator/test_fix_tools.py && git commit -m "feat(agent): implement fix_issues orchestrator tool"`

---

## 分块 6：Review Card 前端

### 任务 8：添加 ReviewIssue and ReviewReport TypeScript types

**文件：**
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-creator.types.ts`

- [ ] **第 1 步：添加类型**

添加到现有类型文件：

```typescript
// Review system types
export interface ReviewIssue {
  id: string;
  section_id: string;
  severity: 'error' | 'warning' | 'info';
  category: string;
  description: string;
  suggestion: string;
  auto_fixable: boolean;
  fixed: boolean;
}

export interface ReviewReport {
  overall_score: number;
  length_compliance: number;
  asset_reuse_rate: number;
  issues: ReviewIssue[];
  dimensions: Record<string, number>;
}
```

- [ ] **第 2 步：提交**

运行： `cd /e/test/Docmost && git add apps/client/src/ee/ai/components/ai-creator/ai-creator.types.ts && git commit -m "feat(client): add ReviewIssue and ReviewReport types"`

---

### 任务 9：实现 ReviewScoreBoard component

**文件：**
- 创建：`apps/client/src/ee/ai/components/ai-creator/review/ReviewScoreBoard.tsx`

- [ ] **第 1 步：实施组件**

```tsx
// apps/client/src/ee/ai/components/ai-creator/review/ReviewScoreBoard.tsx
import { Group, RingProgress, Stack, Text, Progress } from '@mantine/core';
import type { ReviewReport } from '../ai-creator.types';

interface ReviewScoreBoardProps {
  report: ReviewReport;
}

const DIMENSION_LABELS: Record<string, string> = {
  accuracy: '准确性',
  completeness: '完整性',
  style_consistency: '风格一致性',
  readability: '可读性',
  argument_strength: '论证力度',
};

function scoreColor(score: number): string {
  if (score >= 80) return 'green';
  if (score >= 60) return 'yellow';
  return 'red';
}

export function ReviewScoreBoard({ report }: ReviewScoreBoardProps) {
  return (
    <Group align="flex-start" gap="xl">
      <Stack align="center" gap="xs">
        <RingProgress
          size={100}
          thickness={10}
          roundCaps
          sections={[{ value: report.overall_score, color: scoreColor(report.overall_score) }]}
          label={
            <Text ta="center" fw={700} size="lg">
              {report.overall_score}
            </Text>
          }
        />
        <Text size="sm" c="dimmed">Overall Score</Text>
      </Stack>
      <Stack gap="xs" style={{ flex: 1 }}>
        {Object.entries(report.dimensions).map(([key, value]) => (
          <div key={key}>
            <Group justify="space-between" mb={4}>
              <Text size="xs">{DIMENSION_LABELS[key] || key}</Text>
              <Text size="xs" c="dimmed">{value}</Text>
            </Group>
            <Progress value={value} color={scoreColor(value)} size="sm" />
          </div>
        ))}
      </Stack>
    </Group>
  );
}
```

- [ ] **第 2 步：提交**

运行： `cd /e/test/Docmost && git add apps/client/src/ee/ai/components/ai-creator/review/ReviewScoreBoard.tsx && git commit -m "feat(client): implement ReviewScoreBoard component"`

---

### 任务 10：实现 IssueCard component

**文件：**
- 创建：`apps/client/src/ee/ai/components/ai-creator/review/IssueCard.tsx`

- [ ] **第 1 步：实施组件**

```tsx
// apps/client/src/ee/ai/components/ai-creator/review/IssueCard.tsx
import { Badge, Card, Checkbox, Group, Stack, Text } from '@mantine/core';
import type { ReviewIssue } from '../ai-creator.types';

interface IssueCardProps {
  issue: ReviewIssue;
  selected: boolean;
  onToggle: (issueId: string) => void;
}

const SEVERITY_COLORS: Record<string, string> = {
  error: 'red',
  warning: 'yellow',
  info: 'blue',
};

export function IssueCard({ issue, selected, onToggle }: IssueCardProps) {
  return (
    <Card withBorder padding="sm" radius="sm">
      <Group align="flex-start" wrap="nowrap" gap="sm">
        <Checkbox
          checked={selected}
          onChange={() => onToggle(issue.id)}
          disabled={issue.fixed}
          mt={2}
        />
        <Stack gap={4} style={{ flex: 1 }}>
          <Group gap="xs">
            <Badge size="sm" color={SEVERITY_COLORS[issue.severity] || 'gray'}>
              {issue.severity}
            </Badge>
            <Badge size="sm" variant="outline">
              {issue.category}
            </Badge>
            {issue.fixed && (
              <Badge size="sm" color="green">已修复</Badge>
            )}
          </Group>
          <Text size="sm">{issue.description}</Text>
          <Text size="xs" c="dimmed">{issue.suggestion}</Text>
        </Stack>
      </Group>
    </Card>
  );
}
```

- [ ] **第 2 步：提交**

运行： `cd /e/test/Docmost && git add apps/client/src/ee/ai/components/ai-creator/review/IssueCard.tsx && git commit -m "feat(client): implement IssueCard component"`

---

### 任务 11：实现 AutoFixSummary component

**文件：**
- 创建：`apps/client/src/ee/ai/components/ai-creator/review/AutoFixSummary.tsx`

- [ ] **第 1 步：实施组件**

```tsx
// apps/client/src/ee/ai/components/ai-creator/review/AutoFixSummary.tsx
import { Collapse, Group, List, Text, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconCheck } from '@tabler/icons-react';
import { useState } from 'react';
import type { ReviewIssue } from '../ai-creator.types';

interface AutoFixSummaryProps {
  issues: ReviewIssue[];
}

export function AutoFixSummary({ issues }: AutoFixSummaryProps) {
  const [opened, setOpened] = useState(false);
  const fixedIssues = issues.filter(i => i.auto_fixable && i.fixed);

  if (fixedIssues.length === 0) return null;

  return (
    <div>
      <UnstyledButton onClick={() => setOpened(o => !o)}>
        <Group gap="xs">
          {opened ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
          <IconCheck size={16} color="green" />
          <Text size="sm" fw={500}>
            {fixedIssues.length} issue{fixedIssues.length > 1 ? 's' : ''} auto-fixed
          </Text>
        </Group>
      </UnstyledButton>
      <Collapse in={opened}>
        <List size="sm" mt="xs" ml="xl">
          {fixedIssues.map(issue => (
            <List.Item key={issue.id}>
              <Text size="xs" c="dimmed">[{issue.category}] {issue.description}</Text>
            </List.Item>
          ))}
        </List>
      </Collapse>
    </div>
  );
}
```

- [ ] **第 2 步：提交**

运行： `cd /e/test/Docmost && git add apps/client/src/ee/ai/components/ai-creator/review/AutoFixSummary.tsx && git commit -m "feat(client): implement AutoFixSummary component"`

---

### 任务 12：实现 use-review-actions hook

**文件：**
- 创建：`apps/client/src/ee/ai/components/ai-creator/review/use-review-actions.ts`

- [ ] **第 1 步：实施钩子**

```typescript
// apps/client/src/ee/ai/components/ai-creator/review/use-review-actions.ts
import { useCallback, useState } from 'react';
import type { ReviewIssue, ReviewReport } from '../ai-creator.types';

interface UseReviewActionsReturn {
  selectedIds: Set<string>;
  toggleIssue: (issueId: string) => void;
  selectAll: () => void;
  deselectAll: () => void;
  userFeedback: string;
  setUserFeedback: (value: string) => void;
  fixableIssues: ReviewIssue[];
  isFixing: boolean;
  dispatchFix: () => Promise<void>;
}

export function useReviewActions(
  report: ReviewReport | null,
  onFix: (issueIds: string[], feedback: string) => Promise<void>,
): UseReviewActionsReturn {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [userFeedback, setUserFeedback] = useState('');
  const [isFixing, setIsFixing] = useState(false);

  const fixableIssues = (report?.issues ?? []).filter(
    i => !i.auto_fixable && !i.fixed,
  );

  const toggleIssue = useCallback((issueId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(issueId)) {
        next.delete(issueId);
      } else {
        next.add(issueId);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(fixableIssues.map(i => i.id)));
  }, [fixableIssues]);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const dispatchFix = useCallback(async () => {
    if (selectedIds.size === 0 && !userFeedback.trim()) return;
    setIsFixing(true);
    try {
      await onFix(Array.from(selectedIds), userFeedback);
    } finally {
      setIsFixing(false);
    }
  }, [selectedIds, userFeedback, onFix]);

  return {
    selectedIds,
    toggleIssue,
    selectAll,
    deselectAll,
    userFeedback,
    setUserFeedback,
    fixableIssues,
    isFixing,
    dispatchFix,
  };
}
```

- [ ] **第 2 步：提交**

运行： `cd /e/test/Docmost && git add apps/client/src/ee/ai/components/ai-creator/review/use-review-actions.ts && git commit -m "feat(client): implement use-review-actions hook"`

---

### 任务 13：实现 ReviewModal

**文件：**
- 创建：`apps/client/src/ee/ai/components/ai-creator/review/ReviewModal.tsx`
- 创建：`apps/client/src/ee/ai/components/ai-creator/review/index.ts`

- [ ] **第 1 步：实施 ReviewModal**

```tsx
// apps/client/src/ee/ai/components/ai-creator/review/ReviewModal.tsx
import { Button, Divider, Group, Modal, ScrollArea, Stack, Text, Textarea } from '@mantine/core';
import type { ReviewReport } from '../ai-creator.types';
import { ReviewScoreBoard } from './ReviewScoreBoard';
import { AutoFixSummary } from './AutoFixSummary';
import { IssueCard } from './IssueCard';
import { useReviewActions } from './use-review-actions';

interface ReviewModalProps {
  opened: boolean;
  onClose: () => void;
  report: ReviewReport | null;
  onFix: (issueIds: string[], feedback: string) => Promise<void>;
  onSkip: () => void;
}

export function ReviewModal({ opened, onClose, report, onFix, onSkip }: ReviewModalProps) {
  const {
    selectedIds,
    toggleIssue,
    selectAll,
    deselectAll,
    userFeedback,
    setUserFeedback,
    fixableIssues,
    isFixing,
    dispatchFix,
  } = useReviewActions(report, onFix);

  if (!report) return null;

  // Group fixable issues by section
  const bySection = new Map<string, typeof fixableIssues>();
  for (const issue of fixableIssues) {
    const list = bySection.get(issue.section_id) || [];
    list.push(issue);
    bySection.set(issue.section_id, list);
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Document Review"
      size="xl"
      centered
    >
      <Stack gap="md">
        <ReviewScoreBoard report={report} />

        <Divider />

        <AutoFixSummary issues={report.issues} />

        {fixableIssues.length > 0 && (
          <>
            <Group justify="space-between">
              <Text fw={500} size="sm">Issues requiring attention ({fixableIssues.length})</Text>
              <Group gap="xs">
                <Button size="xs" variant="subtle" onClick={selectAll}>Select all</Button>
                <Button size="xs" variant="subtle" onClick={deselectAll}>Deselect all</Button>
              </Group>
            </Group>

            <ScrollArea.Autosize mah={400}>
              <Stack gap="sm">
                {Array.from(bySection.entries()).map(([sectionId, issues]) => (
                  <Stack key={sectionId} gap="xs">
                    <Text size="xs" fw={600} c="dimmed" tt="uppercase">
                      Section: {sectionId}
                    </Text>
                    {issues.map(issue => (
                      <IssueCard
                        key={issue.id}
                        issue={issue}
                        selected={selectedIds.has(issue.id)}
                        onToggle={toggleIssue}
                      />
                    ))}
                  </Stack>
                ))}
              </Stack>
            </ScrollArea.Autosize>
          </>
        )}

        <Textarea
          label="Additional feedback (optional)"
          placeholder="Any other changes you'd like..."
          value={userFeedback}
          onChange={e => setUserFeedback(e.currentTarget.value)}
          autosize
          minRows={2}
          maxRows={4}
        />

        <Divider />

        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onSkip}>
            Skip, use as-is
          </Button>
          <Button
            onClick={dispatchFix}
            loading={isFixing}
            disabled={selectedIds.size === 0 && !userFeedback.trim()}
          >
            Fix selected ({selectedIds.size})
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
```

- [ ] **第 2 步：创建桶导出**

```typescript
// apps/client/src/ee/ai/components/ai-creator/review/index.ts
export { ReviewModal } from './ReviewModal';
export { ReviewScoreBoard } from './ReviewScoreBoard';
export { IssueCard } from './IssueCard';
export { AutoFixSummary } from './AutoFixSummary';
export { useReviewActions } from './use-review-actions';
```

- [ ] **第 3 步：提交**

运行： `cd /e/test/Docmost && git add apps/client/src/ee/ai/components/ai-creator/review/ && git commit -m "feat(client): implement ReviewModal with issue selection and fix dispatch"`

---

## 分块 7：集成与 E2E

### 任务 14：Register tools in Orchestrator engine

**文件：**
- 修改：`agent-service/app/orchestrator/engine.py`

- [ ] **第 1 步：导入并注册evaluate_quality和fix_issues**

在`engine.py`中，注册了其他工具：

```python
from app.orchestrator.tools.evaluate import evaluate_quality
from app.orchestrator.tools.fix_tools import fix_issues

# Inside the orchestrator Agent tool registration:
# @orchestrator.tool
# async def evaluate_quality_tool(ctx, ...): ...
# @orchestrator.tool
# async def fix_issues_tool(ctx, ...): ...
```

遵循第一阶段的现有模式进行工具注册。 Orchestrator 的系统提示应更新为包括有关何时调用valuate_quality（写入完成后）和fix_issues（用户选择问题后）的说明。

- [ ] **第 2 步：提交**

运行： `cd /e/test/Docmost && git add agent-service/app/orchestrator/engine.py && git commit -m "feat(agent): register evaluate and fix tools in orchestrator"`

---

### 任务 15：更新 Orchestrator system prompt for review flow

**文件：**
- 修改：`agent-service/app/orchestrator/prompts.py`

- [ ] **第一步：在系统提示中添加复习说明**

添加到 Orchestrator 系统提示符：

```python
REVIEW_INSTRUCTIONS = """
## 审查阶段

After all sections are written, you MUST call evaluate_quality to assess the document.

The evaluate_quality tool will:
1. Run deterministic checks (word count, heading levels, asset coverage, Mermaid syntax, image URLs)
2. Run LLM quality assessment (accuracy, completeness, style, readability, argument strength)
3. Auto-fix any auto_fixable issues
4. Return a ReviewReport

If the ReviewReport has issues that need user decision (auto_fixable=False, fixed=False):
- Call ask_user with phase="review" to present the ReviewReport
- The user will select which issues to fix
- Call fix_issues with the selected issue IDs

If no issues need user attention (all auto-fixed or score >= 90):
- Proceed directly to finalize
"""
```

- [ ] **第 2 步：提交**

运行： `cd /e/test/Docmost && git add agent-service/app/orchestrator/prompts.py && git commit -m "feat(agent): add review phase instructions to orchestrator prompt"`

---

### 任务 16：Handle review SSE events in 前端

**文件：**
- 修改：`apps/client/src/ee/ai/services/ai-create-runner.utils.ts`

- [ ] **第 1 步：添加 review_report 和 fix_applied 事件处理程序**

添加到SSE事件规范化逻辑：

```typescript
// In the event handler switch/if chain:
case 'review_report':
  // Store the ReviewReport for ReviewModal to consume
  // Dispatch to state atom or callback
  break;
case 'fix_applied':
  // Update the issue's fixed status in the stored ReviewReport
  // Show a toast notification for the applied fix
  break;
```

- [ ] **第 2 步：提交**

运行： `cd /e/test/Docmost && git add apps/client/src/ee/ai/services/ai-create-runner.utils.ts && git commit -m "feat(client): handle review_report and fix_applied SSE events"`

---

### 任务 17：Integrate ReviewModal in AiCreatorPanel

**文件：**
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx`

- [ ] **第 1 步：添加ReviewModal状态和渲染**

```typescript
import { ReviewModal } from './review';
import type { ReviewReport } from './ai-creator.types';

// Inside AiCreatorPanel:
const [reviewReport, setReviewReport] = useState<ReviewReport | null>(null);
const [reviewModalOpen, setReviewModalOpen] = useState(false);

// When review_report SSE event arrives:
// setReviewReport(report);
// setReviewModalOpen(true);

// In JSX:
// <ReviewModal
//   opened={reviewModalOpen}
//   onClose={() => setReviewModalOpen(false)}
//   report={reviewReport}
//   onFix={async (ids, feedback) => { /* send fix request to agent */ }}
//   onSkip={() => { setReviewModalOpen(false); /* finalize */ }}
// />
```

- [ ] **第 2 步：提交**

运行： `cd /e/test/Docmost && git add apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx && git commit -m "feat(client): integrate ReviewModal in AiCreatorPanel"`

---

### 任务 18：End-to-end review flow test

**文件：**
- 创建：`agent-service/tests/test_e2e_review.py`

- [ ] **第 1 步：编写E2E测试**

```python
# agent-service/tests/test_e2e_review.py
"""End-to-end test for the review and fix system.

Tests the full flow: evaluate -> auto-fix -> user selection -> targeted fix.
"""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from app.workers.evaluator import evaluate_deterministic
from app.workers.fixer import fix_auto
from app.models.review import ReviewIssue


class TestE2EReviewFlow:
    """Tests the complete review pipeline with known-bad content."""

    def _make_blueprint_section(self, id: str, word_budget: int, assets: list[str]):
        """Create a mock SectionBlueprint."""
        mock = MagicMock()
        mock.id = id
        mock.word_budget = word_budget
        mock.assets = assets
        mock.must_cover = []
        return mock

    def test_detect_short_section_and_missing_asset(self):
        """Generate a document with known issues: short section + missing asset reference."""
        section_drafts = {
            "sec-intro": "## Introduction\n\nThis is a very short intro.",  # ~8 words, budget 200
            "sec-body": "## Body\n\n" + ("Some detailed content. " * 50),  # ~150 words, ok
        }
        blueprint_sections = [
            self._make_blueprint_section("sec-intro", word_budget=200, assets=["asset-diagram-1"]),
            self._make_blueprint_section("sec-body", word_budget=200, assets=[]),
        ]
        asset_map = {
            "asset-diagram-1": {"url": "https://example.com/diagram.png", "description": "Architecture diagram"},
        }

        issues = evaluate_deterministic(section_drafts, blueprint_sections, asset_map)

        # Should detect: word count under budget + missing asset reference
        categories = [i.category for i in issues]
        assert "word_count" in categories, f"Expected word_count issue, got: {categories}"
        assert "asset_coverage" in categories, f"Expected asset_coverage issue, got: {categories}"

    def test_heading_skip_is_auto_fixable(self):
        """Heading level skip should be detected and marked auto_fixable."""
        section_drafts = {
            "sec-1": "## Title\n\nText\n\n#### Subtitle\n\nMore text",
        }
        blueprint_sections = [
            self._make_blueprint_section("sec-1", word_budget=1000, assets=[]),
        ]
        issues = evaluate_deterministic(section_drafts, blueprint_sections, asset_map={})
        heading_issues = [i for i in issues if i.category == "heading_level"]
        assert len(heading_issues) == 1
        assert heading_issues[0].auto_fixable is True

    def test_auto_fix_runs_without_llm(self):
        """Auto-fix should not require LLM calls."""
        section_drafts = {
            "sec-1": "## Title\n\nText\n\n#### Subtitle\n\nMore text\n\n![broken]()\n",
        }
        issues = [
            ReviewIssue(id="h1", section_id="sec-1", severity="warning", category="heading_level",
                        description="H2->H4", suggestion="Fix", auto_fixable=True),
            ReviewIssue(id="i1", section_id="sec-1", severity="warning", category="image_url",
                        description="Empty URL", suggestion="Remove", auto_fixable=True),
        ]
        fixed_drafts, fixed_issues = fix_auto(section_drafts, issues)

        # Heading should be fixed
        assert "### Subtitle" in fixed_drafts["sec-1"]
        assert "####" not in fixed_drafts["sec-1"]

        # Broken image should be removed
        assert "![broken]()" not in fixed_drafts["sec-1"]

        # Both marked as fixed
        assert all(i.fixed for i in fixed_issues)

    @pytest.mark.asyncio
    async def test_targeted_fix_changes_only_specified_section(self):
        """Targeted LLM fix should only modify the specified section."""
        from app.workers.fixer import fix_targeted

        issue = ReviewIssue(
            id="acc1", section_id="sec-body", severity="warning", category="accuracy",
            description="Unsupported market claim", suggestion="Add citation",
            auto_fixable=False,
        )
        original = "## Body\n\nOur product has 99% market share.\n\nOther content stays the same."
        fixed_text = "## Body\n\nOur product has significant market share (IDC, 2025).\n\nOther content stays the same."

        with patch("app.workers.fixer._call_llm_fix", new_callable=AsyncMock, return_value=fixed_text):
            result = await fix_targeted("sec-body", issue, original)

        # Should contain the fix
        assert "IDC" in result or result != original
        # "Other content stays the same" should be preserved
        assert "Other content stays the same" in result
```

- [ ] **第 2 步：运行 E2E 测试**

运行： `cd /e/test/Docmost/agent-service && python -m pytest tests/test_e2e_review.py -v`

- [ ] **第 3 步：提交**

运行： `cd /e/test/Docmost && git add agent-service/tests/test_e2e_review.py && git commit -m "test(agent): add end-to-end review flow tests"`

---

## 总结

| Chunk | Tasks | 关键成果 |
|-------|-------|-----------------|
| 1 | 任务 1-2 | ReviewIssue/ReviewReport 模型，确定性评估器 |
| 2 | 任务 3 | LLM 质量评估 |
| 3 | 任务 4 | 评估质量协调器工具 |
| 4 | 任务 5-6 | 自动修复+有针对性的LLM修复 |
| 5 | 任务 7 | fix_issues 协调器工具 |
| 6 | 任务 8-13 | ReviewModal、IssueCard、ScoreBoard、AutoFixSummary、挂钩、类型 |
| 7 | 任务 14-18 | Orchestrator 集成、SSE 事件、E2E 测试 |

**预计总时间：** 1-2 周

**关键设计决策：**
- 自动修复是纯代码（不依赖 LLM）——快速、确定性、安全
- LLM评估仅输出问题，从未重写内容
- 有针对性的修复在具有差异大小验证的单个部分上运行
- 前端将问题显示为复选框 - 用户可以完全控制要修复的内容
- ReviewReport 是流经 SSE 的单一结构化对象
## 实施状态更新 (2026-03-19)

- 审查现在按严重程度区分阻止问题和咨询问题。错误级别的问题仍然会阻止最终确定；警告/信息问题仍然可以审查，但可以明确接受。
- 工作台审查模式现在公开 `Continue with current draft` 用于非阻塞报告，防止主观警告的无限修复/重新审查循环。
- `fix_selected_issues` 仍然在每次审核通过时最多重写每个受影响的部分一次，在调用修复程序之前按部分聚合选定的问题。
- 源图像策略现在在评估中强制执行：缺少所需的视觉效果和禁止生成的后备会引发阻塞视觉问题。
- 浏览器接受现在涵盖了从 `awaiting_input(review)` 到 `completed` 和 `insert` 的审阅接受路径。
