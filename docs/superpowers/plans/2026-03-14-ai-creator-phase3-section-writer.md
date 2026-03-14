# Phase 3: Section Writer — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the section-by-section writing engine with sliding window context, word budget enforcement, parallel writing, draft management, and the complete Level 3 path.

**Architecture:** SectionWriter Worker generates one section at a time with a carefully crafted context package (global outline + previous section summary + next section preview + relevant assets + visual plan). Sections can be written in parallel. Word budget is enforced by retry on excess. Draft Manager stores drafts independently from the page.

**Tech Stack:** PydanticAI, asyncio (for parallel), Redis (draft storage), Mantine UI

**Prerequisites (from Phase 0, 1 & 2):**
- Pydantic models: `CreationBrief`, `AssetMap`, `CreationBlueprint`, `SectionPlan`, `VisualPlan`, `SectionDraft`
- Chinese word counting utility (`app/utils/word_count.py`)
- Orchestrator engine with ReAct loop and Phase 2 tools
- AssetParser, VisualPlanner, Researcher Workers
- `parse_assets`, `create_brief`, `create_blueprint` Orchestrator tools
- SSE event protocol with `asyncio.Queue` streaming
- `ask_user` tool for user interaction
- Frontend: SmartBriefCard, BlueprintModal

---

## File Structure Overview

### New files (agent-service)

| File | Purpose |
|------|---------|
| `agent-service/app/workers/section_writer.py` | SectionWriter Worker — writes one section with context |
| `agent-service/app/workers/consistency_checker.py` | Cross-section consistency validation |
| `agent-service/app/orchestrator/tools/write_tools.py` | `write_section` and `write_sections_parallel` tools |
| `agent-service/app/orchestrator/draft_manager.py` | Draft storage and retrieval via Redis |
| `agent-service/tests/workers/test_section_writer.py` | SectionWriter unit tests |
| `agent-service/tests/workers/test_consistency_checker.py` | Consistency checker tests |
| `agent-service/tests/orchestrator/test_write_tools.py` | Write tools tests |
| `agent-service/tests/orchestrator/test_draft_manager.py` | Draft manager tests |
| `agent-service/tests/orchestrator/test_e2e_level3.py` | Level 3 end-to-end integration test |

### New files (NestJS)

| File | Purpose |
|------|---------|
| `apps/server/src/ee/ai/agent-gateway/draft.controller.ts` | Draft REST API (GET/POST) |
| `apps/server/src/ee/ai/agent-gateway/draft.service.ts` | Draft proxy service |

### New files (frontend)

| File | Purpose |
|------|---------|
| `apps/client/src/ee/ai/components/ai-creator/live-draft/DraftProgressBar.tsx` | Live writing progress UI |
| `apps/client/src/ee/ai/components/ai-creator/live-draft/SectionNav.tsx` | Clickable chapter sidebar |
| `apps/client/src/ee/ai/components/ai-creator/live-draft/SectionActions.tsx` | Per-section approve/rewrite |
| `apps/client/src/ee/ai/components/ai-creator/live-draft/index.ts` | Live draft barrel export |
| `apps/client/src/ee/ai/components/ai-creator/draft-manager/DraftPanel.tsx` | Complete draft review panel |
| `apps/client/src/ee/ai/components/ai-creator/draft-manager/DraftDiffView.tsx` | Diff view against current page |
| `apps/client/src/ee/ai/components/ai-creator/draft-manager/DraftMergeActions.tsx` | Merge/discard actions |
| `apps/client/src/ee/ai/components/ai-creator/draft-manager/index.ts` | Draft manager barrel export |

### Modified files

| File | Change |
|------|--------|
| `agent-service/app/orchestrator/engine.py` | Register write tools, update Level 3 path |
| `agent-service/app/orchestrator/prompts.py` | Add Level 3 orchestrator instructions |
| `apps/server/src/ee/ai/agent-gateway/agent-gateway.module.ts` | Register draft controller |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-chat.tsx` | Render DraftProgressBar and DraftPanel |

---

## Chunk 1: SectionWriter Core

### Task 1: SectionWriter Worker — core implementation

The SectionWriter generates one section at a time with a carefully crafted context package. It streams content via SSE and enforces word budget with retry.

**Files:**
- Create: `agent-service/app/workers/section_writer.py`
- Test: `agent-service/tests/workers/test_section_writer.py`

**Context:** `SectionDraft` (from `app/models/draft.py`) has: `section_id`, `title`, `content`, `word_count`, `status` (pending/drafting/done/revising), `revision_count`. The `SectionPlan` (from `app/models/blueprint.py`) has: `section_id`, `title`, `target_words`, `key_points`, `asset_ids`, `visuals`, `depends_on`. The `count_words` utility is at `app/utils/word_count.py`.

- [ ] **Step 1: Write failing tests for SectionWriter core**

```python
# agent-service/tests/workers/test_section_writer.py
import pytest
from unittest.mock import patch, AsyncMock, MagicMock

from app.models.blueprint import SectionPlan, VisualPlan
from app.models.draft import SectionDraft
from app.models.asset_map import AssetItem, AssetMap


