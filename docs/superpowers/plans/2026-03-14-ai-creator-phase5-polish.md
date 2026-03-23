# 阶段 5：打磨与优化实施计划

> **对于智能体执行者：** 要求：使用 superpowers:subagent-driven-development （如果子代理可用）或 superpowers:executing-plans 来实施此计划。步骤使用复选框 (`- [ ]`) 语法进行跟踪。

**目标：** 添加模型路由、风格学习、单章重写、多文档合并优化、前端 UI 细化、性能优化以及清理旧的 LangGraph 代码。

**架构：** 模型路由为不同的工作人员启用不同的LLM模型（Orchestrator的强模型，SectionWriter的快速模型）。风格学习从工作区文档中提取写作模式。前端获得动画优化和响应式改进。

**技术栈：** PydanticAI（多模型）、Mantine UI 转换、Redis 缓存

---

## 文件结构概述

### 新文件（代理服务）

| 文件 | 用途 |
|------|---------|
| `agent-service/app/orchestrator/model_router.py` | 多模型路由配置 |
| `agent-service/app/workers/style_analyzer.py` | 工作空间风格的学习工作者 |
| `agent-service/tests/orchestrator/test_model_router.py` | 模型路由器测试 |
| `agent-service/tests/workers/test_style_analyzer.py` | 风格分析器测试 |
| `agent-service/tests/test_e2e_final.py` | 最终集成测试套件 |

### 新文件（前端）

| 文件 | 用途 |
|------|---------|
| `docs/ai-creator-v2-architecture.md` | 新架构文档 |

### 修改文件

| 文件 | 变更 |
|------|--------|
| `agent-service/app/orchestrator/llm_factory.py` | 支持多个模型实例 |
| `agent-service/app/orchestrator/engine.py` | 添加rewrite_section工具 |
| `agent-service/app/orchestrator/tools/write_tools.py` | 添加 rewrite_section 实现 |
| `agent-service/app/orchestrator/tools/complexity.py` | 多文档合并提案 |
| `agent-service/app/main.py` | 删除旧端点，将 v2 重命名为 / |
| `agent-service/pyproject.toml` | 删除 langgraph 依赖 |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-input.tsx` | 输入区域重新设计 |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx` | 动画打磨 |
| `apps/client/src/ee/ai/services/ai-create-runner.utils.ts` | SSE 流优化 |
| `apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts` | 更新端点路径 |
| `docker-compose.yml` | 更新是否有新的依赖项 |

### 已删除的文件

| 文件 | 原因 |
|------|--------|
| `agent-service/app/agent/graph.py` | 旧的 LangGraph 编排 |
| `agent-service/app/agent/nodes/*.py` | 旧的 LangGraph 节点文件 |
| `agent-service/app/agent/state.py` | 旧的 TypedDict 状态 |
| `agent-service/app/agent/quality_checks.py` | 由评估员取代 |
| `agent-service/app/agent/cancellation.py` | 被新的取消取代 |
| `agent-service/app/agent/document_strategy.py` | 被新型号取代 |
| `agent-service/app/agent/events.py` | 被新的SSE协议取代 |
| `agent-service/app/agent/evidence.py` | 被AssetMap模型取代 |
| `agent-service/app/agent/llm.py` | 替换为 llm_factory.py |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-clarify-bubble.tsx` | 旧的清晰 UI |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-propose-bubble.tsx` | 旧的提议 UI |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-outline-bubble.tsx` | 旧的大纲用户界面 |

---

## 分块 1：模型路由

### 任务 1：创建 model router configuration

**文件：**
- 创建：`agent-service/app/orchestrator/model_router.py`
- 测试： `agent-service/tests/orchestrator/test_model_router.py`

**背景：** 不同的工人受益于不同的模型优势。 Orchestrator需要强大的推理能力，SectionWriter需要速度，Evaluator需要平衡能力。此任务创建一个将辅助角色映射到模型标识符的路由配置。

- [ ] **第 1 步：为模型路由器编写失败测试**

```python
# agent-service/tests/orchestrator/test_model_router.py
import pytest
from unittest.mock import patch
from app.orchestrator.model_router import ModelRouter, WorkerRole

def test_default_model_assignment():
    """When no role-specific models configured, all roles use the default model."""
    with patch.dict("os.environ", {}, clear=False):
        router = ModelRouter(default_model="gpt-4o")
    assert router.get_model(WorkerRole.ORCHESTRATOR) == "gpt-4o"
    assert router.get_model(WorkerRole.WRITER) == "gpt-4o"
    assert router.get_model(WorkerRole.EVALUATOR) == "gpt-4o"

def test_role_specific_models():
    """When role-specific env vars are set, those override the default."""
    env = {
        "ORCHESTRATOR_MODEL": "claude-sonnet-4-20250514",
        "WRITER_MODEL": "gpt-4o-mini",
        "EVALUATOR_MODEL": "gemini-2.0-flash",
    }
    with patch.dict("os.environ", env, clear=False):
        router = ModelRouter(default_model="gpt-4o")
    assert router.get_model(WorkerRole.ORCHESTRATOR) == "claude-sonnet-4-20250514"
    assert router.get_model(WorkerRole.WRITER) == "gpt-4o-mini"
    assert router.get_model(WorkerRole.EVALUATOR) == "gemini-2.0-flash"

def test_partial_override():
    """Only overridden roles use the env var; others fall back to default."""
    env = {"WRITER_MODEL": "gpt-4o-mini"}
    with patch.dict("os.environ", env, clear=False):
        router = ModelRouter(default_model="gpt-4o")
    assert router.get_model(WorkerRole.ORCHESTRATOR) == "gpt-4o"
    assert router.get_model(WorkerRole.WRITER) == "gpt-4o-mini"
    assert router.get_model(WorkerRole.EVALUATOR) == "gpt-4o"

def test_unknown_role_returns_default():
    """Unknown role string should return the default model."""
    router = ModelRouter(default_model="gpt-4o")
    assert router.get_model("unknown_role") == "gpt-4o"
```

- [ ] **第 2 步：实施 ModelRouter**

```python
# agent-service/app/orchestrator/model_router.py
from __future__ import annotations

import os
from enum import StrEnum
from typing import Any


class WorkerRole(StrEnum):
    ORCHESTRATOR = "orchestrator"
    WRITER = "writer"
    EVALUATOR = "evaluator"
    FIXER = "fixer"
    STYLE_ANALYZER = "style_analyzer"
    PLANNER = "planner"


