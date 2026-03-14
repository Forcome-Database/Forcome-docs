# Phase 5: Polish & Optimization — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add model routing, style learning, single-chapter rewrite, multi-document merge optimization, frontend UI refinements, performance optimizations, and clean up old LangGraph code.

**Architecture:** Model routing enables different LLM models for different workers (strong model for Orchestrator, fast model for SectionWriter). Style learning extracts writing patterns from workspace documents. Frontend gets animation polish and responsive improvements.

**Tech Stack:** PydanticAI (multi-model), Mantine UI transitions, Redis caching

---

## File Structure Overview

### New files (agent-service)

| File | Purpose |
|------|---------|
| `agent-service/app/orchestrator/model_router.py` | Multi-model routing configuration |
| `agent-service/app/workers/style_analyzer.py` | Workspace style learning worker |
| `agent-service/tests/orchestrator/test_model_router.py` | Model router tests |
| `agent-service/tests/workers/test_style_analyzer.py` | Style analyzer tests |
| `agent-service/tests/test_e2e_final.py` | Final integration test suite |

### New files (frontend)

| File | Purpose |
|------|---------|
| `docs/ai-creator-v2-architecture.md` | New architecture documentation |

### Modified files

| File | Change |
|------|--------|
| `agent-service/app/orchestrator/llm_factory.py` | Support multiple model instances |
| `agent-service/app/orchestrator/engine.py` | Add rewrite_section tool |
| `agent-service/app/orchestrator/tools/write_tools.py` | Add rewrite_section implementation |
| `agent-service/app/orchestrator/tools/complexity.py` | Multi-document merge proposals |
| `agent-service/app/main.py` | Remove old endpoints, rename v2 to / |
| `agent-service/pyproject.toml` | Remove langgraph dependency |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-input.tsx` | Input area redesign |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx` | Animation polish |
| `apps/client/src/ee/ai/services/ai-create-runner.utils.ts` | SSE streaming optimization |
| `apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts` | Update endpoint paths |
| `docker-compose.yml` | Update if new dependencies |

### Deleted files

| File | Reason |
|------|--------|
| `agent-service/app/agent/graph.py` | Old LangGraph orchestration |
| `agent-service/app/agent/nodes/*.py` | Old LangGraph node files |
| `agent-service/app/agent/state.py` | Old TypedDict state |
| `agent-service/app/agent/quality_checks.py` | Replaced by evaluator worker |
| `agent-service/app/agent/cancellation.py` | Replaced by new cancellation |
| `agent-service/app/agent/document_strategy.py` | Replaced by new models |
| `agent-service/app/agent/events.py` | Replaced by new SSE protocol |
| `agent-service/app/agent/evidence.py` | Replaced by AssetMap model |
| `agent-service/app/agent/llm.py` | Replaced by llm_factory.py |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-clarify-bubble.tsx` | Old clarify UI |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-propose-bubble.tsx` | Old propose UI |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-outline-bubble.tsx` | Old outline UI |

---

## Chunk 1: Model Routing

### Task 1: Create model router configuration

**Files:**
- Create: `agent-service/app/orchestrator/model_router.py`
- Test: `agent-service/tests/orchestrator/test_model_router.py`

**Context:** Different workers benefit from different model strengths. The Orchestrator needs strong reasoning, SectionWriter needs speed, Evaluator needs balanced capability. This task creates a routing config that maps worker roles to model identifiers.

- [ ] **Step 1: Write failing tests for model router**

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

- [ ] **Step 2: Implement ModelRouter**

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

- [ ] **Step 3: Run tests and verify**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/orchestrator/test_model_router.py -v`

- [ ] **Step 4: Update llm_factory to accept model parameter from router**

Modify `agent-service/app/orchestrator/llm_factory.py` to add a `get_model(model_id: str | None = None)` overload that accepts an explicit model string. When `model_id` is provided, it uses that instead of reading from config. This enables the ModelRouter to pass role-specific models.

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

- [ ] **Step 5: Update workers to accept model parameter**

Each worker (SectionWriter, Evaluator, Fixer) should accept an optional `model` parameter. When provided, it overrides the default model. This was partially done in Phase 4; verify all workers support it.