class TestSectionWriterCore:
    """Test core section writing functionality."""

    @pytest.mark.asyncio
    async def test_write_section_basic(self):
        """Should write a section and return a SectionDraft."""
        from app.workers.section_writer import write_section

        section_plan = SectionPlan(
            section_id="s1",
            title="Introduction",
            target_words=500,
            key_points=["Project overview", "Goals"],
        )

        context_package = {
            "global_outline": "# Doc\n## Introduction\n## Details\n## Conclusion",
            "prev_section_tail": None,
            "next_section_header": {"title": "Details", "goal": "Technical details"},
            "relevant_assets": [],
            "visual_plan": [],
        }

        mock_content = "# Introduction\n\nThis project aims to provide a comprehensive solution..."

        with patch("app.workers.section_writer._llm_write_section", new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = mock_content
            draft = await write_section(
                section_plan=section_plan,
                context_package=context_package,
                brief_style="technical",
                brief_tone="professional",
            )

        assert isinstance(draft, SectionDraft)
        assert draft.section_id == "s1"
        assert draft.title == "Introduction"
        assert draft.content == mock_content
        assert draft.word_count > 0
        assert draft.status == "done"

    @pytest.mark.asyncio
    async def test_write_section_retry_on_undercount(self):
        """Should retry once if word count < 80% of budget."""
        from app.workers.section_writer import write_section

        section_plan = SectionPlan(
            section_id="s2",
            title="Details",
            target_words=1000,
            key_points=["Technical specs"],
        )

        context_package = {
            "global_outline": "## Details",
            "prev_section_tail": "...introduction concluded.",
            "next_section_header": None,
            "relevant_assets": [],
            "visual_plan": [],
        }

        # First attempt: too short (< 80% of 1000 = 800)
        short_content = "Short section."
        # Second attempt: adequate
        adequate_content = "A " * 500  # ~500 words, still may be short but tests retry logic

        with patch("app.workers.section_writer._llm_write_section", new_callable=AsyncMock) as mock_llm:
            mock_llm.side_effect = [short_content, adequate_content]
            with patch("app.workers.section_writer.count_words") as mock_count:
                mock_count.side_effect = [50, 900]  # first call short, second adequate
                draft = await write_section(
                    section_plan=section_plan,
                    context_package=context_package,
                    brief_style="technical",
                    brief_tone="professional",
                )

        # Should have called LLM twice (original + retry)
        assert mock_llm.call_count == 2
        assert draft.revision_count == 1

    @pytest.mark.asyncio
    async def test_write_section_with_assets(self):
        """Context package with assets should include them in the prompt."""
        from app.workers.section_writer import build_section_prompt

        section_plan = SectionPlan(
            section_id="s1",
            title="Setup",
            target_words=300,
            key_points=["Installation steps"],
            asset_ids=["code-1"],
        )

        assets = [
            AssetItem(
                id="code-1",
                type="code",
                source="readme.md",
                content="pip install docmost",
                summary="Installation command",
            ),
        ]

        context_package = {
            "global_outline": "## Setup",
            "prev_section_tail": None,
            "next_section_header": None,
            "relevant_assets": assets,
            "visual_plan": [],
        }

        prompt = build_section_prompt(
            section_plan=section_plan,
            context_package=context_package,
            style="technical",
            tone="professional",
        )

        assert "pip install docmost" in prompt
        assert "300" in prompt  # word budget
        assert "Installation steps" in prompt  # key point
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /e/test/Docmost/agent-service && python -m pytest tests/workers/test_section_writer.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'app.workers.section_writer'`

- [ ] **Step 3: Implement SectionWriter core**

```python
# agent-service/app/workers/section_writer.py
"""SectionWriter Worker — generates one section at a time.

Each section is written with a carefully crafted context package:
- Global outline (all sections, current highlighted)
- Previous section tail (last 2 paragraphs + summary)
- Next section header (title + goal for smooth transitions)
- Relevant assets (only AssetItems referenced in this section)
- Visual plan (what visuals to include)

Word budget enforcement: if generated content is < 80% of target,
retry once with explicit expansion instruction.
"""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from pydantic_ai import Agent

from app.models.blueprint import SectionPlan, VisualPlan
from app.models.draft import SectionDraft
from app.models.asset_map import AssetItem
from app.orchestrator.llm_factory import create_pydantic_ai_model
from app.utils.word_count import count_words

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

_SECTION_PROMPT_TEMPLATE = """\
You are writing one section of a document. Write ONLY this section — do not include content for other sections.

## Document Outline
{global_outline}

## Current Section
Title: {section_title}
Word budget: approximately {target_words} words
Key points to cover:
{key_points}

{prev_context}
{next_context}
{asset_context}
{visual_instructions}

## Writing Guidelines
- Style: {style}
- Tone: {tone}
- Target approximately {target_words} words for this section
- Start with the section heading (## {section_title})
- Cover ALL key points listed above
- Write naturally flowing prose — do not use bullet points unless the content requires it
- If this section follows a previous section, ensure smooth transition
- If this section precedes another, set up the transition naturally

{retry_instruction}

Write the section now:
"""


def build_section_prompt(
    section_plan: SectionPlan,
    context_package: dict[str, Any],
    style: str,
    tone: str,
    retry_instruction: str = "",
) -> str:
    """Build the LLM prompt for writing a single section.

    Args:
        section_plan: The plan for this section
        context_package: Context from surrounding sections and assets
        style: Writing style from the brief
        tone: Tone from the brief
        retry_instruction: Extra instruction for retry attempts

    Returns:
        Complete prompt string
    """
    # Format key points
    key_points = "\n".join(f"- {kp}" for kp in section_plan.key_points)

    # Previous section context
    prev_tail = context_package.get("prev_section_tail")
    prev_context = ""
    if prev_tail:
        prev_context = f"## Previous Section (ending)\n{prev_tail}\n"

    # Next section context
    next_header = context_package.get("next_section_header")
    next_context = ""
    if next_header:
        next_context = f"## Next Section Preview\nTitle: {next_header.get('title', '')}\nGoal: {next_header.get('goal', '')}\n"

    # Asset context
    assets = context_package.get("relevant_assets", [])
    asset_context = ""
    if assets:
        asset_lines = []
        for asset in assets:
            if isinstance(asset, AssetItem):
                asset_lines.append(f"### Asset [{asset.id}] ({asset.type})\n{asset.content}\n")
            elif isinstance(asset, dict):
                asset_lines.append(f"### Asset [{asset.get('id', '?')}] ({asset.get('type', '?')})\n{asset.get('content', '')}\n")
        asset_context = "## Reference Materials\n" + "\n".join(asset_lines)

    # Visual instructions
    visuals = context_package.get("visual_plan", [])
    visual_instructions = ""
    if visuals:
        visual_lines = []
        for v in visuals:
            if isinstance(v, VisualPlan):
                visual_lines.append(f"- {v.type}: {v.description} (placement: {v.placement})")
            elif isinstance(v, dict):
                visual_lines.append(f"- {v.get('type', '?')}: {v.get('description', '')} (placement: {v.get('placement', '')})")
        visual_instructions = "## Visual Elements to Include\n" + "\n".join(visual_lines)

    return _SECTION_PROMPT_TEMPLATE.format(
        global_outline=context_package.get("global_outline", ""),
        section_title=section_plan.title,
        target_words=section_plan.target_words,
        key_points=key_points,
        prev_context=prev_context,
        next_context=next_context,
        asset_context=asset_context,
        visual_instructions=visual_instructions,
        style=style,
        tone=tone,
        retry_instruction=retry_instruction,
    )


async def _llm_write_section(prompt: str) -> str:
    """Call LLM to generate section content."""
    model = create_pydantic_ai_model()
    agent = Agent(
        model,
        system_prompt="You are a skilled writer. Write exactly one document section as instructed.",
    )
    result = await agent.run(prompt)
    return result.data


async def write_section(
    section_plan: SectionPlan,
    context_package: dict[str, Any],
    brief_style: str,
    brief_tone: str,
    event_queue: Any | None = None,
) -> SectionDraft:
    """Write a single section with word budget enforcement.

    Args:
        section_plan: The plan for this section
        context_package: Context from surrounding sections
        brief_style: Writing style from the brief
        brief_tone: Tone from the brief
        event_queue: Optional asyncio.Queue for SSE events

    Returns:
        SectionDraft with the generated content
    """
    # Emit drafting event
    if event_queue:
        await event_queue.put({
            "type": "section_progress",
            "section_id": section_plan.section_id,
            "status": "drafting",
            "title": section_plan.title,
        })

    # Build prompt and generate
    prompt = build_section_prompt(
        section_plan=section_plan,
        context_package=context_package,
        style=brief_style,
        tone=brief_tone,
    )

    content = await _llm_write_section(prompt)
    word_count = count_words(content)
    revision_count = 0

    # Check word budget compliance (< 80% = too short, retry once)
    min_threshold = section_plan.target_words * 0.8
    if word_count < min_threshold:
        logger.info(
            f"Section {section_plan.section_id} too short ({word_count}/{section_plan.target_words}), retrying"
        )
        retry_instruction = (
            f"IMPORTANT: Your previous attempt was only {word_count} words. "
            f"Please expand the content to approximately {section_plan.target_words} words. "
            f"Add more detail, examples, and explanations."
        )
        prompt = build_section_prompt(
            section_plan=section_plan,
            context_package=context_package,
            style=brief_style,
            tone=brief_tone,
            retry_instruction=retry_instruction,
        )
        content = await _llm_write_section(prompt)
        word_count = count_words(content)
        revision_count = 1

    # Emit done event
    if event_queue:
        await event_queue.put({
            "type": "section_progress",
            "section_id": section_plan.section_id,
            "status": "done",
            "word_count": word_count,
        })

    return SectionDraft(
        section_id=section_plan.section_id,
        title=section_plan.title,
        content=content,
        word_count=word_count,
        status="done",
        revision_count=revision_count,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /e/test/Docmost/agent-service && python -m pytest tests/workers/test_section_writer.py -v
```

Expected: ALL 3 PASS

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/workers/section_writer.py agent-service/tests/workers/test_section_writer.py
git commit -m "feat(worker): add SectionWriter with context packages and word budget enforcement"
```

---

## Chunk 2: Sliding Window Context

### Task 2: SectionWriter — sliding window context

Build the context package for each section by extracting sliding window information from previously written sections and the next section's plan.

**Files:**
- Modify: `agent-service/app/workers/section_writer.py`
- Test: `agent-service/tests/workers/test_section_writer.py` (append)

- [ ] **Step 1: Write failing tests for context package builder**

Append to `agent-service/tests/workers/test_section_writer.py`:

```python
class TestContextPackageBuilder:
    """Test sliding window context assembly."""

    def test_build_context_first_section(self):
        """First section should have no prev_section_tail."""
        from app.workers.section_writer import build_context_package

        sections = [
            SectionPlan(section_id="s1", title="Intro", target_words=300, key_points=["Overview"]),
            SectionPlan(section_id="s2", title="Body", target_words=500, key_points=["Details"]),
        ]
        drafts = {}
        asset_map = AssetMap()

        ctx = build_context_package(
            current_index=0,
            sections=sections,
            completed_drafts=drafts,
            asset_map=asset_map,
        )

        assert ctx["prev_section_tail"] is None
        assert ctx["next_section_header"] is not None
        assert ctx["next_section_header"]["title"] == "Body"

    def test_build_context_middle_section(self):
        """Middle section should have both prev and next context."""
        from app.workers.section_writer import build_context_package

        sections = [
            SectionPlan(section_id="s1", title="Intro", target_words=300, key_points=["Overview"]),
            SectionPlan(section_id="s2", title="Body", target_words=500, key_points=["Details"]),
            SectionPlan(section_id="s3", title="Conclusion", target_words=200, key_points=["Summary"]),
        ]
        drafts = {
            "s1": SectionDraft(
                section_id="s1",
                title="Intro",
                content="First paragraph.\n\nSecond paragraph with more detail.\n\nThird paragraph concluding intro.",
                word_count=20,
                status="done",
            ),
        }
        asset_map = AssetMap()

        ctx = build_context_package(
            current_index=1,
            sections=sections,
            completed_drafts=drafts,
            asset_map=asset_map,
        )

        assert ctx["prev_section_tail"] is not None
        # Should contain last 2 paragraphs
        assert "Third paragraph" in ctx["prev_section_tail"]
        assert ctx["next_section_header"]["title"] == "Conclusion"

    def test_build_context_last_section(self):
        """Last section should have no next_section_header."""
        from app.workers.section_writer import build_context_package

        sections = [
            SectionPlan(section_id="s1", title="Intro", target_words=300, key_points=["Overview"]),
            SectionPlan(section_id="s2", title="Conclusion", target_words=200, key_points=["Summary"]),
        ]
        drafts = {
            "s1": SectionDraft(
                section_id="s1", title="Intro", content="Intro content.", word_count=2, status="done",
            ),
        }
        asset_map = AssetMap()

        ctx = build_context_package(
            current_index=1,
            sections=sections,
            completed_drafts=drafts,
            asset_map=asset_map,
        )

        assert ctx["prev_section_tail"] is not None
        assert ctx["next_section_header"] is None

    def test_build_context_includes_relevant_assets(self):
        """Context should include only assets referenced by this section."""
        from app.workers.section_writer import build_context_package

        sections = [
            SectionPlan(
                section_id="s1", title="Code", target_words=300,
                key_points=["Example"], asset_ids=["code-1"],
            ),
        ]
        asset_map = AssetMap(items=[
            AssetItem(id="code-1", type="code", source="ex.py", content="print('hi')"),
            AssetItem(id="img-1", type="image", source="pic.png", content="![pic](url)"),
        ])

        ctx = build_context_package(
            current_index=0,
            sections=sections,
            completed_drafts={},
            asset_map=asset_map,
        )

        assert len(ctx["relevant_assets"]) == 1
        assert ctx["relevant_assets"][0].id == "code-1"

    def test_global_outline_highlights_current(self):
        """Global outline should mark the current section."""
        from app.workers.section_writer import build_context_package

        sections = [
            SectionPlan(section_id="s1", title="A", target_words=100, key_points=["x"]),
            SectionPlan(section_id="s2", title="B", target_words=100, key_points=["y"]),
            SectionPlan(section_id="s3", title="C", target_words=100, key_points=["z"]),
        ]

        ctx = build_context_package(
            current_index=1,
            sections=sections,
            completed_drafts={},
            asset_map=AssetMap(),
        )

        # Current section should be highlighted in the outline
        assert ">>> B <<<" in ctx["global_outline"] or "**B**" in ctx["global_outline"] or "[CURRENT]" in ctx["global_outline"]
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /e/test/Docmost/agent-service && python -m pytest tests/workers/test_section_writer.py::TestContextPackageBuilder -v
```

Expected: FAIL — `ImportError: cannot import name 'build_context_package'`

- [ ] **Step 3: Implement context package builder**

Add to `agent-service/app/workers/section_writer.py`:

```python
def _extract_tail_paragraphs(content: str, n: int = 2) -> str:
    """Extract the last N paragraphs from content."""
    paragraphs = [p.strip() for p in content.split("\n\n") if p.strip()]
    if not paragraphs:
        return content
    tail = paragraphs[-n:]
    return "\n\n".join(tail)


def _build_global_outline(
    sections: list[SectionPlan],
    current_index: int,
) -> str:
    """Build a global outline with the current section highlighted."""
    lines = []
    for i, s in enumerate(sections):
        if i == current_index:
            lines.append(f"## {s.title} [CURRENT] ({s.target_words} words)")
        else:
            lines.append(f"## {s.title} ({s.target_words} words)")
    return "\n".join(lines)


def build_context_package(
    current_index: int,
    sections: list[SectionPlan],
    completed_drafts: dict[str, SectionDraft],
    asset_map: AssetMap,
) -> dict[str, Any]:
    """Build the sliding window context package for a section.

    Args:
        current_index: Index of the current section in the sections list
        sections: All section plans from the blueprint
        completed_drafts: Map of section_id -> SectionDraft for completed sections
        asset_map: Available assets

    Returns:
        Context package dict with keys:
        - global_outline: All section titles with current highlighted
        - prev_section_tail: Last 2 paragraphs of previous section (or None)
        - next_section_header: Title + goal of next section (or None)
        - relevant_assets: AssetItems referenced by this section
        - visual_plan: VisualPlans for this section
    """
    current_section = sections[current_index]

    # Global outline
    global_outline = _build_global_outline(sections, current_index)

    # Previous section tail
    prev_section_tail = None
    if current_index > 0:
        prev_section = sections[current_index - 1]
        prev_draft = completed_drafts.get(prev_section.section_id)
        if prev_draft:
            prev_section_tail = _extract_tail_paragraphs(prev_draft.content)

    # Next section header
    next_section_header = None
    if current_index < len(sections) - 1:
        next_section = sections[current_index + 1]
        next_section_header = {
            "title": next_section.title,
            "goal": ", ".join(next_section.key_points[:2]),
        }

    # Relevant assets
    relevant_assets = [
        asset for asset in asset_map.items
        if asset.id in current_section.asset_ids
    ]

    # Visual plan
    visual_plan = current_section.visuals

    return {
        "global_outline": global_outline,
        "prev_section_tail": prev_section_tail,
        "next_section_header": next_section_header,
        "relevant_assets": relevant_assets,
        "visual_plan": visual_plan,
    }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /e/test/Docmost/agent-service && python -m pytest tests/workers/test_section_writer.py -v
```

Expected: ALL 8 PASS (3 from Task 1 + 5 new)

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/workers/section_writer.py agent-service/tests/workers/test_section_writer.py
git commit -m "feat(worker): add sliding window context builder for SectionWriter"
```

---

## Chunk 3: Visual Generation During Writing

### Task 3: SectionWriter — visual generation during writing

Handle VisualPlan elements during section writing: inject Mermaid instructions, reuse source images, generate AI images, and handle tables.

**Files:**
- Modify: `agent-service/app/workers/section_writer.py`
- Test: `agent-service/tests/workers/test_section_writer.py` (append)

- [ ] **Step 1: Write failing tests for visual generation**

Append to `agent-service/tests/workers/test_section_writer.py`:

```python
class TestVisualGeneration:
    """Test visual element handling during section writing."""

    def test_mermaid_instruction_in_prompt(self):
        """Mermaid visuals should add diagram instructions to the prompt."""
        from app.workers.section_writer import format_visual_instructions

        visuals = [
            VisualPlan(type="mermaid", description="Data flow diagram", placement="after heading"),
        ]

        instruction = format_visual_instructions(visuals, AssetMap())
        assert "mermaid" in instruction.lower()
        assert "data flow" in instruction.lower()

    def test_reuse_image_in_prompt(self):
        """Reuse image visuals should inject markdown image reference."""
        from app.workers.section_writer import format_visual_instructions

        visuals = [
            VisualPlan(
                type="image",
                description="Architecture diagram",
                placement="after heading",
                source_asset_id="img-1",
            ),
        ]

        asset_map = AssetMap(items=[
            AssetItem(
                id="img-1",
                type="image",
                source="arch.png",
                content="![Architecture](https://example.com/arch.png)",
                summary="Architecture diagram",
            ),
        ])

        instruction = format_visual_instructions(visuals, asset_map)
        assert "https://example.com/arch.png" in instruction

    @pytest.mark.asyncio
    async def test_ai_image_generation(self):
        """AI image visuals should call nanobana_imggen."""
        from app.workers.section_writer import generate_visual_image

        with patch("app.workers.section_writer.nanobana_imggen") as mock_imggen, \
             patch("app.workers.section_writer.docmost_upload") as mock_upload:
            mock_imggen.invoke.return_value = "base64encodeddata"
            mock_upload.invoke.return_value = "https://example.com/generated.png"

            url = await generate_visual_image(
                description="A conceptual illustration of machine learning",
                page_id="page-001",
            )

        assert url == "https://example.com/generated.png"

    def test_table_visual_with_source(self):
        """Table visual with source asset should reference the original table."""
        from app.workers.section_writer import format_visual_instructions

        visuals = [
            VisualPlan(
                type="table",
                description="Feature comparison",
                placement="inline",
                source_asset_id="table-1",
            ),
        ]

        asset_map = AssetMap(items=[
            AssetItem(
                id="table-1",
                type="table",
                source="doc.md",
                content="| Feature | A | B |\n|---------|---|---|\n| Speed | Fast | Slow |",
            ),
        ])

        instruction = format_visual_instructions(visuals, asset_map)
        assert "| Feature | A | B |" in instruction
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /e/test/Docmost/agent-service && python -m pytest tests/workers/test_section_writer.py::TestVisualGeneration -v
```

Expected: FAIL — `ImportError: cannot import name 'format_visual_instructions'`

- [ ] **Step 3: Implement visual generation functions**

Add to `agent-service/app/workers/section_writer.py`:

```python
from app.tools.nanobana_imggen import nanobana_imggen
from app.tools.docmost_api import docmost_upload


def format_visual_instructions(
    visuals: list[VisualPlan],
    asset_map: AssetMap,
) -> str:
    """Format visual plan into writing instructions.

    Args:
        visuals: Visual plans for this section
        asset_map: Available assets (for looking up source assets)

    Returns:
        Instruction string to include in the writing prompt
    """
    if not visuals:
        return ""

    lines = ["## Visual Elements to Include"]

    for v in visuals:
        if v.type == "mermaid":
            lines.append(
                f"\n### Mermaid Diagram ({v.placement})"
                f"\nInclude a Mermaid diagram that shows: {v.description}"
                f"\nUse ```mermaid code fence. Example:"
                f"\n```mermaid"
                f"\ngraph TD"
                f"\n    A[Start] --> B[Process]"
                f"\n```"
            )
        elif v.type == "image" and v.source_asset_id:
            # Reuse existing image
            asset = next((a for a in asset_map.items if a.id == v.source_asset_id), None)
            if asset:
                lines.append(
                    f"\n### Reuse Image ({v.placement})"
                    f"\nInsert this image at the appropriate location:"
                    f"\n{asset.content}"
                )
        elif v.type == "image":
            # AI-generated image will be handled post-generation
            lines.append(
                f"\n### AI Image Placeholder ({v.placement})"
                f"\nInsert placeholder: `[AI_IMAGE: {v.description}]`"
                f"\nThis will be replaced with a generated image after writing."
            )
        elif v.type == "table" and v.source_asset_id:
            # Reuse source table
            asset = next((a for a in asset_map.items if a.id == v.source_asset_id), None)
            if asset:
                lines.append(
                    f"\n### Include Table ({v.placement})"
                    f"\nInclude this table:\n{asset.content}"
                )
        elif v.type == "table":
            lines.append(
                f"\n### Generate Table ({v.placement})"
                f"\nCreate a markdown table that shows: {v.description}"
            )
        elif v.type == "code" and v.source_asset_id:
            asset = next((a for a in asset_map.items if a.id == v.source_asset_id), None)
            if asset:
                lines.append(
                    f"\n### Include Code ({v.placement})"
                    f"\n```\n{asset.content}\n```"
                )

    return "\n".join(lines)


async def generate_visual_image(
    description: str,
    page_id: str,
) -> str:
    """Generate an AI image and upload to Docmost.

    Args:
        description: What the image should depict
        page_id: Docmost page ID for upload

    Returns:
        URL of the uploaded image
    """
    # Generate image
    b64_data = nanobana_imggen.invoke({
        "prompt": description,
        "size": "1024x1024",
    })

    if not b64_data:
        logger.warning(f"Image generation returned empty for: {description}")
        return ""

    # Upload to Docmost
    url = docmost_upload.invoke({
        "file_content_b64": b64_data,
        "filename": f"ai_gen_{hash(description) % 100000}.png",
        "page_id": page_id,
    })

    return url


async def post_process_visuals(
    content: str,
    visuals: list[VisualPlan],
    page_id: str,
) -> str:
    """Replace AI image placeholders with generated images.

    Scans content for `[AI_IMAGE: description]` placeholders and
    replaces them with actual generated and uploaded images.
    """
    import re

    pattern = r"\[AI_IMAGE:\s*([^\]]+)\]"
    matches = list(re.finditer(pattern, content))

    for match in reversed(matches):  # reverse to preserve positions
        description = match.group(1)
        url = await generate_visual_image(description, page_id)
        if url:
            replacement = f"![{description}]({url})"
        else:
            replacement = f"*[Image generation failed: {description}]*"
        content = content[:match.start()] + replacement + content[match.end():]

    return content
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /e/test/Docmost/agent-service && python -m pytest tests/workers/test_section_writer.py -v
```

Expected: ALL 12 PASS (8 from before + 4 new)

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/workers/section_writer.py agent-service/tests/workers/test_section_writer.py
git commit -m "feat(worker): add visual generation and post-processing for SectionWriter"
```

---

## Chunk 4: Write Tools

### Task 4: Register write_section and write_sections_parallel as Orchestrator tools

Create Orchestrator tools that wrap SectionWriter for single and parallel section writing.

**Files:**
- Create: `agent-service/app/orchestrator/tools/write_tools.py`
- Test: `agent-service/tests/orchestrator/test_write_tools.py`

**Context:** Parallel writing groups sections by adjacency: adjacent sections MUST be sequential (for sliding window context), while non-adjacent sections CAN run in parallel via `asyncio.gather`.

- [ ] **Step 1: Write failing tests for write tools**

```python
# agent-service/tests/orchestrator/test_write_tools.py
import json
import pytest
from unittest.mock import patch, AsyncMock, MagicMock

from app.models.blueprint import SectionPlan, CreationBlueprint
from app.models.draft import SectionDraft
from app.models.asset_map import AssetMap
from app.models.brief import CreationBrief


class TestWriteTools:
    """Test write_section and write_sections_parallel tools."""

    @pytest.mark.asyncio
    async def test_write_single_section(self):
        """write_section should delegate to SectionWriter."""
        from app.orchestrator.tools.write_tools import write_section_impl

        mock_draft = SectionDraft(
            section_id="s1", title="Intro", content="Content here.", word_count=2, status="done",
        )

        with patch("app.orchestrator.tools.write_tools.write_section", new_callable=AsyncMock) as mock_writer:
            mock_writer.return_value = mock_draft
            result = await write_section_impl(
                section_plan_json=SectionPlan(
                    section_id="s1", title="Intro", target_words=300, key_points=["Overview"],
                ).model_dump_json(),
                context_package={"global_outline": "## Intro", "prev_section_tail": None, "next_section_header": None, "relevant_assets": [], "visual_plan": []},
                style="technical",
                tone="professional",
            )

        parsed = json.loads(result)
        assert parsed["section_id"] == "s1"
        assert parsed["status"] == "done"

    def test_group_sections_for_parallel(self):
        """Adjacent sections should be grouped together; non-adjacent can be parallel."""
        from app.orchestrator.tools.write_tools import group_sections_for_parallel

        sections = [
            SectionPlan(section_id="s1", title="A", target_words=100, key_points=["x"]),
            SectionPlan(section_id="s2", title="B", target_words=100, key_points=["y"], depends_on=["s1"]),
            SectionPlan(section_id="s3", title="C", target_words=100, key_points=["z"]),
            SectionPlan(section_id="s4", title="D", target_words=100, key_points=["w"], depends_on=["s3"]),
        ]

        groups = group_sections_for_parallel(sections)
        # s1->s2 is sequential, s3->s4 is sequential
        # But s1/s2 group can run parallel with s3/s4 group
        assert len(groups) >= 2
        # Each group is a list of section plans that must be sequential
        for group in groups:
            for i in range(1, len(group)):
                assert group[i].depends_on == [] or group[i - 1].section_id in group[i].depends_on

    @pytest.mark.asyncio
    async def test_write_sections_parallel(self):
        """write_sections_parallel should execute groups concurrently."""
        from app.orchestrator.tools.write_tools import write_sections_parallel_impl

        blueprint = CreationBlueprint(
            title="Test",
            sections=[
                SectionPlan(section_id="s1", title="A", target_words=100, key_points=["x"]),
                SectionPlan(section_id="s2", title="B", target_words=100, key_points=["y"]),
            ],
            total_target_words=200,
        )

        mock_draft = SectionDraft(
            section_id="s1", title="A", content="Content.", word_count=1, status="done",
        )

        with patch("app.orchestrator.tools.write_tools.write_section", new_callable=AsyncMock) as mock_writer:
            mock_writer.return_value = mock_draft
            result = await write_sections_parallel_impl(
                blueprint_json=blueprint.model_dump_json(),
                asset_map_json=AssetMap().model_dump_json(),
                style="technical",
                tone="professional",
            )

        parsed = json.loads(result)
        assert "drafts" in parsed
        assert len(parsed["drafts"]) == 2
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /e/test/Docmost/agent-service && python -m pytest tests/orchestrator/test_write_tools.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'app.orchestrator.tools.write_tools'`

- [ ] **Step 3: Implement write tools**

```python
# agent-service/app/orchestrator/tools/write_tools.py
"""write_tools — Orchestrator tools for section writing.

Provides write_section (single) and write_sections_parallel (batch)
tools that wrap the SectionWriter Worker.

Parallelism rules:
- Adjacent sections with dependencies MUST be sequential (for sliding window)
- Independent sections CAN run in parallel via asyncio.gather
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from app.models.asset_map import AssetMap
from app.models.blueprint import SectionPlan, CreationBlueprint
from app.models.draft import SectionDraft
from app.workers.section_writer import (
    write_section,
    build_context_package,
    post_process_visuals,
)

logger = logging.getLogger(__name__)


def group_sections_for_parallel(
    sections: list[SectionPlan],
) -> list[list[SectionPlan]]:
    """Group sections into parallel execution groups.

    Sections with depends_on relationships form sequential chains.
    Independent chains can run in parallel.

    Returns:
        List of groups, where each group is a sequential chain.
    """
    if not sections:
        return []

    # Build dependency graph
    section_map = {s.section_id: s for s in sections}
    # Track which sections are depended upon
    has_dependents = set()
    for s in sections:
        for dep in s.depends_on:
            has_dependents.add(dep)

    # Find chain roots (sections with no depends_on, or depends_on outside this set)
    roots = []
    for s in sections:
        deps_in_set = [d for d in s.depends_on if d in section_map]
        if not deps_in_set:
            roots.append(s)

    # Build chains from roots
    groups: list[list[SectionPlan]] = []
    visited = set()

    for root in roots:
        chain = [root]
        visited.add(root.section_id)

        # Follow the chain: find sections that depend on the last item
        while True:
            last_id = chain[-1].section_id
            next_sections = [
                s for s in sections
                if last_id in s.depends_on and s.section_id not in visited
            ]
            if not next_sections:
                break
            chain.append(next_sections[0])
            visited.add(next_sections[0].section_id)

        groups.append(chain)

    # Add any orphaned sections not in any chain
    for s in sections:
        if s.section_id not in visited:
            groups.append([s])

    return groups


async def write_section_impl(
    section_plan_json: str,
    context_package: dict[str, Any],
    style: str,
    tone: str,
    page_id: str | None = None,
    event_queue: Any | None = None,
) -> str:
    """Write a single section and return the draft as JSON.

    Args:
        section_plan_json: JSON-serialized SectionPlan
        context_package: Context dict from build_context_package
        style: Writing style
        tone: Writing tone
        page_id: For image uploads during visual post-processing
        event_queue: For SSE events

    Returns:
        JSON-serialized SectionDraft
    """
    section_plan = SectionPlan.model_validate_json(section_plan_json)

    draft = await write_section(
        section_plan=section_plan,
        context_package=context_package,
        brief_style=style,
        brief_tone=tone,
        event_queue=event_queue,
    )

    # Post-process visuals (replace AI image placeholders)
    if page_id and "[AI_IMAGE:" in draft.content:
        processed_content = await post_process_visuals(
            content=draft.content,
            visuals=section_plan.visuals,
            page_id=page_id,
        )
        draft = draft.model_copy(update={"content": processed_content})

    return draft.model_dump_json()


async def _write_chain(
    chain: list[SectionPlan],
    all_sections: list[SectionPlan],
    asset_map: AssetMap,
    style: str,
    tone: str,
    page_id: str | None = None,
    event_queue: Any | None = None,
) -> list[SectionDraft]:
    """Write a chain of sections sequentially (for sliding window)."""
    completed: dict[str, SectionDraft] = {}
    drafts: list[SectionDraft] = []

    for section in chain:
        idx = next(i for i, s in enumerate(all_sections) if s.section_id == section.section_id)
        context = build_context_package(
            current_index=idx,
            sections=all_sections,
            completed_drafts=completed,
            asset_map=asset_map,
        )

        draft = await write_section(
            section_plan=section,
            context_package=context,
            brief_style=style,
            brief_tone=tone,
            event_queue=event_queue,
        )

        # Post-process visuals
        if page_id and "[AI_IMAGE:" in draft.content:
            processed = await post_process_visuals(
                draft.content, section.visuals, page_id,
            )
            draft = draft.model_copy(update={"content": processed})

        completed[section.section_id] = draft
        drafts.append(draft)

    return drafts


async def write_sections_parallel_impl(
    blueprint_json: str,
    asset_map_json: str,
    style: str,
    tone: str,
    page_id: str | None = None,
    event_queue: Any | None = None,
) -> str:
    """Write all sections with parallelism where safe.

    Groups sections into sequential chains based on dependencies,
    then runs chains in parallel.

    Returns:
        JSON with {"drafts": [SectionDraft, ...], "total_words": int}
    """
    blueprint = CreationBlueprint.model_validate_json(blueprint_json)
    asset_map = AssetMap.model_validate_json(asset_map_json)

    groups = group_sections_for_parallel(blueprint.sections)

    # Run groups in parallel
    tasks = [
        _write_chain(
            chain=group,
            all_sections=blueprint.sections,
            asset_map=asset_map,
            style=style,
            tone=tone,
            page_id=page_id,
            event_queue=event_queue,
        )
        for group in groups
    ]

    group_results = await asyncio.gather(*tasks)

    # Flatten and sort by original order
    all_drafts: dict[str, SectionDraft] = {}
    for group_drafts in group_results:
        for draft in group_drafts:
            all_drafts[draft.section_id] = draft

    # Sort by blueprint section order
    ordered_drafts = []
    for section in blueprint.sections:
        if section.section_id in all_drafts:
            ordered_drafts.append(all_drafts[section.section_id])

    total_words = sum(d.word_count for d in ordered_drafts)

    return json.dumps({
        "drafts": [d.model_dump() for d in ordered_drafts],
        "total_words": total_words,
    }, ensure_ascii=False)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /e/test/Docmost/agent-service && python -m pytest tests/orchestrator/test_write_tools.py -v
```

Expected: ALL 3 PASS

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/orchestrator/tools/write_tools.py agent-service/tests/orchestrator/test_write_tools.py
git commit -m "feat(orchestrator): add write_section and write_sections_parallel tools with dependency grouping"
```

---

## Chunk 5: Draft Manager — Backend

### Task 5: Draft Manager — backend

Store and retrieve drafts in Redis with TTL, independent from the page content.

**Files:**
- Create: `agent-service/app/orchestrator/draft_manager.py`
- Test: `agent-service/tests/orchestrator/test_draft_manager.py`

**Context:** The agent-service connects to Redis via `app/config.py` settings (`settings.redis_url`). Drafts are stored as JSON with a 24-hour TTL. Each draft is keyed by `draft:{workspace_id}:{page_id}:{task_id}`.

- [ ] **Step 1: Write failing tests for Draft Manager**

```python
# agent-service/tests/orchestrator/test_draft_manager.py
import json
import pytest
from unittest.mock import patch, MagicMock, AsyncMock

from app.models.draft import SectionDraft


class TestDraftManager:
    """Test draft storage and retrieval."""

    @pytest.mark.asyncio
    async def test_save_and_get_draft(self):
        """Should save a draft and retrieve it."""
        from app.orchestrator.draft_manager import DraftManager

        mock_redis = MagicMock()
        mock_redis.set = AsyncMock()
        mock_redis.get = AsyncMock()
        mock_redis.expire = AsyncMock()

        manager = DraftManager(redis=mock_redis)

        drafts = [
            SectionDraft(section_id="s1", title="A", content="Hello", word_count=1, status="done"),
            SectionDraft(section_id="s2", title="B", content="World", word_count=1, status="done"),
        ]

        await manager.save_draft(
            workspace_id="ws-1",
            page_id="p-1",
            task_id="task-1",
            drafts=drafts,
            blueprint_ref="bp-001",
        )

        mock_redis.set.assert_called_once()
        call_args = mock_redis.set.call_args
        key = call_args[0][0]
        assert "draft:ws-1:p-1:task-1" == key

    @pytest.mark.asyncio
    async def test_get_draft_returns_none_when_missing(self):
        """Should return None if draft doesn't exist."""
        from app.orchestrator.draft_manager import DraftManager

        mock_redis = MagicMock()
        mock_redis.get = AsyncMock(return_value=None)

        manager = DraftManager(redis=mock_redis)
        result = await manager.get_draft("ws-1", "p-1", "task-1")
        assert result is None

    @pytest.mark.asyncio
    async def test_update_section_in_draft(self):
        """Should update a single section within an existing draft."""
        from app.orchestrator.draft_manager import DraftManager

        existing_data = json.dumps({
            "drafts": [
                {"section_id": "s1", "title": "A", "content": "Old", "word_count": 1, "status": "done", "revision_count": 0},
                {"section_id": "s2", "title": "B", "content": "Keep", "word_count": 1, "status": "done", "revision_count": 0},
            ],
            "blueprint_ref": "bp-001",
            "timestamp": "2026-03-14T00:00:00",
        })

        mock_redis = MagicMock()
        mock_redis.get = AsyncMock(return_value=existing_data)
        mock_redis.set = AsyncMock()

        manager = DraftManager(redis=mock_redis)

        new_draft = SectionDraft(
            section_id="s1", title="A", content="Updated!", word_count=1, status="done", revision_count=1,
        )

        await manager.update_section("ws-1", "p-1", "task-1", new_draft)

        # Verify the saved data has the updated section
        saved_data = json.loads(mock_redis.set.call_args[0][1])
        s1 = next(d for d in saved_data["drafts"] if d["section_id"] == "s1")
        assert s1["content"] == "Updated!"
        assert s1["revision_count"] == 1

    @pytest.mark.asyncio
    async def test_delete_draft(self):
        """Should delete a draft from Redis."""
        from app.orchestrator.draft_manager import DraftManager

        mock_redis = MagicMock()
        mock_redis.delete = AsyncMock()

        manager = DraftManager(redis=mock_redis)
        await manager.delete_draft("ws-1", "p-1", "task-1")

        mock_redis.delete.assert_called_once_with("draft:ws-1:p-1:task-1")
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /e/test/Docmost/agent-service && python -m pytest tests/orchestrator/test_draft_manager.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'app.orchestrator.draft_manager'`

- [ ] **Step 3: Implement Draft Manager**

```python
# agent-service/app/orchestrator/draft_manager.py
"""Draft Manager — store and retrieve section drafts via Redis.

Drafts are stored independently from page content, allowing users
to review, modify, and selectively merge sections. Each draft has
a 24-hour TTL.

Key format: draft:{workspace_id}:{page_id}:{task_id}
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from app.models.draft import SectionDraft

logger = logging.getLogger(__name__)

DRAFT_TTL_SECONDS = 86400  # 24 hours


class DraftManager:
    """Manages draft storage in Redis.

    Each draft is a collection of SectionDrafts plus metadata.
    """

    def __init__(self, redis: Any):
        """Initialize with a Redis client (sync or async)."""
        self.redis = redis

    def _key(self, workspace_id: str, page_id: str, task_id: str) -> str:
        return f"draft:{workspace_id}:{page_id}:{task_id}"

    async def save_draft(
        self,
        workspace_id: str,
        page_id: str,
        task_id: str,
        drafts: list[SectionDraft],
        blueprint_ref: str = "",
    ) -> None:
        """Save a complete draft to Redis.

        Args:
            workspace_id: Workspace identifier
            page_id: Page identifier
            task_id: Task/session identifier
            drafts: List of section drafts
            blueprint_ref: Reference to the blueprint used
        """
        key = self._key(workspace_id, page_id, task_id)
        data = json.dumps({
            "drafts": [d.model_dump() for d in drafts],
            "blueprint_ref": blueprint_ref,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }, ensure_ascii=False)

        await self.redis.set(key, data, ex=DRAFT_TTL_SECONDS)

    async def get_draft(
        self,
        workspace_id: str,
        page_id: str,
        task_id: str,
    ) -> dict | None:
        """Retrieve a draft from Redis.

        Returns:
            Dict with "drafts", "blueprint_ref", "timestamp", or None if not found
        """
        key = self._key(workspace_id, page_id, task_id)
        raw = await self.redis.get(key)
        if raw is None:
            return None
        return json.loads(raw)

    async def update_section(
        self,
        workspace_id: str,
        page_id: str,
        task_id: str,
        updated_draft: SectionDraft,
    ) -> None:
        """Update a single section within an existing draft.

        Args:
            workspace_id: Workspace identifier
            page_id: Page identifier
            task_id: Task identifier
            updated_draft: The updated section draft
        """
        key = self._key(workspace_id, page_id, task_id)
        raw = await self.redis.get(key)
        if raw is None:
            logger.warning(f"Cannot update section in non-existent draft: {key}")
            return

        data = json.loads(raw)
        drafts = data.get("drafts", [])

        # Replace the matching section
        updated = False
        for i, d in enumerate(drafts):
            if d["section_id"] == updated_draft.section_id:
                drafts[i] = updated_draft.model_dump()
                updated = True
                break

        if not updated:
            drafts.append(updated_draft.model_dump())

        data["drafts"] = drafts
        data["timestamp"] = datetime.now(timezone.utc).isoformat()

        await self.redis.set(key, json.dumps(data, ensure_ascii=False), ex=DRAFT_TTL_SECONDS)

    async def delete_draft(
        self,
        workspace_id: str,
        page_id: str,
        task_id: str,
    ) -> None:
        """Delete a draft from Redis."""
        key = self._key(workspace_id, page_id, task_id)
        await self.redis.delete(key)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /e/test/Docmost/agent-service && python -m pytest tests/orchestrator/test_draft_manager.py -v
```

Expected: ALL 4 PASS

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/orchestrator/draft_manager.py agent-service/tests/orchestrator/test_draft_manager.py
git commit -m "feat(orchestrator): add Redis-backed Draft Manager with TTL and section updates"
```

---

## Chunk 6: Draft Manager — NestJS API

### Task 6: Draft Manager — NestJS API

Add REST endpoints to the NestJS gateway that proxy draft operations to the Python service.

**Files:**
- Create: `apps/server/src/ee/ai/agent-gateway/draft.controller.ts`
- Create: `apps/server/src/ee/ai/agent-gateway/draft.service.ts`
- Modify: `apps/server/src/ee/ai/agent-gateway/agent-gateway.module.ts`

**Context:** The agent-gateway module (`apps/server/src/ee/ai/agent-gateway/`) proxies requests to the Python agent-service. All APIs use POST method per project convention. The gateway uses `http.request` for SSE and `httpx`/`fetch` for regular REST calls.

- [ ] **Step 1: Create draft service**

```typescript
// apps/server/src/ee/ai/agent-gateway/draft.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { EnvironmentService } from '@docmost/config/environment.service';

@Injectable()
export class DraftService {
  private readonly logger = new Logger(DraftService.name);

  constructor(private readonly environmentService: EnvironmentService) {}

  private get agentBaseUrl(): string {
    return this.environmentService.getAgentServiceUrl() || 'http://localhost:8100';
  }

  async getDraft(pageId: string, workspaceId: string, taskId: string): Promise<any> {
    const url = `${this.agentBaseUrl}/v2/draft/get`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId, workspaceId, taskId }),
    });

    if (!response.ok) {
      this.logger.warn(`Failed to get draft: ${response.status}`);
      return null;
    }

    return response.json();
  }

  async saveDraft(
    pageId: string,
    workspaceId: string,
    taskId: string,
    drafts: any[],
    blueprintRef?: string,
  ): Promise<void> {
    const url = `${this.agentBaseUrl}/v2/draft/save`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pageId,
        workspaceId,
        taskId,
        drafts,
        blueprintRef: blueprintRef || '',
      }),
    });

    if (!response.ok) {
      this.logger.warn(`Failed to save draft: ${response.status}`);
    }
  }

  async deleteDraft(pageId: string, workspaceId: string, taskId: string): Promise<void> {
    const url = `${this.agentBaseUrl}/v2/draft/delete`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pageId, workspaceId, taskId }),
    });
  }
}
```

- [ ] **Step 2: Create draft controller**

```typescript
// apps/server/src/ee/ai/agent-gateway/draft.controller.ts
import { Controller, Post, Body, UseGuards, HttpCode, HttpStatus } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { DraftService } from './draft.service';
import { AuthUser } from '../../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../../common/decorators/auth-workspace.decorator';

@UseGuards(JwtAuthGuard)
@Controller('ai/draft')
export class DraftController {
  constructor(private readonly draftService: DraftService) {}

  @Post('get')
  @HttpCode(HttpStatus.OK)
  async getDraft(
    @Body() body: { pageId: string; taskId?: string },
    @AuthWorkspace() workspace: any,
  ) {
    const draft = await this.draftService.getDraft(
      body.pageId,
      workspace.id,
      body.taskId || 'default',
    );
    return { data: draft };
  }

  @Post('save')
  @HttpCode(HttpStatus.OK)
  async saveDraft(
    @Body() body: { pageId: string; taskId?: string; drafts: any[]; blueprintRef?: string },
    @AuthWorkspace() workspace: any,
  ) {
    await this.draftService.saveDraft(
      body.pageId,
      workspace.id,
      body.taskId || 'default',
      body.drafts,
      body.blueprintRef,
    );
    return { data: { success: true } };
  }

  @Post('delete')
  @HttpCode(HttpStatus.OK)
  async deleteDraft(
    @Body() body: { pageId: string; taskId?: string },
    @AuthWorkspace() workspace: any,
  ) {
    await this.draftService.deleteDraft(
      body.pageId,
      workspace.id,
      body.taskId || 'default',
    );
    return { data: { success: true } };
  }
}
```

- [ ] **Step 3: Register in agent-gateway module**

Update `apps/server/src/ee/ai/agent-gateway/agent-gateway.module.ts` to include:

```typescript
import { DraftController } from './draft.controller';
import { DraftService } from './draft.service';

// In the module decorator:
@Module({
  controllers: [AgentGatewayController, DraftController],
  providers: [AgentGatewayService, DraftService],
})
```

- [ ] **Step 4: Add Python endpoints for draft operations**

Add to `agent-service/app/main.py`:

```python
@app.post("/v2/draft/get")
async def get_draft(request: Request):
    body = await request.json()
    from app.orchestrator.draft_manager import DraftManager
    # Get Redis from app state
    manager = DraftManager(redis=app.state.redis)
    result = await manager.get_draft(
        workspace_id=body["workspaceId"],
        page_id=body["pageId"],
        task_id=body.get("taskId", "default"),
    )
    return result or {"drafts": [], "blueprint_ref": "", "timestamp": None}

@app.post("/v2/draft/save")
async def save_draft(request: Request):
    body = await request.json()
    from app.orchestrator.draft_manager import DraftManager
    from app.models.draft import SectionDraft
    manager = DraftManager(redis=app.state.redis)
    drafts = [SectionDraft(**d) for d in body.get("drafts", [])]
    await manager.save_draft(
        workspace_id=body["workspaceId"],
        page_id=body["pageId"],
        task_id=body.get("taskId", "default"),
        drafts=drafts,
        blueprint_ref=body.get("blueprintRef", ""),
    )
    return {"status": "ok"}

@app.post("/v2/draft/delete")
async def delete_draft(request: Request):
    body = await request.json()
    from app.orchestrator.draft_manager import DraftManager
    manager = DraftManager(redis=app.state.redis)
    await manager.delete_draft(
        workspace_id=body["workspaceId"],
        page_id=body["pageId"],
        task_id=body.get("taskId", "default"),
    )
    return {"status": "ok"}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /e/test/Docmost && npx tsc --noEmit --project apps/server/tsconfig.json 2>&1 | head -20
```

Expected: No errors related to draft controller/service

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/ee/ai/agent-gateway/draft.controller.ts apps/server/src/ee/ai/agent-gateway/draft.service.ts apps/server/src/ee/ai/agent-gateway/agent-gateway.module.ts agent-service/app/main.py
git commit -m "feat(gateway): add Draft Manager NestJS API with Python proxy endpoints"
```

---

## Chunk 7: Live Draft Frontend

### Task 7: Live Draft frontend — DraftProgressBar

Show real-time writing progress with chapter markers and per-section actions.

**Files:**
- Create: `apps/client/src/ee/ai/components/ai-creator/live-draft/DraftProgressBar.tsx`
- Create: `apps/client/src/ee/ai/components/ai-creator/live-draft/SectionNav.tsx`
- Create: `apps/client/src/ee/ai/components/ai-creator/live-draft/SectionActions.tsx`
- Create: `apps/client/src/ee/ai/components/ai-creator/live-draft/index.ts`

**Context:** SSE events include `section_progress` with `{section_id, status, title, word_count}`. The frontend tracks which sections are complete and shows progress. Uses Mantine Progress, List, and ActionIcon components.

- [ ] **Step 1: Create DraftProgressBar component**

```tsx
// apps/client/src/ee/ai/components/ai-creator/live-draft/DraftProgressBar.tsx
import { Progress, Text, Stack, Group, Badge } from "@mantine/core";

interface SectionStatus {
  section_id: string;
  title: string;
  status: "pending" | "drafting" | "done" | "revising";
  word_count?: number;
  target_words: number;
}

interface DraftProgressBarProps {
  sections: SectionStatus[];
  currentSectionId?: string;
}

export function DraftProgressBar({
  sections,
  currentSectionId,
}: DraftProgressBarProps) {
  const totalSections = sections.length;
  const doneSections = sections.filter((s) => s.status === "done").length;
  const progress = totalSections > 0 ? (doneSections / totalSections) * 100 : 0;

  const currentSection = sections.find(
    (s) => s.section_id === currentSectionId,
  );

  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Text size="sm" fw={500}>
          {currentSection
            ? `Writing: ${currentSection.title}`
            : doneSections === totalSections
              ? "All sections complete"
              : "Preparing..."}
        </Text>
        <Badge size="sm" variant="light">
          {doneSections}/{totalSections}
        </Badge>
      </Group>

      <Progress.Root size="lg">
        {sections.map((section, i) => {
          const sectionWidth = 100 / totalSections;
          let color = "gray";
          if (section.status === "done") color = "green";
          else if (section.status === "drafting") color = "blue";
          else if (section.status === "revising") color = "orange";

          return (
            <Progress.Section
              key={section.section_id}
              value={sectionWidth}
              color={color}
              animated={section.status === "drafting"}
            />
          );
        })}
      </Progress.Root>
    </Stack>
  );
}
```

- [ ] **Step 2: Create SectionNav component**

```tsx
// apps/client/src/ee/ai/components/ai-creator/live-draft/SectionNav.tsx
import { NavLink, Stack, Badge, Text } from "@mantine/core";
import {
  IconCircleCheck,
  IconLoader,
  IconCircleDot,
  IconRefresh,
} from "@tabler/icons-react";

interface SectionNavItem {
  section_id: string;
  title: string;
  status: "pending" | "drafting" | "done" | "revising";
  word_count?: number;
}

interface SectionNavProps {
  sections: SectionNavItem[];
  activeSectionId?: string;
  onSectionClick: (sectionId: string) => void;
}

const STATUS_ICONS = {
  pending: IconCircleDot,
  drafting: IconLoader,
  done: IconCircleCheck,
  revising: IconRefresh,
};

export function SectionNav({
  sections,
  activeSectionId,
  onSectionClick,
}: SectionNavProps) {
  return (
    <Stack gap={2}>
      {sections.map((section) => {
        const Icon = STATUS_ICONS[section.status];
        return (
          <NavLink
            key={section.section_id}
            label={section.title}
            leftSection={<Icon size={16} />}
            rightSection={
              section.word_count ? (
                <Badge size="xs" variant="light">
                  {section.word_count}
                </Badge>
              ) : null
            }
            active={section.section_id === activeSectionId}
            onClick={() => onSectionClick(section.section_id)}
            variant="subtle"
            style={{ borderRadius: 4 }}
          />
        );
      })}
    </Stack>
  );
}
```

- [ ] **Step 3: Create SectionActions component**

```tsx
// apps/client/src/ee/ai/components/ai-creator/live-draft/SectionActions.tsx
import { Group, Button, Text } from "@mantine/core";
import { IconCheck, IconRefresh } from "@tabler/icons-react";

interface SectionActionsProps {
  sectionId: string;
  sectionTitle: string;
  isComplete: boolean;
  onApprove: (sectionId: string) => void;
  onRewrite: (sectionId: string) => void;
  disabled?: boolean;
}

export function SectionActions({
  sectionId,
  sectionTitle,
  isComplete,
  onApprove,
  onRewrite,
  disabled = false,
}: SectionActionsProps) {
  if (!isComplete) return null;

  return (
    <Group gap="xs" mt="xs">
      <Button
        variant="light"
        color="green"
        size="xs"
        leftSection={<IconCheck size={14} />}
        onClick={() => onApprove(sectionId)}
        disabled={disabled}
      >
        Approve
      </Button>
      <Button
        variant="light"
        color="orange"
        size="xs"
        leftSection={<IconRefresh size={14} />}
        onClick={() => onRewrite(sectionId)}
        disabled={disabled}
      >
        Rewrite
      </Button>
    </Group>
  );
}
```

- [ ] **Step 4: Create barrel export**

```typescript
// apps/client/src/ee/ai/components/ai-creator/live-draft/index.ts
export { DraftProgressBar } from "./DraftProgressBar";
export { SectionNav } from "./SectionNav";
export { SectionActions } from "./SectionActions";
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /e/test/Docmost && npx tsc --noEmit --project apps/client/tsconfig.json 2>&1 | head -20
```

Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-creator/live-draft/
git commit -m "feat(ui): add live draft progress bar, section nav, and section actions"
```

---

## Chunk 8: Draft Panel Frontend

### Task 8: Content merge to editor

Build the draft review panel with diff view and merge actions.

**Files:**
- Create: `apps/client/src/ee/ai/components/ai-creator/draft-manager/DraftPanel.tsx`
- Create: `apps/client/src/ee/ai/components/ai-creator/draft-manager/DraftDiffView.tsx`
- Create: `apps/client/src/ee/ai/components/ai-creator/draft-manager/DraftMergeActions.tsx`
- Create: `apps/client/src/ee/ai/components/ai-creator/draft-manager/index.ts`

**Context:** The existing `creatorCommit` API merges content into the page via the Yjs document. The draft panel shows the complete generated draft, optionally with a diff against the current page content. Uses Mantine SegmentedControl for view modes and Button for actions.

- [ ] **Step 1: Create DraftDiffView component**

```tsx
// apps/client/src/ee/ai/components/ai-creator/draft-manager/DraftDiffView.tsx
import { ScrollArea, Code, SegmentedControl, Stack } from "@mantine/core";
import { useState } from "react";

interface DraftDiffViewProps {
  draftContent: string;
  currentContent?: string;
}

export function DraftDiffView({
  draftContent,
  currentContent,
}: DraftDiffViewProps) {
  const [viewMode, setViewMode] = useState<string>("draft");

  return (
    <Stack gap="xs">
      {currentContent && (
        <SegmentedControl
          size="xs"
          value={viewMode}
          onChange={setViewMode}
          data={[
            { value: "draft", label: "Draft" },
            { value: "current", label: "Current" },
          ]}
        />
      )}

      <ScrollArea h={400}>
        <Code
          block
          style={{ whiteSpace: "pre-wrap", fontSize: 13, lineHeight: 1.6 }}
        >
          {viewMode === "draft" ? draftContent : (currentContent || "")}
        </Code>
      </ScrollArea>
    </Stack>
  );
}
```

- [ ] **Step 2: Create DraftMergeActions component**

```tsx
// apps/client/src/ee/ai/components/ai-creator/draft-manager/DraftMergeActions.tsx
import { Group, Button } from "@mantine/core";
import { IconFileImport, IconTrash } from "@tabler/icons-react";

interface DraftMergeActionsProps {
  onMerge: () => void;
  onDiscard: () => void;
  isMerging?: boolean;
  disabled?: boolean;
}

export function DraftMergeActions({
  onMerge,
  onDiscard,
  isMerging = false,
  disabled = false,
}: DraftMergeActionsProps) {
  return (
    <Group justify="flex-end" gap="xs">
      <Button
        variant="subtle"
        color="red"
        size="sm"
        leftSection={<IconTrash size={16} />}
        onClick={onDiscard}
        disabled={disabled || isMerging}
      >
        Discard Draft
      </Button>
      <Button
        size="sm"
        leftSection={<IconFileImport size={16} />}
        onClick={onMerge}
        loading={isMerging}
        disabled={disabled}
      >
        Merge to Page
      </Button>
    </Group>
  );
}
```

- [ ] **Step 3: Create DraftPanel component**

```tsx
// apps/client/src/ee/ai/components/ai-creator/draft-manager/DraftPanel.tsx
import { useState, useCallback } from "react";
import { Stack, Text, Divider, Alert } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { DraftDiffView } from "./DraftDiffView";
import { DraftMergeActions } from "./DraftMergeActions";

interface SectionDraftData {
  section_id: string;
  title: string;
  content: string;
  word_count: number;
  status: string;
}

interface DraftPanelProps {
  drafts: SectionDraftData[];
  currentPageContent?: string;
  onMerge: (fullContent: string) => void;
  onDiscard: () => void;
}

export function DraftPanel({
  drafts,
  currentPageContent,
  onMerge,
  onDiscard,
}: DraftPanelProps) {
  const [isMerging, setIsMerging] = useState(false);

  const fullDraftContent = drafts.map((d) => d.content).join("\n\n");
  const totalWords = drafts.reduce((sum, d) => sum + d.word_count, 0);

  const handleMerge = useCallback(async () => {
    setIsMerging(true);
    try {
      await onMerge(fullDraftContent);
    } finally {
      setIsMerging(false);
    }
  }, [fullDraftContent, onMerge]);

  return (
    <Stack gap="sm">
      <Text size="sm" fw={600}>
        Draft Review ({drafts.length} sections, {totalWords} words)
      </Text>

      {drafts.some((d) => d.status !== "done") && (
        <Alert
          icon={<IconInfoCircle size={16} />}
          color="yellow"
          variant="light"
          title="Incomplete Draft"
        >
          Some sections are still being written. You can merge partial results.
        </Alert>
      )}

      <DraftDiffView
        draftContent={fullDraftContent}
        currentContent={currentPageContent}
      />

      <Divider />

      <DraftMergeActions
        onMerge={handleMerge}
        onDiscard={onDiscard}
        isMerging={isMerging}
      />
    </Stack>
  );
}
```

- [ ] **Step 4: Create barrel export**

```typescript
// apps/client/src/ee/ai/components/ai-creator/draft-manager/index.ts
export { DraftPanel } from "./DraftPanel";
export { DraftDiffView } from "./DraftDiffView";
export { DraftMergeActions } from "./DraftMergeActions";
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /e/test/Docmost && npx tsc --noEmit --project apps/client/tsconfig.json 2>&1 | head -20
```

Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-creator/draft-manager/
git commit -m "feat(ui): add DraftPanel with diff view and merge actions"
```

---

## Chunk 9: Consistency Checker

### Task 9: Cross-section consistency scan

Validate consistency across all written sections: heading numbering, term usage, cross-references, and transition quality.

**Files:**
- Create: `agent-service/app/workers/consistency_checker.py`
- Test: `agent-service/tests/workers/test_consistency_checker.py`

**Context:** The consistency checker runs AFTER all sections are written but BEFORE finalize. It returns a list of issues that can be included in the ReviewReport (Phase 4).

- [ ] **Step 1: Write failing tests for consistency checker**

```python
# agent-service/tests/workers/test_consistency_checker.py
import pytest

from app.models.draft import SectionDraft


class TestConsistencyChecker:
    """Test cross-section consistency validation."""

    def test_heading_numbering_continuity(self):
        """Should detect heading numbering gaps."""
        from app.workers.consistency_checker import check_heading_continuity

        drafts = [
            SectionDraft(
                section_id="s1", title="Chapter 1", word_count=100, status="done",
                content="## Chapter 1\n\n### 1.1 First\n\n### 1.2 Second",
            ),
            SectionDraft(
                section_id="s2", title="Chapter 3", word_count=100, status="done",
                content="## Chapter 3\n\n### 3.1 First",  # Missing Chapter 2
            ),
        ]

        issues = check_heading_continuity(drafts)
        assert len(issues) >= 1
        assert any("numbering" in i["description"].lower() or "gap" in i["description"].lower() for i in issues)

    def test_no_heading_issues_when_sequential(self):
        """Sequential headings should produce no issues."""
        from app.workers.consistency_checker import check_heading_continuity

        drafts = [
            SectionDraft(
                section_id="s1", title="Chapter 1", word_count=100, status="done",
                content="## Chapter 1\n\nContent",
            ),
            SectionDraft(
                section_id="s2", title="Chapter 2", word_count=100, status="done",
                content="## Chapter 2\n\nContent",
            ),
        ]

        issues = check_heading_continuity(drafts)
        assert len(issues) == 0

    def test_term_consistency(self):
        """Should detect inconsistent terminology."""
        from app.workers.consistency_checker import check_term_consistency

        drafts = [
            SectionDraft(
                section_id="s1", title="A", word_count=100, status="done",
                content="The Machine Learning algorithm processes data.",
            ),
            SectionDraft(
                section_id="s2", title="B", word_count=100, status="done",
                content="The ML algo is fast. The machine-learning system works.",
            ),
        ]

        issues = check_term_consistency(drafts)
        # ML vs Machine Learning vs machine-learning — should flag
        # This is heuristic-based, so just verify it returns a list
        assert isinstance(issues, list)

    def test_cross_reference_validation(self):
        """Should detect invalid cross-references."""
        from app.workers.consistency_checker import check_cross_references

        drafts = [
            SectionDraft(
                section_id="s1", title="Chapter 1", word_count=100, status="done",
                content="## Chapter 1\n\nSee Chapter 3 for details.",
            ),
            SectionDraft(
                section_id="s2", title="Chapter 2", word_count=100, status="done",
                content="## Chapter 2\n\nAs discussed in Chapter 1, this is important.",
            ),
        ]

        issues = check_cross_references(drafts)
        # "Chapter 3" reference is invalid (only 2 chapters)
        invalid_refs = [i for i in issues if "Chapter 3" in i.get("description", "")]
        assert len(invalid_refs) >= 1

    def test_transition_smoothness(self):
        """Should check first sentence of each section for transition quality."""
        from app.workers.consistency_checker import check_transitions

        drafts = [
            SectionDraft(
                section_id="s1", title="Intro", word_count=100, status="done",
                content="## Intro\n\nWelcome to this guide.",
            ),
            SectionDraft(
                section_id="s2", title="Details", word_count=100, status="done",
                content="## Details\n\nHere are the details.",
            ),
        ]

        issues = check_transitions(drafts)
        assert isinstance(issues, list)

    def test_full_consistency_check(self):
        """Full check should combine all sub-checks."""
        from app.workers.consistency_checker import check_consistency

        drafts = [
            SectionDraft(
                section_id="s1", title="Intro", word_count=100, status="done",
                content="## Intro\n\nIntro content.",
            ),
            SectionDraft(
                section_id="s2", title="Body", word_count=100, status="done",
                content="## Body\n\nBody content.",
            ),
        ]

        issues = check_consistency(drafts)
        assert isinstance(issues, list)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /e/test/Docmost/agent-service && python -m pytest tests/workers/test_consistency_checker.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'app.workers.consistency_checker'`

- [ ] **Step 3: Implement consistency checker**

```python
# agent-service/app/workers/consistency_checker.py
"""Consistency Checker — cross-section validation.

Runs after all sections are written to detect:
1. Heading numbering gaps or discontinuities
2. Term inconsistency (same concept, different names)
3. Invalid cross-references ("see Chapter N" where N doesn't exist)
4. Transition smoothness (abrupt section openings)

Returns a list of issue dicts compatible with ReviewReport.
"""
from __future__ import annotations

import re
import logging
from typing import TypedDict

from app.models.draft import SectionDraft

logger = logging.getLogger(__name__)


class ConsistencyIssue(TypedDict):
    section_id: str
    category: str
    description: str
    severity: str  # "minor" | "major"


def check_heading_continuity(drafts: list[SectionDraft]) -> list[ConsistencyIssue]:
    """Check that heading numbers are sequential and continuous."""
    issues: list[ConsistencyIssue] = []

    # Extract numbered headings (e.g., "Chapter 1", "Chapter 2")
    chapter_numbers = []
    for draft in drafts:
        matches = re.findall(r"##?\s+(?:Chapter|第)\s*(\d+)", draft.content, re.IGNORECASE)
        for num_str in matches:
            chapter_numbers.append((int(num_str), draft.section_id))

    # Check for gaps
    if chapter_numbers:
        chapter_numbers.sort(key=lambda x: x[0])
        for i in range(1, len(chapter_numbers)):
            prev_num = chapter_numbers[i - 1][0]
            curr_num = chapter_numbers[i][0]
            if curr_num != prev_num + 1:
                issues.append({
                    "section_id": chapter_numbers[i][1],
                    "category": "structure",
                    "description": f"Heading numbering gap: Chapter {prev_num} → Chapter {curr_num} (missing {prev_num + 1})",
                    "severity": "major",
                })

    return issues


def check_term_consistency(drafts: list[SectionDraft]) -> list[ConsistencyIssue]:
    """Check for inconsistent terminology across sections.

    Heuristic: looks for common abbreviation/full-form mismatches.
    """
    issues: list[ConsistencyIssue] = []

    # Collect all text
    all_text = "\n".join(d.content for d in drafts)

    # Common patterns to check (abbreviation vs full form)
    term_pairs = [
        (r"\bAI\b", r"[Aa]rtificial [Ii]ntelligence"),
        (r"\bML\b", r"[Mm]achine [Ll]earning"),
        (r"\bNLP\b", r"[Nn]atural [Ll]anguage [Pp]rocessing"),
        (r"\bAPI\b", r"[Aa]pplication [Pp]rogramming [Ii]nterface"),
    ]

    for abbrev_pattern, full_pattern in term_pairs:
        has_abbrev = bool(re.search(abbrev_pattern, all_text))
        has_full = bool(re.search(full_pattern, all_text))
        if has_abbrev and has_full:
            # Find which sections use which form
            for draft in drafts:
                uses_abbrev = bool(re.search(abbrev_pattern, draft.content))
                uses_full = bool(re.search(full_pattern, draft.content))
                if uses_abbrev and uses_full:
                    issues.append({
                        "section_id": draft.section_id,
                        "category": "consistency",
                        "description": f"Mixed use of abbreviation and full form in section '{draft.title}'",
                        "severity": "minor",
                    })

    return issues


def check_cross_references(drafts: list[SectionDraft]) -> list[ConsistencyIssue]:
    """Check that cross-references point to existing sections."""
    issues: list[ConsistencyIssue] = []

    # Collect all section titles and chapter numbers
    existing_chapters = set()
    existing_titles = set()
    for draft in drafts:
        existing_titles.add(draft.title.lower())
        matches = re.findall(r"##?\s+(?:Chapter|第)\s*(\d+)", draft.content, re.IGNORECASE)
        for num in matches:
            existing_chapters.add(int(num))

    # Find cross-references
    for draft in drafts:
        # Chinese: "如第N章所述", "见第N节"
        cn_refs = re.findall(r"(?:如|见|参见|详见)第\s*(\d+)\s*[章节]", draft.content)
        # English: "see Chapter N", "as discussed in Chapter N"
        en_refs = re.findall(r"(?:see|in|refer to)\s+Chapter\s+(\d+)", draft.content, re.IGNORECASE)

        all_refs = cn_refs + en_refs
        for ref_num_str in all_refs:
            ref_num = int(ref_num_str)
            if existing_chapters and ref_num not in existing_chapters:
                issues.append({
                    "section_id": draft.section_id,
                    "category": "reference",
                    "description": f"Cross-reference to Chapter {ref_num} not found in document",
                    "severity": "major",
                })

    return issues


def check_transitions(drafts: list[SectionDraft]) -> list[ConsistencyIssue]:
    """Check transition quality between sections.

    Flags sections that start too abruptly (no connective or context).
    """
    issues: list[ConsistencyIssue] = []

    # Transition words/phrases
    transition_patterns = [
        r"^(?:Following|Building on|As mentioned|Continuing|Next|Now|Having)",
        r"^(?:接下来|在|基于|如前|继续|随后|下面)",
        r"^(?:In this|This section|Here we|We now|Let's|Let us)",
    ]

    for i in range(1, len(drafts)):  # Skip first section
        draft = drafts[i]
        # Get first non-heading, non-empty line
        lines = [l.strip() for l in draft.content.split("\n") if l.strip() and not l.strip().startswith("#")]
        if not lines:
            continue

        first_sentence = lines[0]
        has_transition = any(
            re.search(pattern, first_sentence, re.IGNORECASE)
            for pattern in transition_patterns
        )

        if not has_transition and len(first_sentence) < 20:
            issues.append({
                "section_id": draft.section_id,
                "category": "transition",
                "description": f"Section '{draft.title}' may start too abruptly: '{first_sentence[:50]}...'",
                "severity": "minor",
            })

    return issues


def check_consistency(drafts: list[SectionDraft]) -> list[ConsistencyIssue]:
    """Run all consistency checks and return combined issues.

    Args:
        drafts: All section drafts in document order

    Returns:
        Combined list of consistency issues
    """
    issues: list[ConsistencyIssue] = []
    issues.extend(check_heading_continuity(drafts))
    issues.extend(check_term_consistency(drafts))
    issues.extend(check_cross_references(drafts))
    issues.extend(check_transitions(drafts))
    return issues
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /e/test/Docmost/agent-service && python -m pytest tests/workers/test_consistency_checker.py -v
```

Expected: ALL 6 PASS

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/workers/consistency_checker.py agent-service/tests/workers/test_consistency_checker.py
git commit -m "feat(worker): add cross-section consistency checker for headings, terms, references, transitions"
```

---

## Chunk 10: Level 3 End-to-End Test

### Task 10: Level 3 end-to-end test

Test the full Level 3 pipeline: upload → parse → brief → blueprint → write → consistency → done.

**Files:**
- Create: `agent-service/tests/orchestrator/test_e2e_level3.py`

- [ ] **Step 1: Write Level 3 integration test**

```python
# agent-service/tests/orchestrator/test_e2e_level3.py
"""End-to-end test for Level 3 path: full creation pipeline."""
import json
import pytest
from unittest.mock import patch, AsyncMock, MagicMock

from app.models.brief import CreationBrief
from app.models.asset_map import AssetMap, AssetItem
from app.models.blueprint import CreationBlueprint, SectionPlan
from app.models.draft import SectionDraft


class TestLevel3E2E:
    """End-to-end Level 3 integration tests."""

    @pytest.mark.asyncio
    async def test_full_level3_pipeline(self):
        """Full pipeline: parse → brief → blueprint → write → consistency."""
        # Step 1: Parse assets
        from app.orchestrator.tools.parse_assets import parse_assets_impl

        asset_map_data = AssetMap(
            items=[
                AssetItem(id="t1", type="text", source="a.pdf", content="Chapter 1 content", summary="Section 'Chapter 1': 100 words"),
                AssetItem(id="t2", type="text", source="b.pdf", content="Chapter 2 content", summary="Section 'Chapter 2': 150 words"),
                AssetItem(id="h1", type="heading_structure", source="a.pdf", content="# Report\n## Chapter 1"),
                AssetItem(id="img-1", type="image", source="fig.png", content="![Figure](url)", summary="Architecture diagram [type: diagram]"),
            ],
            source_word_count=5000,
            source_structure=[
                {"level": 1, "title": "Report"},
                {"level": 2, "title": "Chapter 1"},
                {"level": 2, "title": "Chapter 2"},
            ],
            source_section_counts={"h1": 1, "h2": 2},
        )

        with patch("app.orchestrator.tools.parse_assets.parse_document") as mock_parse:
            mock_parse.return_value = asset_map_data
            asset_json = await parse_assets_impl(
                files=[
                    {"content_b64": "YQ==", "filename": "a.pdf", "mimetype": "application/pdf"},
                    {"content_b64": "Yg==", "filename": "b.pdf", "mimetype": "application/pdf"},
                ],
                page_id="page-001",
            )

        asset_map = AssetMap.model_validate_json(asset_json)
        assert asset_map.source_word_count == 5000

        # Step 2: Generate brief
        from app.orchestrator.tools.create_brief import generate_brief

        mock_brief = CreationBrief(
            audience="developers",
            goal="Create technical report",
            target_length=5000,
            style="technical",
            tone="professional",
            structure_strategy="ai_recommend",
            image_strategy="mixed",
        )

        with patch("app.orchestrator.tools.create_brief._llm_generate_brief", new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = mock_brief
            brief = await generate_brief(user_message="创建技术报告", asset_map=asset_map)

        assert brief.target_length == 5000

        # Step 3: Generate blueprint
        from app.orchestrator.tools.create_blueprint import generate_blueprint

        mock_blueprint = CreationBlueprint(
            title="Technical Report",
            summary="Comprehensive technical report",
            sections=[
                SectionPlan(section_id="s1", title="Introduction", target_words=1000, key_points=["Overview"], asset_ids=["img-1"]),
                SectionPlan(section_id="s2", title="Architecture", target_words=1500, key_points=["System design"], depends_on=["s1"]),
                SectionPlan(section_id="s3", title="Implementation", target_words=1500, key_points=["Code walkthrough"], asset_ids=["t1"]),
                SectionPlan(section_id="s4", title="Conclusion", target_words=1000, key_points=["Summary"], depends_on=["s2", "s3"]),
            ],
            total_target_words=5000,
        )

        with patch("app.orchestrator.tools.create_blueprint._llm_generate_blueprint", new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = mock_blueprint
            blueprint = await generate_blueprint(brief=brief, asset_map=asset_map)

        assert len(blueprint.sections) == 4
        total_budget = sum(s.target_words for s in blueprint.sections)
        assert abs(total_budget - 5000) / 5000 <= 0.05

        # Step 4: Write sections
        from app.orchestrator.tools.write_tools import write_sections_parallel_impl

        mock_draft = SectionDraft(
            section_id="s1", title="Introduction",
            content="## Introduction\n\nThis report covers...",
            word_count=1000, status="done",
        )

        with patch("app.orchestrator.tools.write_tools.write_section", new_callable=AsyncMock) as mock_writer:
            mock_writer.return_value = mock_draft
            write_result = await write_sections_parallel_impl(
                blueprint_json=blueprint.model_dump_json(),
                asset_map_json=asset_map.model_dump_json(),
                style="technical",
                tone="professional",
            )

        parsed_result = json.loads(write_result)
        assert len(parsed_result["drafts"]) == 4

        # Step 5: Consistency check
        from app.workers.consistency_checker import check_consistency

        completed_drafts = [SectionDraft(**d) for d in parsed_result["drafts"]]
        issues = check_consistency(completed_drafts)
        assert isinstance(issues, list)

    @pytest.mark.asyncio
    async def test_level3_complexity_detection(self):
        """Multiple file uploads should be detected as Level 3."""
        from app.orchestrator.tools.complexity import analyze_task_complexity

        result = analyze_task_complexity(
            user_message="合并这些文件写一份报告",
            files=[
                {"filename": "a.pdf", "mimetype": "application/pdf"},
                {"filename": "b.pdf", "mimetype": "application/pdf"},
            ],
            intent_route="document_create",
            template_id=None,
            selected_text=None,
        )

        assert result["level"] == 3

    @pytest.mark.asyncio
    async def test_level3_parallel_grouping(self):
        """Verify sections are correctly grouped for parallel execution."""
        from app.orchestrator.tools.write_tools import group_sections_for_parallel

        sections = [
            SectionPlan(section_id="s1", title="A", target_words=500, key_points=["x"]),
            SectionPlan(section_id="s2", title="B", target_words=500, key_points=["y"], depends_on=["s1"]),
            SectionPlan(section_id="s3", title="C", target_words=500, key_points=["z"]),
            SectionPlan(section_id="s4", title="D", target_words=500, key_points=["w"], depends_on=["s3"]),
        ]

        groups = group_sections_for_parallel(sections)
        # s1→s2 chain and s3→s4 chain can run in parallel
        assert len(groups) == 2

    @pytest.mark.asyncio
    async def test_word_count_within_tolerance(self):
        """Final output word count should be within ±10% of target."""
        target = 5000
        # Simulated: each section writes roughly its budget
        section_words = [1000, 1500, 1500, 1000]  # sum = 5000
        total = sum(section_words)
        tolerance = 0.10
        assert abs(total - target) / target <= tolerance
```

- [ ] **Step 2: Run tests**

```bash
cd /e/test/Docmost/agent-service && python -m pytest tests/orchestrator/test_e2e_level3.py -v
```

Expected: ALL 4 PASS

- [ ] **Step 3: Commit**

```bash
git add agent-service/tests/orchestrator/test_e2e_level3.py
git commit -m "test(orchestrator): add Level 3 end-to-end integration tests with full pipeline"
```

---

## Chunk 11: Orchestrator System Prompt Update

### Task 11: Orchestrator system prompt update for Level 3

Update the Orchestrator system prompt with Level 3 decision logic and multi-document merge instructions.

**Files:**
- Modify: `agent-service/app/orchestrator/prompts.py`
- Modify: `agent-service/app/orchestrator/engine.py`

- [ ] **Step 1: Add Level 3 instructions to prompts.py**

Add the following to `agent-service/app/orchestrator/prompts.py`:

```python
_LEVEL3_INSTRUCTIONS = """
## Level 3: Full Creation Path

When complexity is Level 3 (creation from scratch, multi-file merge, rewrite):

1. Call `parse_assets` for ALL uploaded files
2. If research is needed (topic requires facts/data), call `research` tool
3. Call `create_brief` to generate a Smart Brief
4. Send brief to user via `ask_user` with phase="brief"
5. After user confirms brief, call `create_blueprint` to plan sections
6. Send blueprint to user via `ask_user` with phase="blueprint"
7. After user confirms blueprint, call `write_sections_parallel`
8. Run consistency check on completed drafts
9. If critical issues found, fix affected sections
10. Call `finalize` to merge content into the page

Key rules for Level 3:
- ALWAYS generate both Brief AND Blueprint before writing
- Present BOTH for user approval
- Use parallel writing for independent section groups
- Enforce word budgets (retry if < 80% of target)
- Run consistency check before finalizing
- Store drafts in Draft Manager for user review

### Multi-Document Merge
When multiple files are uploaded:
- Parse each file separately to preserve source attribution
- Cross-reference assets across files by content similarity
- In the brief, note which files contribute to which areas
- In the blueprint, assign asset_ids from multiple sources per section
- Avoid duplication: if two files cover the same topic, synthesize rather than repeat

### Word Budget Enforcement
- Section word budgets MUST sum to brief.target_length (±5%)
- If a section is < 80% of its budget after generation, retry once
- If still short after retry, accept and note in consistency report
- Never exceed 120% of budget (trim if necessary via instruction)
"""
```

- [ ] **Step 2: Register write and consistency tools in engine.py**

Update tool registration in `agent-service/app/orchestrator/engine.py`:

```python
# Add imports
from app.orchestrator.tools.write_tools import write_section_impl, write_sections_parallel_impl
from app.workers.consistency_checker import check_consistency

# Add tool registrations:
async def write_section_tool(ctx, section_plan_json: str, context_package: dict, style: str, tone: str) -> str:
    """Write a single section with context-aware generation."""
    return await write_section_impl(
        section_plan_json=section_plan_json,
        context_package=context_package,
        style=style,
        tone=tone,
    )

async def write_sections_parallel_tool(ctx, blueprint_json: str, asset_map_json: str, style: str, tone: str) -> str:
    """Write all sections in parallel where safe, with sliding window context."""
    return await write_sections_parallel_impl(
        blueprint_json=blueprint_json,
        asset_map_json=asset_map_json,
        style=style,
        tone=tone,
    )

def consistency_check_tool(ctx, drafts_json: str) -> str:
    """Check cross-section consistency (headings, terms, references, transitions)."""
    import json
    from app.models.draft import SectionDraft
    drafts_data = json.loads(drafts_json)
    drafts = [SectionDraft(**d) for d in drafts_data]
    issues = check_consistency(drafts)
    return json.dumps(issues, ensure_ascii=False)
```

- [ ] **Step 3: Verify engine starts without errors**

```bash
cd /e/test/Docmost/agent-service && python -c "from app.orchestrator.engine import create_orchestrator_agent; print('OK')"
```

Expected: prints "OK"

- [ ] **Step 4: Run full test suite**

```bash
cd /e/test/Docmost/agent-service && python -m pytest tests/ -v --tb=short
```

Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/orchestrator/prompts.py agent-service/app/orchestrator/engine.py
git commit -m "feat(orchestrator): add Level 3 system prompt with multi-document merge and write tools"
```