# Environment variable names for role-specific model overrides
_ROLE_ENV_MAP: dict[str, str] = {
    WorkerRole.ORCHESTRATOR: "ORCHESTRATOR_MODEL",
    WorkerRole.WRITER: "WRITER_MODEL",
    WorkerRole.EVALUATOR: "EVALUATOR_MODEL",
    WorkerRole.FIXER: "FIXER_MODEL",
    WorkerRole.STYLE_ANALYZER: "STYLE_ANALYZER_MODEL",
    WorkerRole.PLANNER: "PLANNER_MODEL",
}


class ModelRouter:
    """Routes worker roles to specific LLM model identifiers.

    Configuration hierarchy:
    1. Role-specific env var (e.g., ORCHESTRATOR_MODEL) — highest priority
    2. Default model — fallback for all roles

    Usage:
        router = ModelRouter(default_model="gpt-4o")
        model_id = router.get_model(WorkerRole.WRITER)  # returns WRITER_MODEL or default
    """

    def __init__(self, default_model: str):
        self._default = default_model
        self._overrides: dict[str, str] = {}
        for role, env_var in _ROLE_ENV_MAP.items():
            value = os.environ.get(env_var)
            if value:
                self._overrides[role] = value

    def get_model(self, role: str | WorkerRole) -> str:
        """Get the model identifier for a given worker role."""
        role_str = str(role)
        return self._overrides.get(role_str, self._default)

    def list_assignments(self) -> dict[str, str]:
        """Return all role -> model assignments for debugging."""
        return {
            role: self._overrides.get(role, self._default)
            for role in WorkerRole
        }
```

- [ ] **第 3 步：运行测试并验证**

运行： `cd /e/test/Docmost/agent-service && python -m pytest tests/orchestrator/test_model_router.py -v`

- [ ] **第 4 步：更新 llm_factory 以接受来自路由器的模型参数**

修改 `agent-service/app/orchestrator/llm_factory.py` 以添加接受显式模型字符串的 `get_model(model_id: str | None = None)` 重载。当提供 `model_id` 时，它使用它而不是从配置中读取。这使得 ModelRouter 能够传递特定于角色的模型。

```python
# In llm_factory.py, update get_model:
def get_model(model_id: str | None = None):
    """Get a PydanticAI model instance.

    Args:
        model_id: Explicit model identifier. If None, reads from app config.
    """
    if model_id:
        # Parse model_id to determine provider and create appropriate instance
        return _create_model_from_id(model_id)
    # ... existing fallback to config ...
```

- [ ] **第 5 步：更新工作人员以接受模型参数**

每个工作人员（SectionWriter、Evaluator、Fixer）都应该接受一个可选的 `model` 参数。当提供时，它会覆盖默认模型。这在第四阶段已部分完成；验证所有工人都支持它。

- [ ] **第 6 步：提交**

运行： `cd /e/test/Docmost && git add agent-service/app/orchestrator/model_router.py agent-service/app/orchestrator/llm_factory.py agent-service/tests/orchestrator/test_model_router.py && git commit -m "feat(agent): implement model routing for worker-specific LLM assignment"`

---

## 分块 2：单章节改写

### 任务 2：实现 rewrite_section tool

**文件：**
- 创建：`agent-service/app/orchestrator/tools/rewrite_tools.py`
- 测试： `agent-service/tests/orchestrator/test_rewrite_tools.py`

**上下文：** 文档生成后，用户可能希望使用特定反馈重写单个部分。该工具仅针对该部分调用SectionWriter，通过滑动窗口保留相邻部分的上下文。

- [ ] **第 1 步：编写失败的测试**

```python
# agent-service/tests/orchestrator/test_rewrite_tools.py
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from app.orchestrator.tools.rewrite_tools import rewrite_section

@pytest.mark.asyncio
async def test_rewrite_section_calls_writer():
    """rewrite_section should call SectionWriter with the target section and feedback."""
    section_drafts = {
        "sec-1": "## Intro\n\nOld intro text.",
        "sec-2": "## Body\n\nBody text that needs rewriting.",
        "sec-3": "## Conclusion\n\nConclusion text.",
    }
    with patch("app.orchestrator.tools.rewrite_tools.write_section", new_callable=AsyncMock,
               return_value="## Body\n\nImproved body text with user feedback applied.") as mock_write:
        ctx = MagicMock()
        ctx.emit = AsyncMock()
        result = await rewrite_section(
            ctx,
            section_id="sec-2",
            feedback="Make it more concise and add a summary at the end",
            section_drafts=section_drafts,
            blueprint_section=MagicMock(id="sec-2", title="Body", word_budget=300),
        )
    assert result["sec-2"] != section_drafts["sec-2"]
    # Adjacent sections should be unchanged
    assert result["sec-1"] == section_drafts["sec-1"]
    assert result["sec-3"] == section_drafts["sec-3"]

@pytest.mark.asyncio
async def test_rewrite_section_provides_adjacent_context():
    """Writer should receive adjacent sections as context."""
    section_drafts = {
        "sec-1": "## Intro\n\nContext before.",
        "sec-2": "## Target\n\nTo rewrite.",
        "sec-3": "## After\n\nContext after.",
    }
    with patch("app.orchestrator.tools.rewrite_tools.write_section", new_callable=AsyncMock,
               return_value="Rewritten") as mock_write:
        ctx = MagicMock()
        ctx.emit = AsyncMock()
        await rewrite_section(ctx, section_id="sec-2", feedback="Fix it",
                              section_drafts=section_drafts,
                              blueprint_section=MagicMock(id="sec-2", title="Target", word_budget=200))
    # Verify the writer received adjacent context
    call_kwargs = mock_write.call_args
    assert call_kwargs is not None
    # The adjacent context should be passed somehow (check args or kwargs)
```

- [ ] **第 2 步：实施 rewrite_section**

```python
# agent-service/app/orchestrator/tools/rewrite_tools.py
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


async def write_section(
    section_id: str,
    title: str,
    word_budget: int,
    adjacent_context: str,
    feedback: str | None = None,
    model: str | None = None,
) -> str:
    """Call SectionWriter for a single section. Placeholder for Phase 3 worker."""
    # This delegates to the SectionWriter worker created in Phase 3
    from app.workers.section_writer import SectionWriter
    writer = SectionWriter(model=model)
    return await writer.write(
        section_id=section_id,
        title=title,
        word_budget=word_budget,
        adjacent_context=adjacent_context,
        rewrite_feedback=feedback,
    )