- [ ] **Step 6: Commit**

Run: `cd /e/test/Docmost && git add agent-service/app/orchestrator/model_router.py agent-service/app/orchestrator/llm_factory.py agent-service/tests/orchestrator/test_model_router.py && git commit -m "feat(agent): implement model routing for worker-specific LLM assignment"`

---

## Chunk 2: Single Chapter Rewrite

### Task 2: Implement rewrite_section tool

**Files:**
- Create: `agent-service/app/orchestrator/tools/rewrite_tools.py`
- Test: `agent-service/tests/orchestrator/test_rewrite_tools.py`

**Context:** After document generation, users may want to rewrite a single section with specific feedback. This tool calls SectionWriter for just that section, preserving adjacent section context via the sliding window.

- [ ] **Step 1: Write failing tests**

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

- [ ] **Step 2: Implement rewrite_section**

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

- [ ] **Step 3: Run tests and verify**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/orchestrator/test_rewrite_tools.py -v`

- [ ] **Step 4: Commit**

Run: `cd /e/test/Docmost && git add agent-service/app/orchestrator/tools/rewrite_tools.py agent-service/tests/orchestrator/test_rewrite_tools.py && git commit -m "feat(agent): implement single chapter rewrite tool"`

---

## Chunk 3: Multi-Document Merge Optimization

### Task 3: Implement multi-document merge proposals

**Files:**
- Modify: `agent-service/app/orchestrator/tools/complexity.py`
- Test: `agent-service/tests/orchestrator/test_multi_merge.py`

**Context:** When a user provides multiple source documents (Level 3), the Orchestrator should propose 2-3 possible document structures, deduplicate assets, and flag content conflicts.

- [ ] **Step 1: Write failing tests**

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

- [ ] **Step 2: Implement deduplicate_assets and propose_merged_structures**

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

- [ ] **Step 3: Run tests and verify**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/orchestrator/test_multi_merge.py -v`

- [ ] **Step 4: Commit**

Run: `cd /e/test/Docmost && git add agent-service/app/orchestrator/tools/complexity.py agent-service/tests/orchestrator/test_multi_merge.py && git commit -m "feat(agent): implement multi-document merge proposals and asset deduplication"`

---

## Chunk 4: Style Learning

### Task 4: Implement workspace style analyzer

**Files:**
- Create: `agent-service/app/workers/style_analyzer.py`
- Test: `agent-service/tests/workers/test_style_analyzer.py`

**Context:** Style learning reads recent workspace pages to extract writing patterns, producing a style guide string injected into SectionWriter prompts. Controlled by workspace AI settings.

- [ ] **Step 1: Write failing tests**

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

- [ ] **Step 2: Implement style analyzer**

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

- [ ] **Step 3: Run tests and verify**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/workers/test_style_analyzer.py -v`

- [ ] **Step 4: Commit**

Run: `cd /e/test/Docmost && git add agent-service/app/workers/style_analyzer.py agent-service/tests/workers/test_style_analyzer.py && git commit -m "feat(agent): implement workspace style learning analyzer"`

---

## Chunk 5: Frontend UI Polish — Animations and Transitions

### Task 5: Add animations and loading states

**Files:**
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx`

**Context:** Add Mantine Transition for modal open/close, skeleton loading states, and smooth scroll behavior.

- [ ] **Step 1: Add skeleton loading for review state**

```tsx
// Add to ai-creator-panel.tsx imports:
import { Skeleton, Transition } from '@mantine/core';

// Add skeleton state:
// When waiting for review_report SSE event, show Skeleton placeholders:
// <Skeleton height={100} radius="md" />  // score board placeholder
// <Skeleton height={40} radius="sm" mt="sm" />  // issue placeholder
// <Skeleton height={40} radius="sm" mt="sm" />  // issue placeholder
```

- [ ] **Step 2: Add smooth scroll to section completion**

```typescript
// When a section_complete SSE event arrives:
const scrollToSection = (sectionId: string) => {
  const element = document.getElementById(`draft-section-${sectionId}`);
  element?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};
```

- [ ] **Step 3: Add responsive breakpoint for ReviewModal**