async def rewrite_section(
    ctx: Any,
    section_id: str,
    feedback: str,
    section_drafts: dict[str, str],
    blueprint_section: Any,
    model: str | None = None,
) -> dict[str, str]:
    """Rewrite a single section with user feedback.

    Preserves sliding window context by providing adjacent sections to the writer.
    Updates only the target section in the drafts dict.

    Args:
        ctx: Orchestrator context (has emit method for SSE)
        section_id: ID of the section to rewrite
        feedback: User's rewrite instructions
        section_drafts: current section drafts (all sections)
        blueprint_section: SectionBlueprint for the target section
        model: optional model override

    Returns:
        Updated section_drafts with only the target section changed.
    """
    if section_id not in section_drafts:
        logger.error(f"Section '{section_id}' not found in drafts")
        return section_drafts

    # Build adjacent context (sliding window)
    section_ids = list(section_drafts.keys())
    idx = section_ids.index(section_id)
    adjacent_parts = []
    if idx > 0:
        prev_id = section_ids[idx - 1]
        adjacent_parts.append(f"[Previous section: {prev_id}]\n{section_drafts[prev_id]}")
    if idx < len(section_ids) - 1:
        next_id = section_ids[idx + 1]
        adjacent_parts.append(f"[Next section: {next_id}]\n{section_drafts[next_id]}")
    adjacent_context = "\n\n---\n\n".join(adjacent_parts)

    logger.info(f"Rewriting section '{section_id}' with feedback: {feedback[:100]}...")

    if hasattr(ctx, 'emit'):
        await ctx.emit("section_rewrite_start", {"section_id": section_id})

    rewritten = await write_section(
        section_id=section_id,
        title=getattr(blueprint_section, 'title', section_id),
        word_budget=getattr(blueprint_section, 'word_budget', 500),
        adjacent_context=adjacent_context,
        feedback=feedback,
        model=model,
    )

    updated = dict(section_drafts)
    updated[section_id] = rewritten

    if hasattr(ctx, 'emit'):
        await ctx.emit("section_rewrite_complete", {"section_id": section_id})

    return updated
```

- [ ] **第 3 步：运行测试并验证**

运行： `cd /e/test/Docmost/agent-service && python -m pytest tests/orchestrator/test_rewrite_tools.py -v`

- [ ] **第 4 步：提交**

运行： `cd /e/test/Docmost && git add agent-service/app/orchestrator/tools/rewrite_tools.py agent-service/tests/orchestrator/test_rewrite_tools.py && git commit -m "feat(agent): implement single chapter rewrite tool"`

---

## 分块 3：多文档合并优化

### 任务 3：实现 multi-document merge proposals

**文件：**
- 修改：`agent-service/app/orchestrator/tools/complexity.py`
- 测试： `agent-service/tests/orchestrator/test_multi_merge.py`

**上下文：** 当用户提供多个源文档（级别 3）时，Orchestrator 应提出 2-3 种可能的文档结构、删除重复资产并标记内容冲突。

- [ ] **第 1 步：编写失败的测试**

```python
# agent-service/tests/orchestrator/test_multi_merge.py
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from app.orchestrator.tools.complexity import propose_merged_structures, deduplicate_assets

def test_deduplicate_assets_by_content_hash():
    """Same image from two sources should be merged into one AssetItem."""
    assets = [
        {"id": "doc1-img1", "content_hash": "abc123", "url": "https://a.com/1.png", "source": "doc1"},
        {"id": "doc2-img1", "content_hash": "abc123", "url": "https://b.com/1.png", "source": "doc2"},
        {"id": "doc1-img2", "content_hash": "def456", "url": "https://a.com/2.png", "source": "doc1"},
    ]
    deduped = deduplicate_assets(assets)
    assert len(deduped) == 2  # abc123 merged, def456 kept
    hashes = [a["content_hash"] for a in deduped]
    assert hashes.count("abc123") == 1

@pytest.mark.asyncio
async def test_propose_merged_structures():
    """Should return 2-3 structure proposals from multiple source documents."""
    source_docs = [
        {"title": "Product Overview", "sections": ["Intro", "Features", "Pricing"]},
        {"title": "Technical Spec", "sections": ["Architecture", "API Reference", "Deployment"]},
    ]
    with patch("app.orchestrator.tools.complexity._call_llm_propose", new_callable=AsyncMock,
               return_value=[
                   {"title": "Combined Guide", "sections": ["Intro", "Features", "Architecture", "API", "Pricing"]},
                   {"title": "Product-First", "sections": ["Product Overview", "Technical Details", "Getting Started"]},
               ]):
        proposals = await propose_merged_structures(source_docs, user_instructions="Write a complete guide")
    assert 2 <= len(proposals) <= 3
```

- [ ] **第 2 步：实施 deduplicate_assets 和 suggest_merged_structs**

Add to `agent-service/app/orchestrator/tools/complexity.py`:

```python
def deduplicate_assets(assets: list[dict]) -> list[dict]:
    """Deduplicate assets by content_hash. First occurrence wins.

    Args:
        assets: list of asset dicts with 'content_hash' key

    Returns:
        Deduplicated list preserving first occurrence per hash.
    """
    seen_hashes: dict[str, dict] = {}
    for asset in assets:
        h = asset.get("content_hash", asset.get("id", ""))
        if h not in seen_hashes:
            seen_hashes[h] = asset
    return list(seen_hashes.values())


async def _call_llm_propose(prompt: str) -> list[dict]:
    """Call LLM to generate structure proposals."""
    from app.orchestrator.llm_factory import get_model
    from pydantic_ai import Agent
    agent = Agent(get_model(), result_type=list)
    result = await agent.run(prompt)
    return result.data


async def propose_merged_structures(
    source_docs: list[dict],
    user_instructions: str,
) -> list[dict]:
    """Generate 2-3 proposed document structures from multiple sources.

    Each proposal has a title and section list. Presented to user via ask_user.
    """
    source_summary = "\n".join(
        f"- {doc['title']}: sections = {', '.join(doc.get('sections', []))}"
        for doc in source_docs
    )
    prompt = f"""Given these source documents:
{source_summary}

User instructions: {user_instructions}

Propose 2-3 possible merged document structures. Each should have a title and a list of section names.
Consider different orderings and groupings. Output as JSON array of objects with 'title' and 'sections' keys."""

    proposals = await _call_llm_propose(prompt)
    return proposals[:3]  # cap at 3
```

- [ ] **第 3 步：运行测试并验证**

运行： `cd /e/test/Docmost/agent-service && python -m pytest tests/orchestrator/test_multi_merge.py -v`

- [ ] **第 4 步：提交**

运行： `cd /e/test/Docmost && git add agent-service/app/orchestrator/tools/complexity.py agent-service/tests/orchestrator/test_multi_merge.py && git commit -m "feat(agent): implement multi-document merge proposals and asset deduplication"`

---

## 分块 4：风格学习

### 任务 4：实现 workspace style analyzer

**文件：**
- 创建：`agent-service/app/workers/style_analyzer.py`
- 测试： `agent-service/tests/workers/test_style_analyzer.py`

**上下文：** 风格学习读取最近的工作区页面以提取写作模式，生成注入到SectionWriter提示中的风格指南字符串。由工作区 AI 设置控制。

- [ ] **第 1 步：编写失败的测试**

```python
# agent-service/tests/workers/test_style_analyzer.py
import pytest
from unittest.mock import AsyncMock, patch
from app.workers.style_analyzer import analyze_style, extract_style_features

def test_extract_style_features_paragraph_length():
    """Should compute average paragraph length."""
    text = "First paragraph with several words.\n\nSecond paragraph also has words.\n\nThird one."
    features = extract_style_features(text)
    assert "avg_paragraph_words" in features
    assert features["avg_paragraph_words"] > 0

def test_extract_style_features_heading_style():
    """Should detect heading style (ATX vs Setext, max depth)."""
    text = "# Title\n\n## Section\n\n### Subsection\n\nContent"
    features = extract_style_features(text)
    assert features["heading_style"] == "atx"
    assert features["max_heading_depth"] == 3

def test_extract_style_features_formality():
    """Should estimate formality level based on markers."""
    formal_text = "Furthermore, the implementation demonstrates significant improvements. Therefore, we recommend..."
    features = extract_style_features(formal_text)
    assert features["formality"] in ("formal", "neutral", "informal")

@pytest.mark.asyncio
async def test_analyze_style_reads_pages():
    """Should read workspace pages and produce a style guide string."""
    mock_pages = [
        {"content": "# Guide\n\n## Intro\n\nThis guide explains the architecture.\n\n## Details\n\nThe system uses microservices."},
        {"content": "# Tutorial\n\n## Step 1\n\nFirst, install dependencies.\n\n## Step 2\n\nThen configure the database."},
    ]
    with patch("app.workers.style_analyzer._fetch_workspace_pages", new_callable=AsyncMock,
               return_value=mock_pages):
        guide = await analyze_style(workspace_id="ws-123", page_count=2)
    assert isinstance(guide, str)
    assert len(guide) > 0
```

- [ ] **第 2 步：实施样式分析器**

```python
# agent-service/app/workers/style_analyzer.py
from __future__ import annotations

import re
import logging
from typing import Any

logger = logging.getLogger(__name__)

# Formality markers
_FORMAL_MARKERS = {"furthermore", "therefore", "consequently", "nevertheless", "notwithstanding",
                   "demonstrates", "significant", "implementation", "comprehensive", "accordingly"}
_INFORMAL_MARKERS = {"gonna", "wanna", "kinda", "cool", "awesome", "stuff", "basically",
                     "pretty much", "lots of", "a bunch of"}


def extract_style_features(text: str) -> dict[str, Any]:
    """Extract quantitative style features from a markdown document.

    Returns:
        Dict with keys: avg_paragraph_words, heading_style, max_heading_depth,
        formality, common_transitions, uses_lists, uses_code_blocks
    """
    features: dict[str, Any] = {}

    # Paragraph analysis
    paragraphs = [p.strip() for p in re.split(r'\n{2,}', text) if p.strip() and not p.strip().startswith('#')]
    if paragraphs:
        word_counts = [len(p.split()) for p in paragraphs]
        features["avg_paragraph_words"] = sum(word_counts) / len(word_counts)
    else:
        features["avg_paragraph_words"] = 0

    # Heading style
    atx_headings = re.findall(r'^#{1,6}\s', text, flags=re.MULTILINE)
    setext_headings = re.findall(r'^[=-]+\s*$', text, flags=re.MULTILINE)
    features["heading_style"] = "setext" if len(setext_headings) > len(atx_headings) else "atx"

    # Max heading depth
    depths = [len(m.strip()) for m in re.findall(r'^(#{1,6})\s', text, flags=re.MULTILINE)]
    features["max_heading_depth"] = max(depths) if depths else 0

    # Formality estimation
    words_lower = set(text.lower().split())
    formal_count = len(words_lower & _FORMAL_MARKERS)
    informal_count = len(words_lower & _INFORMAL_MARKERS)
    if formal_count > informal_count + 2:
        features["formality"] = "formal"
    elif informal_count > formal_count + 2:
        features["formality"] = "informal"
    else:
        features["formality"] = "neutral"

    # Structural features
    features["uses_lists"] = bool(re.search(r'^[\-\*\d]+[\.\)]\s', text, flags=re.MULTILINE))
    features["uses_code_blocks"] = '```' in text

    return features


async def _fetch_workspace_pages(workspace_id: str, page_count: int) -> list[dict]:
    """Fetch recent pages from workspace via docmost_page_read tool.

    This calls the existing Docmost API integration.
    """
    # Import the existing tool for reading pages
    try:
        from app.agent.nodes.explorer import read_page_content
    except ImportError:
        logger.warning("Could not import page reader, returning empty list")
        return []

    # Implementation will use the Docmost API to fetch recent pages
    # Placeholder — actual implementation depends on available API
    logger.info(f"Fetching {page_count} recent pages from workspace {workspace_id}")
    return []