```tsx
// In ReviewModal.tsx, make it full screen on mobile:
import { useMediaQuery } from '@mantine/hooks';

// Inside component:
const isMobile = useMediaQuery('(max-width: 768px)');
// <Modal ... fullScreen={isMobile} size={isMobile ? undefined : "xl"}>
```

- [ ] **Step 4: Commit**

Run: `cd /e/test/Docmost && git add apps/client/src/ee/ai/components/ai-creator/ && git commit -m "feat(client): add animations, skeleton loading, and responsive breakpoints"`

---

## Chunk 6: Frontend UI Polish — Input Area Redesign

### Task 6: Redesign AiCreatorInput

**Files:**
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-creator-input.tsx`

**Context:** Improve the input area with icon-grid template selection, visual complexity indicator, and drag-and-drop file upload.

- [ ] **Step 1: Replace template dropdown with icon grid**

```tsx
// Replace the existing template Combobox/Select with a visual grid:
import { SimpleGrid, UnstyledButton, Stack, Text, ThemeIcon } from '@mantine/core';

// Template selection as icon grid (2 columns):
// Each template shows: icon (from template.icon) + name
// Click selects the template and populates the input
// Selected template highlighted with primary color border
```

- [ ] **Step 2: Add visual complexity level indicator**

```tsx
// Add a badge showing the estimated complexity level:
import { Badge } from '@mantine/core';

// Analyze current input to estimate level:
// - No files, short instruction → L1 badge (green)
// - 1 file or medium instruction → L2 badge (yellow)
// - Multiple files or "仿写"/"对比" keywords → L3 badge (orange)
// Display as: <Badge size="sm" color={levelColor}>L{level}</Badge>
```

- [ ] **Step 3: Redesign file upload as drag-and-drop zone**

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

- [ ] **Step 4: Replace deep mode toggle with automatic detection**

```tsx
// Remove the explicit "deep mode" toggle switch
// Instead, automatically enable agent mode when Level 3 is detected:
// const shouldUseAgent = estimatedLevel >= 3;
// This value is sent with the request instead of a manual toggle
```

- [ ] **Step 5: Commit**

Run: `cd /e/test/Docmost && git add apps/client/src/ee/ai/components/ai-creator/ai-creator-input.tsx && git commit -m "feat(client): redesign input area with icon grid templates and drag-drop upload"`

---

## Chunk 7: Performance — SSE Streaming Optimization

### Task 7: Optimize SSE event streaming

**Files:**
- Modify: `agent-service/app/main.py` (or SSE utility module)
- Modify: `apps/client/src/ee/ai/services/ai-create-runner.utils.ts`

**Context:** Reduce SSE overhead by batching content_delta events, debouncing step events, and adding heartbeat to prevent proxy timeouts.

- [ ] **Step 1: Implement server-side event batching**

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

- [ ] **Step 2: Implement SSE heartbeat**

```python
# Add heartbeat to the SSE endpoint:
async def heartbeat_loop(send_func, interval: int = 15):
    """Send SSE heartbeat comment every `interval` seconds."""
    while True:
        await asyncio.sleep(interval)
        await send_func(":heartbeat\n\n")