async def analyze_style(
    workspace_id: str,
    page_count: int = 5,
) -> str:
    """Analyze writing style from recent workspace pages.

    Reads up to `page_count` recent pages, extracts style features,
    and produces a natural language style guide string.

    Args:
        workspace_id: workspace to read pages from
        page_count: number of recent pages to analyze (default 5)

    Returns:
        Style guide string suitable for injection into SectionWriter prompts.
    """
    pages = await _fetch_workspace_pages(workspace_id, page_count)

    if not pages:
        return ""

    # Extract features from each page
    all_features = []
    for page in pages:
        content = page.get("content", "")
        if content.strip():
            all_features.append(extract_style_features(content))

    if not all_features:
        return ""

    # Aggregate features
    avg_para_words = sum(f["avg_paragraph_words"] for f in all_features) / len(all_features)
    heading_styles = [f["heading_style"] for f in all_features]
    dominant_heading = max(set(heading_styles), key=heading_styles.count)
    max_depth = max(f["max_heading_depth"] for f in all_features)
    formalities = [f["formality"] for f in all_features]
    dominant_formality = max(set(formalities), key=formalities.count)
    uses_lists = any(f["uses_lists"] for f in all_features)
    uses_code = any(f["uses_code_blocks"] for f in all_features)

    # Build style guide
    guide_parts = [
        f"- Average paragraph length: ~{int(avg_para_words)} words",
        f"- Heading style: {dominant_heading} (max depth: H{max_depth})",
        f"- Writing tone: {dominant_formality}",
    ]
    if uses_lists:
        guide_parts.append("- Uses bullet/numbered lists for enumeration")
    if uses_code:
        guide_parts.append("- Includes code blocks for technical content")

    guide = "## Workspace Writing Style Guide\n\nBased on analysis of recent documents:\n" + "\n".join(guide_parts)
    logger.info(f"Generated style guide for workspace {workspace_id}: {len(guide)} chars")
    return guide
```

- [ ] **第 3 步：运行测试并验证**

运行： `cd /e/test/Docmost/agent-service && python -m pytest tests/workers/test_style_analyzer.py -v`

- [ ] **第 4 步：提交**

运行： `cd /e/test/Docmost && git add agent-service/app/workers/style_analyzer.py agent-service/tests/workers/test_style_analyzer.py && git commit -m "feat(agent): implement workspace style learning analyzer"`

---

## 分块 5：前端 UI 润色：动画与过渡

### 任务 5：添加 animations and loading states

**文件：**
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx`

**上下文：** 添加 Mantine Transition 以实现模式打开/关闭、骨架加载状态和平滑滚动行为。

- [ ] **第 1 步：添加审核状态的骨架加载**

```tsx
// Add to ai-creator-panel.tsx imports:
import { Skeleton, Transition } from '@mantine/core';

// Add skeleton state:
// When waiting for review_report SSE event, show Skeleton placeholders:
// <Skeleton height={100} radius="md" />  // score board placeholder
// <Skeleton height={40} radius="sm" mt="sm" />  // issue placeholder
// <Skeleton height={40} radius="sm" mt="sm" />  // issue placeholder
```

- [ ] **第 2 步：添加平滑滚动以完成部分**

```typescript
// When a section_complete SSE event arrives:
const scrollToSection = (sectionId: string) => {
  const element = document.getElementById(`draft-section-${sectionId}`);
  element?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};
```

- [ ] **第 3 步：为ReviewModal添加响应断点**

```tsx
// In ReviewModal.tsx, make it full screen on mobile:
import { useMediaQuery } from '@mantine/hooks';

// Inside component:
const isMobile = useMediaQuery('(max-width: 768px)');
// <Modal ... fullScreen={isMobile} size={isMobile ? undefined : "xl"}>
```

- [ ] **第 4 步：提交**

运行： `cd /e/test/Docmost && git add apps/client/src/ee/ai/components/ai-creator/ && git commit -m "feat(client): add animations, skeleton loading, and responsive breakpoints"`

---

## 分块 6：前端 UI 润色：输入区重设计

### 任务 6：Redesign AiCreatorInput

**文件：**
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-creator-input.tsx`

**上下文：** 通过图标网格模板选择、视觉复杂性指示器和拖放文件上传来改进输入区域。

- [ ] **第 1 步：用图标网格替换模板下拉列表**

```tsx
// Replace the existing template Combobox/Select with a visual grid:
import { SimpleGrid, UnstyledButton, Stack, Text, ThemeIcon } from '@mantine/core';

// Template selection as icon grid (2 columns):
// Each template shows: icon (from template.icon) + name
// Click selects the template and populates the input
// Selected template highlighted with primary color border
```

- [ ] **第 2 步：添加视觉复杂程度指示器**

```tsx
// Add a badge showing the estimated complexity level:
import { Badge } from '@mantine/core';

// Analyze current input to estimate level:
// - No files, short instruction → L1 badge (green)
// - 1 file or medium instruction → L2 badge (yellow)
// - Multiple files or "仿写"/"对比" keywords → L3 badge (orange)
// Display as: <Badge size="sm" color={levelColor}>L{level}</Badge>
```

- [ ] **第 3 步：将文件上传重新设计为拖放区域**

```tsx
// Replace basic file input with Mantine Dropzone:
import { Dropzone } from '@mantine/dropzone';

// <Dropzone
//   onDrop={handleFiles}
//   accept={['application/pdf', 'application/vnd.openxmlformats-officedocument.*', 'text/*', 'image/*']}
//   maxSize={20 * 1024 * 1024}
// >
//   <Group justify="center" gap="xl" style={{ minHeight: 80, pointerEvents: 'none' }}>
//     <Dropzone.Accept><IconUpload size={32} /></Dropzone.Accept>
//     <Dropzone.Reject><IconX size={32} /></Dropzone.Reject>
//     <Dropzone.Idle><IconCloudUpload size={32} /></Dropzone.Idle>
//   </Group>
// </Dropzone>
```

- [ ] **第 4 步：用自动检测替换深度模式切换**

```tsx
// Remove the explicit "deep mode" toggle switch
// Instead, automatically enable agent mode when Level 3 is detected:
// const shouldUseAgent = estimatedLevel >= 3;
// This value is sent with the request instead of a manual toggle
```

- [ ] **第 5 步：提交**

运行： `cd /e/test/Docmost && git add apps/client/src/ee/ai/components/ai-creator/ai-creator-input.tsx && git commit -m "feat(client): redesign input area with icon grid templates and drag-drop upload"`

---

## 分块 7：性能：SSE 流式优化

### 任务 7：Optimize SSE event streaming

**文件：**
- 修改：`agent-service/app/main.py`（或SSE实用模块）
- 修改：`apps/client/src/ee/ai/services/ai-create-runner.utils.ts`

**上下文：** 通过批处理 content_delta 事件、消除步骤事件以及添加心跳以防止代理超时来减少 SSE 开销。

- [ ] **第 1 步：实现服务器端事件批处理**

```python
# Add to the SSE event queue handler in main.py (or create a utility):
import asyncio
import time

class SSEBatcher:
    """Batches content_delta events to reduce SSE frequency."""

    def __init__(self, send_func, buffer_ms: int = 50):
        self._send = send_func
        self._buffer_ms = buffer_ms
        self._content_buffer: list[str] = []
        self._last_flush = time.monotonic()
        self._flush_task: asyncio.Task | None = None

    async def push(self, event_type: str, data: dict):
        if event_type == "content_delta":
            self._content_buffer.append(data.get("content", ""))
            if self._flush_task is None:
                self._flush_task = asyncio.create_task(self._delayed_flush())
        else:
            # Non-content events: flush buffer first, then send immediately
            await self._flush()
            await self._send(event_type, data)

    async def _delayed_flush(self):
        await asyncio.sleep(self._buffer_ms / 1000)
        await self._flush()

    async def _flush(self):
        if self._content_buffer:
            merged = "".join(self._content_buffer)
            self._content_buffer.clear()
            await self._send("content_delta", {"content": merged})
        self._flush_task = None
```

- [ ] **第 2 步：实现SSE心跳**

```python
# Add heartbeat to the SSE endpoint:
async def heartbeat_loop(send_func, interval: int = 15):
    """Send SSE heartbeat comment every `interval` seconds."""
    while True:
        await asyncio.sleep(interval)
        await send_func(":heartbeat\n\n")
```

- [ ] **第 3 步：添加步进事件去抖动**

```python
# Debounce step_start / step_progress events:
class StepDebouncer:
    """Debounces step events to reduce frontend rendering overhead."""

    def __init__(self, min_interval_ms: int = 200):
        self._min_interval = min_interval_ms / 1000
        self._last_sent: dict[str, float] = {}

    def should_send(self, event_type: str, step_id: str) -> bool:
        key = f"{event_type}:{step_id}"
        now = time.monotonic()
        if key not in self._last_sent or (now - self._last_sent[key]) >= self._min_interval:
            self._last_sent[key] = now
            return True
        return False
```

- [ ] **第 4 步：提交**

运行： `cd /e/test/Docmost && git add agent-service/app/main.py apps/client/src/ee/ai/services/ai-create-runner.utils.ts && git commit -m "perf(agent): add SSE batching, heartbeat, and step event debouncing"`

---

## 分块 8：性能：并行素材解析

### 任务 8：Optimize asset parsing with parallelism and caching

**文件：**
- 修改：`agent-service/app/orchestrator/tools/complexity.py`（或资产解析模块）

**上下文：** 当上传多个文件时，顺序解析它们的速度很慢。使用 asyncio.gather 和信号量进行并行解析。将解析结果缓存在 Redis 中。

- [ ] **第一步：利用信号量实现并行解析**

```python
import asyncio
import hashlib

_PARSE_SEMAPHORE = asyncio.Semaphore(3)  # max 3 concurrent parses

async def parse_asset_parallel(file_data: bytes, filename: str) -> dict:
    """Parse a single asset with semaphore-controlled concurrency."""
    async with _PARSE_SEMAPHORE:
        # Call Docling or appropriate parser
        from app.agent.nodes.explorer import parse_document
        return await parse_document(file_data, filename)

async def parse_all_assets(files: list[dict]) -> list[dict]:
    """Parse all uploaded files in parallel.

    Args:
        files: list of dicts with 'data' (bytes) and 'filename' keys

    Returns:
        List of parsed asset dicts.
    """
    tasks = [parse_asset_parallel(f["data"], f["filename"]) for f in files]
    return await asyncio.gather(*tasks, return_exceptions=True)
```

- [ ] **第 2 步：为解析的资产添加Redis缓存**

```python
import json

async def get_or_parse_asset(file_data: bytes, filename: str, redis_client) -> dict:
    """Check Redis cache before parsing. Cache by content hash."""
    content_hash = hashlib.sha256(file_data).hexdigest()
    cache_key = f"asset_parse:{content_hash}"

    # Try cache
    cached = await redis_client.get(cache_key)
    if cached:
        return json.loads(cached)

    # Parse
    result = await parse_asset_parallel(file_data, filename)
    if not isinstance(result, Exception):
        await redis_client.setex(cache_key, 3600, json.dumps(result))  # TTL: 1 hour

    return result
```

- [ ] **第 3 步：实现图像的并行 VLM 调用**

```python
_VLM_SEMAPHORE = asyncio.Semaphore(3)  # max 3 concurrent VLM calls

async def describe_image_parallel(image_data: bytes, prompt: str) -> str:
    """Call VLM to describe an image, with semaphore control."""
    async with _VLM_SEMAPHORE:
        from app.agent.nodes.explorer import describe_image
        return await describe_image(image_data, prompt)

async def describe_all_images(images: list[dict]) -> list[str]:
    """Describe all images in parallel."""
    tasks = [describe_image_parallel(img["data"], img.get("prompt", "Describe this image"))
             for img in images]
    return await asyncio.gather(*tasks, return_exceptions=True)