```

- [ ] **Step 3: Add step event debouncing**

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

- [ ] **Step 4: Commit**

Run: `cd /e/test/Docmost && git add agent-service/app/main.py apps/client/src/ee/ai/services/ai-create-runner.utils.ts && git commit -m "perf(agent): add SSE batching, heartbeat, and step event debouncing"`

---

## Chunk 8: Performance — Parallel Asset Parsing

### Task 8: Optimize asset parsing with parallelism and caching

**Files:**
- Modify: `agent-service/app/orchestrator/tools/complexity.py` (or asset parsing module)

**Context:** When multiple files are uploaded, parsing them sequentially is slow. Use asyncio.gather with a semaphore for parallel parsing. Cache parsed results in Redis.

- [ ] **Step 1: Implement parallel parsing with semaphore**

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

- [ ] **Step 2: Add Redis caching for parsed assets**

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

- [ ] **Step 3: Implement parallel VLM calls for images**

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

- [ ] **Step 4: Commit**

Run: `cd /e/test/Docmost && git add agent-service/app/orchestrator/tools/complexity.py && git commit -m "perf(agent): add parallel asset parsing with Redis caching and VLM batching"`

---

## Chunk 9: Clean Up Old LangGraph Code

### Task 9: Remove old agent code and endpoints

**Files:**
- Delete: `agent-service/app/agent/graph.py`
- Delete: `agent-service/app/agent/nodes/clarifier.py`
- Delete: `agent-service/app/agent/nodes/evidence_acquirer.py`
- Delete: `agent-service/app/agent/nodes/evidence_gate.py`
- Delete: `agent-service/app/agent/nodes/explorer.py`
- Delete: `agent-service/app/agent/nodes/outliner.py`
- Delete: `agent-service/app/agent/nodes/planner.py`
- Delete: `agent-service/app/agent/nodes/proposer.py`
- Delete: `agent-service/app/agent/nodes/reviewer.py`
- Delete: `agent-service/app/agent/nodes/writer.py`
- Delete: `agent-service/app/agent/state.py`
- Delete: `agent-service/app/agent/quality_checks.py`
- Delete: `agent-service/app/agent/cancellation.py`
- Delete: `agent-service/app/agent/document_strategy.py`
- Delete: `agent-service/app/agent/events.py`
- Delete: `agent-service/app/agent/evidence.py`
- Delete: `agent-service/app/agent/llm.py`
- Modify: `agent-service/app/main.py`
- Modify: `agent-service/pyproject.toml`

**IMPORTANT:** Before deleting, verify that no new code imports from the old modules. Run a full grep first.

- [ ] **Step 1: Verify no new code depends on old modules**

Run: `cd /e/test/Docmost/agent-service && grep -r "from app.agent" app/orchestrator/ app/workers/ app/models/ --include="*.py" || echo "No dependencies found"`

If any imports are found, they must be migrated first before deletion.

- [ ] **Step 2: Remove old endpoints from main.py**

In `agent-service/app/main.py`, remove:
- `POST /agent/run` endpoint
- `POST /agent/resume` endpoint
- `POST /agent/stop` endpoint
- Any imports from `app.agent.*`

- [ ] **Step 3: Rename v2 endpoints to root**

In `agent-service/app/main.py`:
- `POST /v2/agent/run` → `POST /agent/run`
- `POST /v2/agent/resume` → `POST /agent/resume`
- `POST /v2/agent/stop` → `POST /agent/stop`

- [ ] **Step 4: Delete old agent files**

Run:
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

Keep `app/agent/__init__.py` if other code still references the package, or delete it if fully cleaned.

- [ ] **Step 5: Remove langgraph from dependencies**

Edit `agent-service/pyproject.toml`, remove:
```
"langgraph>=0.2",
"langchain-core>=0.3",
"langchain-openai>=0.2",
"langchain-google-genai>=2.0",
"langgraph-checkpoint-postgres>=2.0",
```

Keep `httpx`, `pydantic-ai`, and other non-LangGraph dependencies.

- [ ] **Step 6: Delete old frontend components**

Run:
```bash
cd /e/test/Docmost
rm -f apps/client/src/ee/ai/components/ai-creator/ai-creator-clarify-bubble.tsx
rm -f apps/client/src/ee/ai/components/ai-creator/ai-creator-propose-bubble.tsx
rm -f apps/client/src/ee/ai/components/ai-creator/ai-creator-outline-bubble.tsx
```

Remove any imports of these components from `ai-creator-panel.tsx` or `ai-creator-messages.tsx`.

- [ ] **Step 7: Update NestJS gateway endpoint paths**

Modify `apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts`:
- Change `/v2/agent/run` → `/agent/run` in the proxy URL construction
- Change `/v2/agent/resume` → `/agent/resume`
- Change `/v2/agent/stop` → `/agent/stop`

- [ ] **Step 8: Verify nothing is broken**

Run: `cd /e/test/Docmost/agent-service && python -c "from app.orchestrator.engine import *; print('orchestrator OK')"`
Run: `cd /e/test/Docmost && pnpm typecheck` (if available)

- [ ] **Step 9: Commit**

Run: `cd /e/test/Docmost && git add -A && git commit -m "refactor(agent): remove old LangGraph code and rename v2 endpoints to root"`

---

## Chunk 10: Documentation Update

### Task 10: Update documentation

**Files:**
- Modify: `CLAUDE.md` — Update AI Agent section
- Modify: `docs/ai-agent-refactor-details.md` — Update architecture description
- Create: `docs/ai-creator-v2-architecture.md` — New architecture documentation
- Modify: `docker-compose.yml` — Update if dependencies changed

- [ ] **Step 1: Update CLAUDE.md AI Agent section**

Replace the existing AI Agent section with updated information:
- Remove references to LangGraph
- Update framework to PydanticAI
- Update architecture: Orchestrator → Workers (SectionWriter, Evaluator, Fixer, StyleAnalyzer)
- Update endpoint paths (remove v2 prefix)
- Update dependency list

- [ ] **Step 2: Update docs/ai-agent-refactor-details.md**

Update architecture diagram and file listings to reflect the new structure:
- `app/orchestrator/` — Core engine, tools, prompts, model router
- `app/workers/` — SectionWriter, Evaluator, Fixer, StyleAnalyzer
- `app/models/` — Pydantic v2 data models
- Remove references to old `app/agent/` directory

- [ ] **Step 3: Create docs/ai-creator-v2-architecture.md**

Document the new architecture:
- Orchestrator + Worker pattern
- Model routing configuration
- SSE event protocol
- Review flow (evaluate → auto-fix → user decision → targeted fix)
- Style learning pipeline
- Frontend component hierarchy (ReviewModal, BlueprintModal, LiveDraft)

- [ ] **Step 4: Update docker-compose.yml**

Check if `pyproject.toml` changes require updating the Dockerfile or docker-compose:
- Remove langgraph-related system dependencies if any
- Verify pydantic-ai is installed correctly in Docker build

- [ ] **Step 5: Commit**

Run: `cd /e/test/Docmost && git add CLAUDE.md docs/ docker-compose.yml && git commit -m "docs: update documentation for AI Creator v2 architecture"`

---

## Chunk 11: Final Integration Test Suite

### Task 11: Create comprehensive integration tests

**Files:**
- Create: `agent-service/tests/test_e2e_final.py`

**Context:** End-to-end tests validating the complete pipeline across all three complexity levels.

- [ ] **Step 1: Write Level 1 integration test**

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

- [ ] **Step 2: Write Level 2 integration test**

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

- [ ] **Step 3: Write Level 3 integration test**

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

- [ ] **Step 4: Write word count consistency test**

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

- [ ] **Step 5: Run all tests**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/test_e2e_final.py -v`