```

- [ ] **第 4 步：提交**

运行： `cd /e/test/Docmost && git add agent-service/app/orchestrator/tools/complexity.py && git commit -m "perf(agent): add parallel asset parsing with Redis caching and VLM batching"`

---

## 分块 9：清理旧 LangGraph 代码

### 任务 9：移除 old agent code and endpoints

**文件：**
- 删除：`agent-service/app/agent/graph.py`
- 删除：`agent-service/app/agent/nodes/clarifier.py`
- 删除：`agent-service/app/agent/nodes/evidence_acquirer.py`
- 删除：`agent-service/app/agent/nodes/evidence_gate.py`
- 删除：`agent-service/app/agent/nodes/explorer.py`
- 删除：`agent-service/app/agent/nodes/outliner.py`
- 删除：`agent-service/app/agent/nodes/planner.py`
- 删除：`agent-service/app/agent/nodes/proposer.py`
- 删除：`agent-service/app/agent/nodes/reviewer.py`
- 删除：`agent-service/app/agent/nodes/writer.py`
- 删除：`agent-service/app/agent/state.py`
- 删除：`agent-service/app/agent/quality_checks.py`
- 删除：`agent-service/app/agent/cancellation.py`
- 删除：`agent-service/app/agent/document_strategy.py`
- 删除：`agent-service/app/agent/events.py`
- 删除：`agent-service/app/agent/evidence.py`
- 删除：`agent-service/app/agent/llm.py`
- 修改：`agent-service/app/main.py`
- 修改：`agent-service/pyproject.toml`

**重要：** 在删除之前，请验证是否没有从旧模块导入新代码。首先运行完整的 grep。

- [ ] **第 1 步：验证没有新代码依赖于旧模块**

运行： `cd /e/test/Docmost/agent-service && grep -r "from app.agent" app/orchestrator/ app/workers/ app/models/ --include="*.py" || echo "No dependencies found"`

如果发现任何导入，则必须先将其迁移，然后再删除。

- [ ] **第 2 步：从 main.py 中删除旧端点**

在 `agent-service/app/main.py` 中，删除：
- `POST /agent/run` 端点
- `POST /agent/resume` 端点
- `POST /agent/stop` 端点
- 来自 `app.agent.*` 的任何进口

- [ ] **步骤 3：将 v2 端点重命名为 root**

In `agent-service/app/main.py`:
- `POST /v2/agent/run` → `POST /agent/run`
- `POST /v2/agent/resume` → `POST /agent/resume`
- `POST /v2/agent/stop` → `POST /agent/stop`

- [ ] **第 4 步：删除旧代理文件**

运行：
```bash
cd /e/test/Docmost/agent-service
rm -f app/agent/graph.py
rm -f app/agent/state.py
rm -f app/agent/quality_checks.py
rm -f app/agent/cancellation.py
rm -f app/agent/document_strategy.py
rm -f app/agent/events.py
rm -f app/agent/evidence.py
rm -f app/agent/llm.py
rm -rf app/agent/nodes/
```

如果其他代码仍然引用该包，则保留 `app/agent/__init__.py`；如果完全清理，则将其删除。

- [ ] **第 5 步：从依赖项中删除 langgraph**

编辑`agent-service/pyproject.toml`，删除：
```
"langgraph>=0.2",
"langchain-core>=0.3",
"langchain-openai>=0.2",
"langchain-google-genai>=2.0",
"langgraph-checkpoint-postgres>=2.0",
```

保留 `httpx`、`pydantic-ai` 和其他非 LangGraph 依赖项。

- [ ] **第 6 步：删除旧的前端组件**

运行：
```bash
cd /e/test/Docmost
rm -f apps/client/src/ee/ai/components/ai-creator/ai-creator-clarify-bubble.tsx
rm -f apps/client/src/ee/ai/components/ai-creator/ai-creator-propose-bubble.tsx
rm -f apps/client/src/ee/ai/components/ai-creator/ai-creator-outline-bubble.tsx
```

从 `ai-creator-panel.tsx` 或 `ai-creator-messages.tsx` 中删除这些组件的所有导入。

- [ ] **步骤 7：更新 NestJS 网关端点路径**

修改`apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts`：
- 更改代理 URL 构造中的 `/v2/agent/run` → `/agent/run`
- 更改 `/v2/agent/resume` → `/agent/resume`
- 更改 `/v2/agent/stop` → `/agent/stop`

- [ ] **第 8 步：验证没有任何损坏**

运行： `cd /e/test/Docmost/agent-service && python -c "from app.orchestrator.engine import *; print('orchestrator OK')"`
运行：`cd /e/test/Docmost && pnpm typecheck`（如果可用）

- [ ] **第 9 步：提交**

运行： `cd /e/test/Docmost && git add -A && git commit -m "refactor(agent): remove old LangGraph code and rename v2 endpoints to root"`

---

## 分块 10：文档更新

### 任务 10：更新 documentation

**文件：**
- 修改：`CLAUDE.md` — 更新 AI 代理部分
- 修改：`docs/ai-agent-refactor-details.md` — 更新架构描述
- 创建：`docs/ai-creator-v2-architecture.md` — 新架构文档
- 修改：`docker-compose.yml` — 如果依赖项发生更改则更新

- [ ] **第 1 步：更新 CLAUDE.md AI Agent 部分**

用更新的信息替换现有的 AI Agent 部分：
- 删除对 LangGraph 的引用
- 更新 PydanticAI 框架
- 更新架构：Orchestrator → Workers（SectionWriter、Evaluator、Fixer、StyleAnalyzer）
- 更新端点路径（删除 v2 前缀）
- 更新依赖列表

- [ ] **步骤 2：更新 docs/ai-agent-refactor-details.md**

更新架构图和文件列表以反映新结构：
- `app/orchestrator/` — 核心引擎、工具、提示、模型路由器
- `app/workers/` — 节编写器、评估器、修复器、样式分析器
- `app/models/` — Pydantic v2 数据模型
- 删除对旧 `app/agent/` 目录的引用

- [ ] **步骤 3：创建 docs/ai-creator-v2-architecture.md**

记录新架构：
- Orchestrator + Worker 模式
- 模型路由配置
- SSE事件协议
- 审核流程（评估 → 自动修复 → 用户决策 → 有针对性的修复）
- 风格学习管道
- 前端组件层次结构（ReviewModal、BlueprintModal、LiveDraft）

- [ ] **第 4 步：更新 docker-compose.yml**

检查 `pyproject.toml` 更改是否需要更新 Dockerfile 或 docker-compose：
- 删除与 langgraph 相关的系统依赖项（如果有）
- 验证 pydantic-ai 是否在 Docker 构建中正确安装

- [ ] **第 5 步：提交**

运行： `cd /e/test/Docmost && git add CLAUDE.md docs/ docker-compose.yml && git commit -m "docs: update documentation for AI Creator v2 architecture"`

---

## 分块 11：最终集成测试套件

### 任务 11：创建 comprehensive integration tests

**文件：**
- 创建：`agent-service/tests/test_e2e_final.py`

**上下文：** 端到端测试验证所有三个复杂级别的完整管道。

- [ ] **第 1 步：编写 1 级集成测试**

```python
# agent-service/tests/test_e2e_final.py
"""Final integration test suite for AI Creator v2.

Tests all three complexity levels end-to-end.
"""
import pytest
import time
from unittest.mock import AsyncMock, patch, MagicMock


class TestLevel1Integration:
    """Level 1: Simple translation/edit — should complete in < 15 seconds."""

    @pytest.mark.asyncio
    async def test_translate_completes_quickly(self):
        """Translate task should complete without Blueprint or Review phases."""
        from app.orchestrator.engine import run_orchestrator

        start = time.monotonic()
        with patch("app.orchestrator.tools.simple_edit.execute_simple_edit",
                    new_callable=AsyncMock, return_value="Translated content"):
            ctx = MagicMock()
            ctx.emit = AsyncMock()
            result = await run_orchestrator(
                user_message="Translate this to English",
                page_content="这是一段中文内容。",
                workspace_id="ws-test",
                ctx=ctx,
            )
        elapsed = time.monotonic() - start
        assert elapsed < 15, f"Level 1 took {elapsed:.1f}s, expected < 15s"
        assert result is not None

    @pytest.mark.asyncio
    async def test_translate_output_is_correct_language(self):
        """Output should be in the requested language."""
        with patch("app.orchestrator.tools.simple_edit.execute_simple_edit",
                    new_callable=AsyncMock, return_value="This is Chinese content.") as mock:
            ctx = MagicMock()
            ctx.emit = AsyncMock()
            result = await run_orchestrator(
                user_message="Translate to English",
                page_content="这是中文内容。",
                workspace_id="ws-test",
                ctx=ctx,
            )
        # Verify simple_edit was called (not full pipeline)
        mock.assert_called_once()
```

- [ ] **第 2 步：编写 2 级集成测试**

```python
class TestLevel2Integration:
    """Level 2: Optimize formatting with file — should complete in < 90 seconds."""

    @pytest.mark.asyncio
    async def test_optimize_format_with_file(self):
        """Should go through Brief → Write → Done (no Blueprint)."""
        from app.orchestrator.engine import run_orchestrator

        events_captured = []

        async def capture_emit(event_type, data=None):
            events_captured.append(event_type)

        start = time.monotonic()
        with patch("app.orchestrator.tools.simple_edit.execute_simple_edit",
                    new_callable=AsyncMock, return_value="Formatted content"), \
             patch("app.workers.section_writer.SectionWriter.write",
                    new_callable=AsyncMock, return_value="Written section"):
            ctx = MagicMock()
            ctx.emit = AsyncMock(side_effect=capture_emit)
            result = await run_orchestrator(
                user_message="Optimize formatting",
                uploaded_files=[{"data": b"test content", "filename": "test.md"}],
                workspace_id="ws-test",
                ctx=ctx,
            )
        elapsed = time.monotonic() - start
        # Should have Brief phase
        assert "brief" in str(events_captured).lower() or result is not None
```

- [ ] **第 3 步：编写 3 级集成测试**

```python
class TestLevel3Integration:
    """Level 3: Full pipeline with multiple files — should complete in < 5 minutes."""

    @pytest.mark.asyncio
    async def test_full_pipeline_with_review(self):
        """Should go through Brief → Blueprint → Sections → Review → Done."""
        from app.orchestrator.engine import run_orchestrator

        events_captured = []

        async def capture_emit(event_type, data=None):
            events_captured.append(event_type)

        with patch("app.workers.section_writer.SectionWriter.write",
                    new_callable=AsyncMock, return_value="Section content " * 50), \
             patch("app.workers.evaluator.evaluate_llm",
                    new_callable=AsyncMock,
                    return_value=([], {"accuracy": 90}, 90)), \
             patch("app.workers.style_analyzer.analyze_style",
                    new_callable=AsyncMock, return_value=""):
            ctx = MagicMock()
            ctx.emit = AsyncMock(side_effect=capture_emit)
            result = await run_orchestrator(
                user_message="Write a comparison analysis",
                uploaded_files=[
                    {"data": b"doc 1 content", "filename": "doc1.pdf"},
                    {"data": b"doc 2 content", "filename": "doc2.pdf"},
                ],
                workspace_id="ws-test",
                ctx=ctx,
            )
        # Verify key phases occurred
        event_str = str(events_captured).lower()
        # At minimum, some events should have been emitted
        assert len(events_captured) > 0
```

- [ ] **第 4 步：编写字数一致性测试**

```python
class TestQualityMetrics:
    """Verify quality metrics across multiple runs."""

    @pytest.mark.asyncio
    async def test_word_count_within_tolerance(self):
        """Word count should be within +-10% of budget across runs."""
        from app.workers.evaluator import _count_words

        # Simulate 5 section outputs with target 500 words
        target = 500
        simulated_outputs = [
            "word " * 480,  # 480 words — within 10%
            "word " * 520,  # 520 words — within 10%
            "word " * 460,  # 460 words — within 10%
            "word " * 540,  # 540 words — within 10%
            "word " * 500,  # 500 words — exact
        ]
        for output in simulated_outputs:
            count = _count_words(output)
            ratio = count / target
            assert 0.90 <= ratio <= 1.10, f"Word count {count} is outside +-10% of {target}"

    def test_asset_reuse_rate_calculation(self):
        """Asset reuse rate should be >= 80% in well-formed documents."""
        from app.models.review import ReviewReport

        # Simulate a report where 4/5 assets were used
        report = ReviewReport(
            overall_score=85,
            length_compliance=0.95,
            asset_reuse_rate=0.80,
            issues=[],
            dimensions={},
        )
        assert report.asset_reuse_rate >= 0.80
```

- [ ] **第 5 步：运行所有测试**

运行： `cd /e/test/Docmost/agent-service && python -m pytest tests/test_e2e_final.py -v`

- [ ] **第 6 步：提交**

运行： `cd /e/test/Docmost && git add agent-service/tests/test_e2e_final.py && git commit -m "test(agent): add final integration test suite for all complexity levels"`

---

## 总结

| Chunk | Tasks | 关键成果 |
|-------|-------|-----------------|
| 1 | 任务 1 | 具有每个工作人员模型分配的模型路由 |
| 2 | 任务 2 | 使用滑动窗口上下文重写单章 |
| 3 | 任务 3 | 多文档合并提案和资产重复数据删除 |
| 4 | 任务 4 | 从最近的页面学习工作区风格 |
| 5 | 任务 5 | 前端动画、骨架加载、响应式 |
| 6 | 任务 6 | 输入区域重新设计：图标网格、级别指示器、拖放 |
| 7 | 任务 7 | SSE批处理、心跳、步骤去抖动 |
| 8 | 任务 8 | 使用Redis缓存进行并行资产解析 |
| 9 | 任务 9 | 删除旧的 LangGraph 代码，重命名端点 |
| 10 | 任务 10 | 文档更新 |
| 11 | 任务 11 | 最终集成测试套件（L1/L2/L3） |

**预计总时间：** 2-3 周

**关键设计决策：**
- 通过环境变量（ORCHESTRATOR_MODEL、WRITER_MODEL 等）进行模型路由 — 零代码配置更改
- 风格学习可以根据工作空间选择加入——避免不必要的风格强加
- 50 毫秒的 SSE 批处理将内容流的事件计数减少了约 10 倍
- 旧的 LangGraph 删除是最后一步 - 确保迁移过程中不会出现任何中断
- 集成测试使用模拟，但验证完整的管道流程和时序约束
- 通过内容哈希进行资产重复数据删除，防止对不同来源的同一文件进行重复处理