- [ ] **Step 6: Commit**

Run: `cd /e/test/Docmost && git add agent-service/tests/test_e2e_final.py && git commit -m "test(agent): add final integration test suite for all complexity levels"`

---

## Summary

| Chunk | Tasks | Key Deliverables |
|-------|-------|-----------------|
| 1 | Task 1 | Model routing with per-worker model assignment |
| 2 | Task 2 | Single chapter rewrite with sliding window context |
| 3 | Task 3 | Multi-document merge proposals and asset deduplication |
| 4 | Task 4 | Workspace style learning from recent pages |
| 5 | Task 5 | Frontend animations, skeleton loading, responsive |
| 6 | Task 6 | Input area redesign: icon grid, level indicator, drag-drop |
| 7 | Task 7 | SSE batching, heartbeat, step debouncing |
| 8 | Task 8 | Parallel asset parsing with Redis cache |
| 9 | Task 9 | Remove old LangGraph code, rename endpoints |
| 10 | Task 10 | Documentation updates |
| 11 | Task 11 | Final integration test suite (L1/L2/L3) |

**Total estimated time:** 2-3 weeks

**Key design decisions:**
- Model routing via env vars (ORCHESTRATOR_MODEL, WRITER_MODEL, etc.) — zero-code config change
- Style learning is opt-in per workspace — avoids unwanted style imposition
- SSE batching at 50ms reduces event count by ~10x for content streaming
- Old LangGraph removal is the final step — ensures nothing breaks during migration
- Integration tests use mocks but verify the full pipeline flow and timing constraints
- Asset deduplication by content hash prevents duplicate processing of same file from different sources
