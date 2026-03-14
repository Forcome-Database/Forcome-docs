# Phase 0: Foundation — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up PydanticAI infrastructure, define all Pydantic data models, design new SSE event protocol, and scaffold frontend components. This phase creates zero behavioral changes — it only adds new code alongside the existing LangGraph system.

**Architecture:** PydanticAI replaces LangGraph as the agent orchestration framework. Structured Pydantic models replace the 45-field TypedDict (`agent-service/app/agent/state.py:AgentState`). A new SSE event protocol enables richer frontend interactions (Brief, Blueprint, Review). All new code lives in `agent-service/app/models/`, `agent-service/app/orchestrator/`, `agent-service/app/utils/`, and `apps/client/src/ee/ai/types/` — the existing `app/agent/` directory is untouched.

**Tech Stack:** Python 3.12, PydanticAI, Pydantic v2, FastAPI, TypeScript, React, Mantine UI

**Estimated Duration:** 1-2 weeks

**Key Constraint:** The existing LangGraph system (`app/agent/`) MUST remain fully functional throughout this phase. All new code is additive.

---

## Chunk 1: Dependencies and Infrastructure

### Task 1: Install PydanticAI and set up dependencies

**Files:**
- Modify: `agent-service/pyproject.toml`

- [ ] **Step 1: Add pydantic-ai to dependencies**

Edit `agent-service/pyproject.toml`, add `pydantic-ai` to the `dependencies` list:

```toml
[project]
name = "docmost-agent"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.32",
    "langgraph>=0.2",
    "langchain-core>=0.3",
    "langchain-openai>=0.2",
    "langchain-google-genai>=2.0",
    "pydantic-ai>=0.2",
    "docling>=2.0",
    "firecrawl-py>=1.0",
    "tavily-python>=0.5",
    "Pillow>=10.0",
    "httpx>=0.27",
    "sse-starlette>=2.0",
    "pydantic>=2.0",
    "pydantic-settings>=2.0",
    "langgraph-checkpoint-postgres>=2.0",
    "psycopg[binary]>=3.1",
    "psycopg-pool>=3.1",
]
```

Note: `langgraph` and related dependencies are kept — they will be removed in Phase 6 after migration is complete.

- [ ] **Step 2: Install and verify import**

Run: `cd /e/test/Docmost/agent-service && pip install -e ".[dev]"`
Run: `cd /e/test/Docmost/agent-service && python -c "import pydantic_ai; print('pydantic_ai', pydantic_ai.__version__)"`
Expected: prints version without error

- [ ] **Step 3: Commit**

Run: `cd /e/test/Docmost && git add agent-service/pyproject.toml && git commit -m "chore(agent): add pydantic-ai dependency"`

---

## Chunk 2: Pydantic Data Models

### Task 2: Create models package and CreationBrief

**Files:**
- Create: `agent-service/app/models/__init__.py`
- Create: `agent-service/app/models/brief.py`
- Create: `agent-service/tests/test_models/__init__.py`
- Create: `agent-service/tests/test_models/test_brief.py`

- [ ] **Step 1: Create models package init**

```python
# agent-service/app/models/__init__.py
"""Pydantic v2 data models for the AI Creator v2 orchestrator."""
```

- [ ] **Step 2: Create test directory and write failing tests for CreationBrief**

```python
# agent-service/tests/test_models/__init__.py
```

```python
# agent-service/tests/test_models/test_brief.py
import pytest
from pydantic import ValidationError
from app.models.brief import CreationBrief


def test_brief_minimal():
    """Minimal valid brief with all required fields."""
    brief = CreationBrief(
        audience="developers",
        goal="Write an API reference guide",
        target_length=2000,
        style="technical",
        tone="professional",
        structure_strategy="ai_recommend",
        image_strategy="none",
    )
    assert brief.audience == "developers"
    assert brief.target_length == 2000
    assert brief.length_tolerance == 0.1  # default
    assert brief.constraints == []  # default


def test_brief_with_constraints():
    """Brief with custom constraints and tolerance."""
    brief = CreationBrief(
        audience="beginners",
        goal="Tutorial",
        target_length=5000,
        length_tolerance=0.2,
        style="conversational",
        tone="friendly",
        structure_strategy="copy_source",
        image_strategy="reuse_source",
        constraints=["No jargon", "Include examples"],
    )
    assert brief.length_tolerance == 0.2
    assert len(brief.constraints) == 2


def test_brief_invalid_structure_strategy():
    """Invalid structure_strategy should raise ValidationError."""
    with pytest.raises(ValidationError):
        CreationBrief(
            audience="all",
            goal="test",
            target_length=1000,
            style="neutral",
            tone="neutral",
            structure_strategy="invalid_value",
            image_strategy="none",
        )


def test_brief_invalid_image_strategy():
    """Invalid image_strategy should raise ValidationError."""
    with pytest.raises(ValidationError):
        CreationBrief(
            audience="all",
            goal="test",
            target_length=1000,
            style="neutral",
            tone="neutral",
            structure_strategy="ai_recommend",
            image_strategy="invalid_value",
        )


def test_brief_negative_length():
    """Negative target_length should raise ValidationError."""
    with pytest.raises(ValidationError):
        CreationBrief(
            audience="all",
            goal="test",
            target_length=-100,
            style="neutral",
            tone="neutral",
            structure_strategy="ai_recommend",
            image_strategy="none",
        )


def test_brief_serialization_roundtrip():
    """Brief should survive JSON serialization roundtrip."""
    brief = CreationBrief(
        audience="managers",
        goal="Executive summary",
        target_length=800,
        style="formal",
        tone="authoritative",
        structure_strategy="user_defined",
        image_strategy="mixed",
        constraints=["Max 3 pages"],
    )
    data = brief.model_dump()
    restored = CreationBrief(**data)
    assert restored == brief
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/test_models/test_brief.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.models.brief'`

- [ ] **Step 4: Implement CreationBrief**

```python
# agent-service/app/models/brief.py
"""CreationBrief — the negotiated contract between user intent and agent plan."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class CreationBrief(BaseModel):
    """Structured representation of what the user wants created.

    Produced by the Briefing phase after analyzing user input, evidence,
    and (optionally) asking clarifying questions. Serves as the single
    source of truth for all downstream phases (Blueprint, Draft, Review).
    """

    audience: str = Field(
        ..., description="Target audience for the content"
    )
    goal: str = Field(
        ..., description="What the content should achieve"
    )
    target_length: int = Field(
        ..., gt=0, description="Target word count for the final output"
    )
    length_tolerance: float = Field(
        default=0.1,
        ge=0.0,
        le=0.5,
        description="Acceptable deviation from target_length (0.1 = ±10%)",
    )
    style: str = Field(
        ..., description="Writing style (e.g. technical, conversational, formal)"
    )
    tone: str = Field(
        ..., description="Tone of voice (e.g. professional, friendly, authoritative)"
    )
    structure_strategy: Literal["copy_source", "ai_recommend", "user_defined"] = Field(
        ...,
        description=(
            "How to determine document structure: "
            "copy_source = mirror source structure, "
            "ai_recommend = let AI propose optimal structure, "
            "user_defined = user provides explicit outline"
        ),
    )
    image_strategy: Literal["reuse_source", "generate_new", "mixed", "none"] = Field(
        ...,
        description=(
            "How to handle images: "
            "reuse_source = keep source images, "
            "generate_new = create new images, "
            "mixed = combination, "
            "none = no images"
        ),
    )
    constraints: list[str] = Field(
        default_factory=list,
        description="Additional constraints or requirements from the user",
    )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/test_models/test_brief.py -v`
Expected: ALL 6 PASS

- [ ] **Step 6: Commit**

Run: `cd /e/test/Docmost && git add agent-service/app/models/__init__.py agent-service/app/models/brief.py agent-service/tests/test_models/__init__.py agent-service/tests/test_models/test_brief.py && git commit -m "feat(agent): add CreationBrief Pydantic model with tests"`

---

### Task 3: Create AssetItem and AssetMap models

**Files:**
- Create: `agent-service/app/models/asset_map.py`
- Create: `agent-service/tests/test_models/test_asset_map.py`

- [ ] **Step 1: Write failing tests for AssetItem and AssetMap**

```python
# agent-service/tests/test_models/test_asset_map.py
import pytest
from pydantic import ValidationError
from app.models.asset_map import AssetItem, AssetMap


def test_asset_item_minimal():
    """Minimal valid AssetItem."""
    item = AssetItem(
        id="asset-001",
        type="text",
        source="uploaded_doc.pdf",
        content="Introduction paragraph...",
    )
    assert item.id == "asset-001"
    assert item.summary == ""
    assert item.suggested_usage == ""
    assert item.reuse_decision is None


def test_asset_item_with_reuse_decision():
    """AssetItem with reuse decision set."""
    item = AssetItem(
        id="img-001",
        type="image",
        source="screenshot.png",
        content="[image: architecture diagram]",
        summary="System architecture overview showing 3 services",
        suggested_usage="Use as hero image in architecture section",
        reuse_decision="reuse",
    )
    assert item.reuse_decision == "reuse"
    assert item.type == "image"


def test_asset_item_invalid_type():
    """Invalid asset type should raise ValidationError."""
    with pytest.raises(ValidationError):
        AssetItem(
            id="x",
            type="video",
            source="test",
            content="test",
        )


def test_asset_item_invalid_reuse_decision():
    """Invalid reuse_decision should raise ValidationError."""
    with pytest.raises(ValidationError):
        AssetItem(
            id="x",
            type="text",
            source="test",
            content="test",
            reuse_decision="maybe",
        )


def test_asset_map_empty():
    """Empty AssetMap with defaults."""
    am = AssetMap()
    assert am.items == []
    assert am.source_structure == []
    assert am.source_word_count == 0
    assert am.source_section_counts == {}


def test_asset_map_with_items():
    """AssetMap with multiple items and metadata."""
    items = [
        AssetItem(id="1", type="heading_structure", source="doc.pdf", content="# Title\n## Section 1"),
        AssetItem(id="2", type="table", source="doc.pdf", content="| A | B |\n|---|---|"),
        AssetItem(id="3", type="image", source="fig1.png", content="[image]"),
    ]
    am = AssetMap(
        items=items,
        source_structure=[{"level": 1, "title": "Title"}, {"level": 2, "title": "Section 1"}],
        source_word_count=4500,
        source_section_counts={"h1": 1, "h2": 3, "h3": 5},
    )
    assert len(am.items) == 3
    assert am.source_word_count == 4500
    assert am.source_section_counts["h2"] == 3


def test_asset_map_serialization_roundtrip():
    """AssetMap should survive JSON roundtrip."""
    item = AssetItem(id="1", type="code", source="readme.md", content="```python\nprint('hi')```")
    am = AssetMap(items=[item], source_word_count=100)
    data = am.model_dump()
    restored = AssetMap(**data)
    assert restored == am
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/test_models/test_asset_map.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.models.asset_map'`

- [ ] **Step 3: Implement AssetItem and AssetMap**

```python
# agent-service/app/models/asset_map.py
"""AssetMap — inventory of reusable assets extracted from source materials."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class AssetItem(BaseModel):
    """A single extractable asset from source material.

    Assets include text blocks, images, tables, code blocks, mermaid diagrams,
    and heading structures. Each can be individually decided upon for reuse.
    """

    id: str = Field(..., description="Unique identifier for this asset")
    type: Literal["text", "image", "table", "code", "mermaid", "heading_structure"] = Field(
        ..., description="The kind of asset"
    )
    source: str = Field(..., description="Where this asset came from (filename, URL, etc.)")
    content: str = Field(..., description="Raw content of the asset")
    summary: str = Field(default="", description="Brief summary of what this asset contains")
    suggested_usage: str = Field(
        default="", description="How this asset could be used in the output"
    )
    reuse_decision: Literal["reuse", "adapt", "skip"] | None = Field(
        default=None,
        description="Whether to reuse, adapt, or skip this asset (None = not yet decided)",
    )


class AssetMap(BaseModel):
    """Complete inventory of assets extracted from all source materials.

    Built during the evidence-gathering phase. Used by Blueprint to plan
    section content and by Draft to pull in the right material.
    """

    items: list[AssetItem] = Field(
        default_factory=list, description="All extracted assets"
    )
    source_structure: list[dict] = Field(
        default_factory=list,
        description="Heading hierarchy from source (list of {level, title} dicts)",
    )
    source_word_count: int = Field(
        default=0, ge=0, description="Total word count of all source material"
    )
    source_section_counts: dict[str, int] = Field(
        default_factory=dict,
        description="Count of sections by heading level (e.g. {'h1': 1, 'h2': 5})",
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/test_models/test_asset_map.py -v`
Expected: ALL 7 PASS

- [ ] **Step 5: Commit**

Run: `cd /e/test/Docmost && git add agent-service/app/models/asset_map.py agent-service/tests/test_models/test_asset_map.py && git commit -m "feat(agent): add AssetItem and AssetMap Pydantic models with tests"`

---

### Task 4: Create Blueprint models

**Files:**
- Create: `agent-service/app/models/blueprint.py`
- Create: `agent-service/tests/test_models/test_blueprint.py`

- [ ] **Step 1: Write failing tests for Blueprint**

```python
# agent-service/tests/test_models/test_blueprint.py
import pytest
from pydantic import ValidationError
from app.models.blueprint import VisualPlan, SectionPlan, CreationBlueprint


def test_visual_plan():
    """VisualPlan with all fields."""
    vp = VisualPlan(
        type="mermaid",
        description="Architecture diagram",
        placement="after heading",
        source_asset_id="img-001",
    )
    assert vp.type == "mermaid"
    assert vp.source_asset_id == "img-001"


def test_visual_plan_no_source():
    """VisualPlan without source_asset_id (generated visual)."""
    vp = VisualPlan(
        type="image",
        description="Generated hero image",
        placement="section start",
    )
    assert vp.source_asset_id is None


def test_section_plan_minimal():
    """Minimal SectionPlan with required fields only."""
    sp = SectionPlan(
        section_id="sec-01",
        title="Introduction",
        target_words=500,
        key_points=["Overview of the system"],
    )
    assert sp.section_id == "sec-01"
    assert sp.asset_ids == []
    assert sp.visuals == []
    assert sp.depends_on == []


def test_section_plan_full():
    """SectionPlan with all optional fields."""
    visual = VisualPlan(type="table", description="Comparison table", placement="inline")
    sp = SectionPlan(
        section_id="sec-03",
        title="Comparison",
        target_words=800,
        key_points=["Feature matrix", "Pros and cons"],
        asset_ids=["asset-002", "asset-003"],
        visuals=[visual],
        depends_on=["sec-01", "sec-02"],
    )
    assert len(sp.key_points) == 2
    assert len(sp.visuals) == 1
    assert len(sp.depends_on) == 2


def test_blueprint_minimal():
    """Minimal valid CreationBlueprint."""
    section = SectionPlan(
        section_id="sec-01",
        title="Main Content",
        target_words=1000,
        key_points=["Everything"],
    )
    bp = CreationBlueprint(
        title="My Document",
        sections=[section],
        total_target_words=1000,
    )
    assert bp.title == "My Document"
    assert bp.summary == ""
    assert len(bp.sections) == 1


def test_blueprint_full():
    """Full CreationBlueprint with summary."""
    sections = [
        SectionPlan(section_id="s1", title="Intro", target_words=300, key_points=["Context"]),
        SectionPlan(section_id="s2", title="Body", target_words=600, key_points=["Details"]),
        SectionPlan(section_id="s3", title="Conclusion", target_words=100, key_points=["Summary"]),
    ]
    bp = CreationBlueprint(
        title="Tutorial: Getting Started",
        summary="A beginner-friendly tutorial covering setup and basic usage",
        sections=sections,
        total_target_words=1000,
    )
    assert len(bp.sections) == 3
    assert bp.total_target_words == 1000
    section_total = sum(s.target_words for s in bp.sections)
    assert section_total == 1000


def test_blueprint_empty_sections_invalid():
    """Blueprint with no sections should raise ValidationError."""
    with pytest.raises(ValidationError):
        CreationBlueprint(
            title="Empty",
            sections=[],
            total_target_words=0,
        )


def test_blueprint_serialization_roundtrip():
    """Blueprint should survive JSON roundtrip."""
    visual = VisualPlan(type="code", description="Example snippet", placement="inline")
    section = SectionPlan(
        section_id="s1",
        title="Demo",
        target_words=500,
        key_points=["Show code"],
        visuals=[visual],
    )
    bp = CreationBlueprint(title="Demo Doc", sections=[section], total_target_words=500)
    data = bp.model_dump()
    restored = CreationBlueprint(**data)
    assert restored == bp
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/test_models/test_blueprint.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.models.blueprint'`

- [ ] **Step 3: Implement Blueprint models**

```python
# agent-service/app/models/blueprint.py
"""Blueprint — the structural plan for content creation.

A Blueprint is the bridge between Brief (what to create) and Draft (the actual writing).
It specifies sections, word budgets, visual plans, and asset assignments.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator


class VisualPlan(BaseModel):
    """Plan for a visual element within a section."""

    type: Literal["image", "table", "mermaid", "code", "diagram"] = Field(
        ..., description="Type of visual element"
    )
    description: str = Field(
        ..., description="What this visual should show"
    )
    placement: str = Field(
        ..., description="Where in the section this visual belongs"
    )
    source_asset_id: str | None = Field(
        default=None,
        description="ID of source asset to reuse (None = generate new)",
    )


class SectionPlan(BaseModel):
    """Plan for a single section of the document."""

    section_id: str = Field(..., description="Unique identifier for this section")
    title: str = Field(..., description="Section heading")
    target_words: int = Field(..., ge=0, description="Target word count for this section")
    key_points: list[str] = Field(
        ..., min_length=1, description="Key points this section must cover"
    )
    asset_ids: list[str] = Field(
        default_factory=list,
        description="IDs of AssetItems to incorporate in this section",
    )
    visuals: list[VisualPlan] = Field(
        default_factory=list,
        description="Visual elements planned for this section",
    )
    depends_on: list[str] = Field(
        default_factory=list,
        description="section_ids that must be drafted before this one",
    )


class CreationBlueprint(BaseModel):
    """Complete structural plan for the document to be created.

    Produced by the Blueprint phase. Approved (or modified) by the user
    before drafting begins. Each section has a word budget, key points,
    and optional visual plans.
    """

    title: str = Field(..., description="Document title")
    summary: str = Field(
        default="",
        description="Brief summary of what this document will cover",
    )
    sections: list[SectionPlan] = Field(
        ..., min_length=1, description="Ordered list of section plans"
    )
    total_target_words: int = Field(
        ..., ge=0, description="Total target word count across all sections"
    )

    @model_validator(mode="after")
    def _validate_section_ids_unique(self) -> "CreationBlueprint":
        ids = [s.section_id for s in self.sections]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate section_id values in blueprint")
        return self
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/test_models/test_blueprint.py -v`
Expected: ALL 8 PASS

- [ ] **Step 5: Commit**

Run: `cd /e/test/Docmost && git add agent-service/app/models/blueprint.py agent-service/tests/test_models/test_blueprint.py && git commit -m "feat(agent): add Blueprint Pydantic models (VisualPlan, SectionPlan, CreationBlueprint) with tests"`

---

### Task 5: Create Draft and Review models

**Files:**
- Create: `agent-service/app/models/draft.py`
- Create: `agent-service/app/models/review.py`
- Create: `agent-service/tests/test_models/test_draft.py`
- Create: `agent-service/tests/test_models/test_review.py`

- [ ] **Step 1: Write failing tests for SectionDraft**

```python
# agent-service/tests/test_models/test_draft.py
import pytest
from pydantic import ValidationError
from app.models.draft import SectionDraft


def test_section_draft_minimal():
    """Minimal SectionDraft."""
    draft = SectionDraft(
        section_id="sec-01",
        title="Introduction",
        content="This is the introduction.",
        word_count=5,
    )
    assert draft.section_id == "sec-01"
    assert draft.status == "pending"
    assert draft.revision_count == 0


def test_section_draft_statuses():
    """All valid statuses should work."""
    for status in ("pending", "drafting", "done", "revising"):
        draft = SectionDraft(
            section_id="s1",
            title="T",
            content="C",
            word_count=1,
            status=status,
        )
        assert draft.status == status


def test_section_draft_invalid_status():
    """Invalid status should raise ValidationError."""
    with pytest.raises(ValidationError):
        SectionDraft(
            section_id="s1",
            title="T",
            content="C",
            word_count=1,
            status="invalid",
        )


def test_section_draft_serialization_roundtrip():
    """SectionDraft JSON roundtrip."""
    draft = SectionDraft(
        section_id="sec-02",
        title="Details",
        content="# Details\n\nSome detailed content here.",
        word_count=6,
        status="done",
        revision_count=2,
    )
    data = draft.model_dump()
    restored = SectionDraft(**data)
    assert restored == draft
```

- [ ] **Step 2: Write failing tests for ReviewIssue and ReviewReport**

```python
# agent-service/tests/test_models/test_review.py
import pytest
from pydantic import ValidationError
from app.models.review import ReviewIssue, ReviewReport


def test_review_issue():
    """Valid ReviewIssue."""
    issue = ReviewIssue(
        section_id="sec-01",
        severity="major",
        category="accuracy",
        description="Factual error in paragraph 2",
        suggestion="Replace with correct data from source",
    )
    assert issue.severity == "major"
    assert issue.category == "accuracy"


def test_review_issue_invalid_severity():
    """Invalid severity should raise ValidationError."""
    with pytest.raises(ValidationError):
        ReviewIssue(
            section_id="s1",
            severity="critical",
            category="accuracy",
            description="test",
            suggestion="fix",
        )


def test_review_issue_invalid_category():
    """Invalid category should raise ValidationError."""
    with pytest.raises(ValidationError):
        ReviewIssue(
            section_id="s1",
            severity="minor",
            category="invalid_cat",
            description="test",
            suggestion="fix",
        )


def test_review_report_pass():
    """ReviewReport with verdict=pass and no issues."""
    report = ReviewReport(
        verdict="pass",
        issues=[],
        overall_score=0.92,
        summary="Content meets all requirements.",
    )
    assert report.verdict == "pass"
    assert report.overall_score == 0.92


def test_review_report_revise():
    """ReviewReport with verdict=revise and issues."""
    issue = ReviewIssue(
        section_id="sec-02",
        severity="major",
        category="length",
        description="Section is 40% shorter than target",
        suggestion="Expand with more examples",
    )
    report = ReviewReport(
        verdict="revise",
        issues=[issue],
        overall_score=0.55,
        summary="Length requirements not met in section 2.",
    )
    assert report.verdict == "revise"
    assert len(report.issues) == 1


def test_review_report_invalid_verdict():
    """Invalid verdict should raise ValidationError."""
    with pytest.raises(ValidationError):
        ReviewReport(
            verdict="maybe",
            issues=[],
            overall_score=0.5,
            summary="test",
        )


def test_review_report_score_bounds():
    """Score out of [0,1] range should raise ValidationError."""
    with pytest.raises(ValidationError):
        ReviewReport(verdict="pass", issues=[], overall_score=1.5, summary="test")
    with pytest.raises(ValidationError):
        ReviewReport(verdict="pass", issues=[], overall_score=-0.1, summary="test")


def test_review_report_serialization_roundtrip():
    """ReviewReport JSON roundtrip."""
    issue = ReviewIssue(
        section_id="s1",
        severity="minor",
        category="style",
        description="AI-sounding phrasing",
        suggestion="Rewrite naturally",
    )
    report = ReviewReport(
        verdict="revise",
        issues=[issue],
        overall_score=0.7,
        summary="Minor style issues",
    )
    data = report.model_dump()
    restored = ReviewReport(**data)
    assert restored == report
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/test_models/test_draft.py tests/test_models/test_review.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 4: Implement SectionDraft**

```python
# agent-service/app/models/draft.py
"""SectionDraft — output of the section-by-section writing phase."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class SectionDraft(BaseModel):
    """Draft content for a single section, tracked individually.

    Each section is drafted independently according to its SectionPlan
    from the Blueprint. Sections can be revised individually based on
    ReviewReport feedback.
    """

    section_id: str = Field(..., description="Matches SectionPlan.section_id")
    title: str = Field(..., description="Section heading")
    content: str = Field(..., description="Markdown content of this section")
    word_count: int = Field(..., ge=0, description="Actual word count of content")
    status: Literal["pending", "drafting", "done", "revising"] = Field(
        default="pending", description="Current status of this section draft"
    )
    revision_count: int = Field(
        default=0, ge=0, description="Number of times this section has been revised"
    )
```

- [ ] **Step 5: Implement ReviewIssue and ReviewReport**

```python
# agent-service/app/models/review.py
"""Review models — quality assessment output from the Review phase."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ReviewIssue(BaseModel):
    """A single issue found during review."""

    section_id: str = Field(..., description="Which section has this issue")
    severity: Literal["minor", "major"] = Field(
        ..., description="How serious the issue is"
    )
    category: Literal["accuracy", "length", "style", "structure", "completeness", "coherence"] = Field(
        ..., description="What kind of issue this is"
    )
    description: str = Field(..., description="What the issue is")
    suggestion: str = Field(..., description="How to fix it")


class ReviewReport(BaseModel):
    """Complete review assessment of the draft.

    Produced by the Review phase. If verdict is 'revise', the affected
    sections go back to the Draft phase with the issues as guidance.
    If verdict is 'pass', the draft is finalized.
    """

    verdict: Literal["pass", "revise", "fail"] = Field(
        ..., description="Overall verdict: pass, revise (fixable issues), or fail"
    )
    issues: list[ReviewIssue] = Field(
        default_factory=list, description="All issues found"
    )
    overall_score: float = Field(
        ..., ge=0.0, le=1.0, description="Overall quality score (0.0 to 1.0)"
    )
    summary: str = Field(..., description="Human-readable summary of the review")
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/test_models/test_draft.py tests/test_models/test_review.py -v`
Expected: ALL 12 PASS

- [ ] **Step 7: Commit**

Run: `cd /e/test/Docmost && git add agent-service/app/models/draft.py agent-service/app/models/review.py agent-service/tests/test_models/test_draft.py agent-service/tests/test_models/test_review.py && git commit -m "feat(agent): add SectionDraft, ReviewIssue, ReviewReport Pydantic models with tests"`

---

### Task 6: Create SSE Event models

**Files:**
- Create: `agent-service/app/models/events.py`
- Create: `agent-service/tests/test_models/test_events.py`

- [ ] **Step 1: Write failing tests for SSE event models**

```python
# agent-service/tests/test_models/test_events.py
import json
import pytest
from pydantic import ValidationError
from app.models.events import (
    StepEvent,
    ContentEvent,
    InteractionEvent,
    SectionProgressEvent,
    CompletionEvent,
    SSEEvent,
    serialize_sse_event,
)


def test_step_event_start():
    """StepEvent with step_start type."""
    event = StepEvent(
        type="step_start",
        step_name="evidence_gathering",
        description="Reading uploaded document",
    )
    assert event.type == "step_start"
    assert event.result_summary == ""


def test_step_event_done():
    """StepEvent with step_done type."""
    event = StepEvent(
        type="step_done",
        step_name="evidence_gathering",
        result_summary="Extracted 4500 words from PDF",
    )
    assert event.type == "step_done"


def test_step_event_invalid_type():
    """Invalid step event type should raise ValidationError."""
    with pytest.raises(ValidationError):
        StepEvent(type="step_running", step_name="x")


def test_content_event_delta():
    """ContentEvent with content_delta."""
    event = ContentEvent(
        type="content_delta",
        chunk="Hello, world!",
        section_id="sec-01",
    )
    assert event.chunk == "Hello, world!"
    assert event.section_id == "sec-01"


def test_content_event_cleared():
    """ContentEvent with content_cleared."""
    event = ContentEvent(type="content_cleared")
    assert event.chunk == ""
    assert event.section_id is None


def test_interaction_event_brief():
    """InteractionEvent for brief phase."""
    event = InteractionEvent(
        type="await_user_input",
        phase="brief",
        data={"audience": "developers", "goal": "API docs"},
    )
    assert event.phase == "brief"


def test_interaction_event_invalid_phase():
    """Invalid interaction phase should raise ValidationError."""
    with pytest.raises(ValidationError):
        InteractionEvent(
            type="await_user_input",
            phase="invalid_phase",
            data={},
        )


def test_section_progress_event():
    """SectionProgressEvent with valid data."""
    event = SectionProgressEvent(
        type="section_progress",
        current=2,
        total=5,
        section_title="Implementation Details",
    )
    assert event.current == 2
    assert event.total == 5


def test_completion_event_done():
    """CompletionEvent with done type."""
    event = CompletionEvent(
        type="done",
        final_content="# Complete Document\n\nContent here...",
    )
    assert event.final_content.startswith("# Complete")
    assert event.error_message == ""


def test_completion_event_error():
    """CompletionEvent with error type."""
    event = CompletionEvent(
        type="error",
        error_message="Failed to parse uploaded document",
    )
    assert event.type == "error"


def test_completion_event_cancelled():
    """CompletionEvent with cancelled type."""
    event = CompletionEvent(type="cancelled")
    assert event.type == "cancelled"


def test_serialize_sse_event():
    """serialize_sse_event should produce valid JSON string."""
    event = StepEvent(type="step_start", step_name="briefing", description="Analyzing request")
    result = serialize_sse_event(event)
    parsed = json.loads(result)
    assert parsed["type"] == "step_start"
    assert parsed["step_name"] == "briefing"


def test_sse_event_union_discrimination():
    """SSEEvent union type should accept all event types."""
    events: list[SSEEvent] = [
        StepEvent(type="step_start", step_name="test"),
        ContentEvent(type="content_delta", chunk="hi"),
        InteractionEvent(type="await_user_input", phase="brief", data={}),
        SectionProgressEvent(type="section_progress", current=1, total=3, section_title="Intro"),
        CompletionEvent(type="done", final_content="done"),
    ]
    assert len(events) == 5
    for event in events:
        serialized = serialize_sse_event(event)
        assert isinstance(serialized, str)
        parsed = json.loads(serialized)
        assert "type" in parsed
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/test_models/test_events.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement SSE Event models**

```python
# agent-service/app/models/events.py
"""SSE Event models — the v2 protocol for frontend communication.

All events sent from agent to frontend are typed Pydantic models.
This replaces the ad-hoc dict-based events in the current LangGraph system.
"""
from __future__ import annotations

from typing import Literal, Union

from pydantic import BaseModel, Field


class StepEvent(BaseModel):
    """Signals the start or completion of a processing step."""

    type: Literal["step_start", "step_done"] = Field(
        ..., description="Whether the step is starting or finished"
    )
    step_name: str = Field(..., description="Machine-readable step identifier")
    description: str = Field(default="", description="Human-readable description")
    result_summary: str = Field(
        default="", description="Summary of what the step produced (step_done only)"
    )


class ContentEvent(BaseModel):
    """Streams content to the frontend for live preview."""

    type: Literal["content_delta", "content_cleared"] = Field(
        ..., description="content_delta = append chunk, content_cleared = reset preview"
    )
    chunk: str = Field(default="", description="Text chunk to append (content_delta only)")
    section_id: str | None = Field(
        default=None, description="Which section this chunk belongs to (if sectioned)"
    )


class InteractionEvent(BaseModel):
    """Requests user input at a decision point."""

    type: Literal["await_user_input"] = Field(default="await_user_input")
    phase: Literal["brief", "blueprint", "review"] = Field(
        ..., description="Which decision phase needs input"
    )
    data: dict = Field(
        ..., description="Serialized Brief / Blueprint / ReviewReport for user review"
    )


class SectionProgressEvent(BaseModel):
    """Reports progress through section-by-section drafting."""

    type: Literal["section_progress"] = Field(default="section_progress")
    current: int = Field(..., ge=0, description="Current section number (1-indexed)")
    total: int = Field(..., ge=0, description="Total number of sections")
    section_title: str = Field(..., description="Title of the section being drafted")


class CompletionEvent(BaseModel):
    """Signals the end of a creation session."""

    type: Literal["done", "error", "cancelled"] = Field(
        ..., description="How the session ended"
    )
    final_content: str = Field(
        default="", description="Complete final markdown content (done only)"
    )
    error_message: str = Field(
        default="", description="Error description (error only)"
    )


# Union type for type-safe event handling
SSEEvent = Union[StepEvent, ContentEvent, InteractionEvent, SectionProgressEvent, CompletionEvent]


def serialize_sse_event(event: SSEEvent) -> str:
    """Serialize an SSE event to a JSON string for transmission.

    Uses model_dump() to produce a clean dict, then JSON-encodes it.
    This is the single serialization point for all SSE events.
    """
    if isinstance(event, BaseModel):
        return event.model_dump_json()
    raise TypeError(f"Expected a Pydantic BaseModel, got {type(event)}")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/test_models/test_events.py -v`
Expected: ALL 14 PASS

- [ ] **Step 5: Commit**

Run: `cd /e/test/Docmost && git add agent-service/app/models/events.py agent-service/tests/test_models/test_events.py && git commit -m "feat(agent): add SSE v2 event Pydantic models with serialize_sse_event utility"`

---

### Task 7: Create CreationState — unified state container

**Files:**
- Create: `agent-service/app/models/state.py`
- Create: `agent-service/tests/test_models/test_state.py`

- [ ] **Step 1: Write failing tests for CreationState**

```python
# agent-service/tests/test_models/test_state.py
import pytest
from app.models.state import CreationState
from app.models.brief import CreationBrief
from app.models.asset_map import AssetMap, AssetItem
from app.models.blueprint import CreationBlueprint, SectionPlan
from app.models.draft import SectionDraft
from app.models.review import ReviewReport


def test_state_defaults():
    """CreationState with all defaults."""
    state = CreationState()
    assert state.user_message == ""
    assert state.conversation_history == []
    assert state.uploaded_files == []
    assert state.template_id is None
    assert state.system_prompt is None
    assert state.template_prompt is None
    assert state.complexity_level == 3
    assert state.brief is None
    assert state.asset_map is None
    assert state.blueprint is None
    assert state.section_drafts == []
    assert state.review_report is None
    assert state.page_id is None
    assert state.workspace_id == ""
    assert state.phase == "init"
    assert state.final_content == ""


def test_state_with_user_input():
    """CreationState with user input fields."""
    state = CreationState(
        user_message="Write a tutorial about Docker",
        workspace_id="ws-001",
        page_id="page-001",
        page_title="Docker Guide",
    )
    assert state.user_message == "Write a tutorial about Docker"
    assert state.workspace_id == "ws-001"


def test_state_with_brief():
    """CreationState with a Brief attached."""
    brief = CreationBrief(
        audience="developers",
        goal="Docker tutorial",
        target_length=3000,
        style="technical",
        tone="friendly",
        structure_strategy="ai_recommend",
        image_strategy="none",
    )
    state = CreationState(brief=brief)
    assert state.brief is not None
    assert state.brief.audience == "developers"


def test_state_with_blueprint():
    """CreationState with Blueprint attached."""
    section = SectionPlan(
        section_id="s1",
        title="Getting Started",
        target_words=500,
        key_points=["Install Docker"],
    )
    blueprint = CreationBlueprint(
        title="Docker Tutorial",
        sections=[section],
        total_target_words=500,
    )
    state = CreationState(blueprint=blueprint)
    assert state.blueprint is not None
    assert len(state.blueprint.sections) == 1


def test_state_with_drafts():
    """CreationState with section drafts."""
    drafts = [
        SectionDraft(section_id="s1", title="Intro", content="Hello", word_count=1, status="done"),
        SectionDraft(section_id="s2", title="Body", content="Details", word_count=1, status="drafting"),
    ]
    state = CreationState(section_drafts=drafts)
    assert len(state.section_drafts) == 2


def test_state_with_review():
    """CreationState with ReviewReport."""
    report = ReviewReport(
        verdict="pass",
        issues=[],
        overall_score=0.9,
        summary="Good quality",
    )
    state = CreationState(review_report=report)
    assert state.review_report is not None
    assert state.review_report.verdict == "pass"


def test_state_full_lifecycle():
    """Simulate a full state lifecycle: init → brief → blueprint → draft → review."""
    state = CreationState(
        user_message="Write about Docker",
        workspace_id="ws-001",
        phase="init",
    )

    # Briefing phase
    brief = CreationBrief(
        audience="devs", goal="tutorial", target_length=1000,
        style="technical", tone="friendly",
        structure_strategy="ai_recommend", image_strategy="none",
    )
    state = state.model_copy(update={"brief": brief, "phase": "briefing"})
    assert state.phase == "briefing"

    # Blueprint phase
    section = SectionPlan(section_id="s1", title="Intro", target_words=1000, key_points=["Overview"])
    blueprint = CreationBlueprint(title="Docker", sections=[section], total_target_words=1000)
    state = state.model_copy(update={"blueprint": blueprint, "phase": "blueprint"})
    assert state.phase == "blueprint"

    # Draft phase
    draft = SectionDraft(section_id="s1", title="Intro", content="Content...", word_count=950, status="done")
    state = state.model_copy(update={"section_drafts": [draft], "phase": "drafting"})
    assert state.phase == "drafting"

    # Review phase
    report = ReviewReport(verdict="pass", issues=[], overall_score=0.9, summary="OK")
    state = state.model_copy(update={
        "review_report": report,
        "final_content": "# Docker\n\nContent...",
        "phase": "done",
    })
    assert state.phase == "done"
    assert state.final_content.startswith("# Docker")


def test_state_serialization_roundtrip():
    """Full state with nested models should survive JSON roundtrip."""
    brief = CreationBrief(
        audience="all", goal="test", target_length=500,
        style="neutral", tone="neutral",
        structure_strategy="ai_recommend", image_strategy="none",
    )
    asset = AssetItem(id="a1", type="text", source="doc.pdf", content="text")
    asset_map = AssetMap(items=[asset], source_word_count=100)

    state = CreationState(
        user_message="test",
        workspace_id="ws-001",
        brief=brief,
        asset_map=asset_map,
        phase="briefing",
    )
    data = state.model_dump()
    restored = CreationState(**data)
    assert restored == state
    assert restored.brief.audience == "all"
    assert len(restored.asset_map.items) == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/test_models/test_state.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement CreationState**

```python
# agent-service/app/models/state.py
"""CreationState — unified state container for the AI Creator v2 orchestrator.

Replaces the 45-field TypedDict (app/agent/state.py:AgentState) with a
structured Pydantic model. Each phase of creation reads from and writes
to specific typed fields rather than a flat dict.
"""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.models.brief import CreationBrief
from app.models.asset_map import AssetMap
from app.models.blueprint import CreationBlueprint
from app.models.draft import SectionDraft
from app.models.review import ReviewReport


class CreationState(BaseModel):
    """Complete state for one creation session.

    Fields are grouped by lifecycle phase:
    1. User input — provided at session start
    2. Task analysis — determined by initial routing
    3. Structured intermediates — built phase by phase
    4. Page context — the document being created/edited
    5. Progress — current phase and final output
    """

    # ── User input ──────────────────────────────────────────────
    user_message: str = Field(default="", description="The user's original request")
    conversation_history: list[dict] = Field(
        default_factory=list, description="Previous messages in this session"
    )
    uploaded_files: list[dict] = Field(
        default_factory=list,
        description="Files uploaded by the user [{name, url, type, size}]",
    )
    template_id: str | None = Field(
        default=None, description="Selected AI template ID"
    )
    system_prompt: str | None = Field(
        default=None, description="Workspace-level system prompt override"
    )
    template_prompt: str | None = Field(
        default=None, description="Template-specific prompt instructions"
    )

    # ── Task analysis ───────────────────────────────────────────
    complexity_level: Literal[1, 2, 3] = Field(
        default=3,
        description=(
            "Task complexity: "
            "1 = simple (direct answer, no blueprint needed), "
            "2 = medium (short content, abbreviated flow), "
            "3 = complex (full Brief → Blueprint → Draft → Review)"
        ),
    )

    # ── Structured intermediates ────────────────────────────────
    brief: CreationBrief | None = Field(
        default=None, description="Negotiated creation brief"
    )
    asset_map: AssetMap | None = Field(
        default=None, description="Inventory of source assets"
    )
    blueprint: CreationBlueprint | None = Field(
        default=None, description="Structural plan for the document"
    )
    section_drafts: list[SectionDraft] = Field(
        default_factory=list, description="Per-section draft content"
    )
    review_report: ReviewReport | None = Field(
        default=None, description="Quality review report"
    )

    # ── Page context ────────────────────────────────────────────
    page_id: str | None = Field(default=None, description="Target page UUID")
    page_title: str | None = Field(default=None, description="Current page title")
    page_content: str | None = Field(
        default=None, description="Current page content (markdown)"
    )
    selected_text: str | None = Field(
        default=None, description="User-selected text for editing"
    )
    workspace_id: str = Field(default="", description="Workspace UUID")

    # ── Progress ────────────────────────────────────────────────
    phase: str = Field(
        default="init",
        description=(
            "Current phase: init, evidence, briefing, blueprint, "
            "drafting, reviewing, done, error"
        ),
    )
    final_content: str = Field(
        default="", description="Assembled final markdown output"
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/test_models/test_state.py -v`
Expected: ALL 9 PASS

- [ ] **Step 5: Commit**

Run: `cd /e/test/Docmost && git add agent-service/app/models/state.py agent-service/tests/test_models/test_state.py && git commit -m "feat(agent): add CreationState unified state container replacing TypedDict"`

---

## Chunk 3: Utilities

### Task 8: Create Chinese-aware word counting utility

**Files:**
- Create: `agent-service/app/utils/__init__.py`
- Create: `agent-service/app/utils/text.py`
- Create: `agent-service/tests/test_utils/__init__.py`
- Create: `agent-service/tests/test_utils/test_text.py`

- [ ] **Step 1: Write failing tests for count_words**

```python
# agent-service/tests/test_utils/__init__.py
```

```python
# agent-service/tests/test_utils/test_text.py
import pytest
from app.utils.text import count_words


def test_count_words_english_only():
    """Pure English text, whitespace-split."""
    assert count_words("Hello world") == 2
    assert count_words("one two three four five") == 5


def test_count_words_chinese_only():
    """Pure Chinese text, each character = 1 word."""
    assert count_words("你好世界") == 4
    assert count_words("这是一个测试") == 6


def test_count_words_mixed():
    """Mixed Chinese and English text."""
    # "Hello 你好 world" → 2 English words + 2 Chinese chars = 4
    assert count_words("Hello 你好 world") == 4


def test_count_words_empty():
    """Empty string should return 0."""
    assert count_words("") == 0


def test_count_words_whitespace_only():
    """Whitespace-only string should return 0."""
    assert count_words("   \n\t  ") == 0


def test_count_words_markdown():
    """Markdown text with headers, lists, code."""
    text = "# 标题\n\n这是一段说明文字。\n\n- Item one\n- Item two\n\n```python\nprint('hello')\n```"
    # Chinese: 标题这是一段说明文字 = 9 chars
    # English: #, Item, one, Item, two, ```python, print('hello'), ``` = varies
    result = count_words(text)
    assert result > 10  # sanity check, exact count depends on punctuation handling


def test_count_words_cjk_extended():
    """CJK Unified Ideographs Extension B characters."""
    # U+20000 range characters (rare but valid)
    text = "测试 test 文本"
    assert count_words(text) == 5  # 测试文本 = 4 Chinese + test = 1 English


def test_count_words_numbers_and_punctuation():
    """Numbers and punctuation handling."""
    assert count_words("There are 42 items.") == 4
    assert count_words("共有42个选项") == 5  # 共有 + 个选项 = 4 Chinese + "42" is non-Chinese word = 5


def test_count_words_long_text():
    """Longer text for sanity check."""
    english = " ".join(["word"] * 100)
    assert count_words(english) == 100

    chinese = "字" * 100
    assert count_words(chinese) == 100
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/test_utils/test_text.py -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement count_words**

```python
# agent-service/app/utils/__init__.py
"""Utility functions for the agent service."""
```

```python
# agent-service/app/utils/text.py
"""Text processing utilities with CJK awareness."""
from __future__ import annotations

import re


def count_words(text: str) -> int:
    """Count words with Chinese/CJK awareness.

    Chinese characters (CJK Unified Ideographs) count as 1 word each.
    Non-Chinese text is counted by whitespace splitting.
    This gives a reasonable approximation for mixed-language documents.

    Args:
        text: Input text, may contain Chinese, English, or mixed content.

    Returns:
        Approximate word count.
    """
    if not text or not text.strip():
        return 0

    # Count CJK characters (Basic + Extension A)
    chinese_chars = len(re.findall(r'[\u4e00-\u9fff\u3400-\u4dbf]', text))

    # Remove CJK characters, then count remaining words by whitespace
    non_chinese = re.sub(r'[\u4e00-\u9fff\u3400-\u4dbf]', ' ', text)
    english_words = len(non_chinese.split())

    return chinese_chars + english_words
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/test_utils/test_text.py -v`
Expected: ALL 10 PASS

- [ ] **Step 5: Commit**

Run: `cd /e/test/Docmost && git add agent-service/app/utils/__init__.py agent-service/app/utils/text.py agent-service/tests/test_utils/__init__.py agent-service/tests/test_utils/test_text.py && git commit -m "feat(agent): add Chinese-aware word counting utility (count_words)"`

---

## Chunk 4: Frontend TypeScript Types

### Task 9: Create TypeScript type definitions mirroring Python models

**Files:**
- Create: `apps/client/src/ee/ai/types/brief.types.ts`
- Create: `apps/client/src/ee/ai/types/blueprint.types.ts`
- Create: `apps/client/src/ee/ai/types/review.types.ts`
- Create: `apps/client/src/ee/ai/types/draft.types.ts`
- Create: `apps/client/src/ee/ai/types/events-v2.types.ts`

- [ ] **Step 1: Create brief.types.ts**

```typescript
// apps/client/src/ee/ai/types/brief.types.ts
/**
 * CreationBrief — mirrors agent-service/app/models/brief.py
 *
 * The negotiated contract between user intent and agent plan.
 */

export type StructureStrategy = 'copy_source' | 'ai_recommend' | 'user_defined';
export type ImageStrategy = 'reuse_source' | 'generate_new' | 'mixed' | 'none';

export interface CreationBrief {
  audience: string;
  goal: string;
  target_length: number;
  length_tolerance: number;
  style: string;
  tone: string;
  structure_strategy: StructureStrategy;
  image_strategy: ImageStrategy;
  constraints: string[];
}
```

- [ ] **Step 2: Create blueprint.types.ts**

```typescript
// apps/client/src/ee/ai/types/blueprint.types.ts
/**
 * Blueprint models — mirrors agent-service/app/models/blueprint.py
 *
 * Structural plan for content creation.
 */

export type VisualType = 'image' | 'table' | 'mermaid' | 'code' | 'diagram';

export interface VisualPlan {
  type: VisualType;
  description: string;
  placement: string;
  source_asset_id: string | null;
}

export interface SectionPlan {
  section_id: string;
  title: string;
  target_words: number;
  key_points: string[];
  asset_ids: string[];
  visuals: VisualPlan[];
  depends_on: string[];
}

export interface CreationBlueprint {
  title: string;
  summary: string;
  sections: SectionPlan[];
  total_target_words: number;
}
```

- [ ] **Step 3: Create review.types.ts**

```typescript
// apps/client/src/ee/ai/types/review.types.ts
/**
 * Review models — mirrors agent-service/app/models/review.py
 *
 * Quality assessment from the Review phase.
 */

export type ReviewSeverity = 'minor' | 'major';
export type ReviewCategory =
  | 'accuracy'
  | 'length'
  | 'style'
  | 'structure'
  | 'completeness'
  | 'coherence';
export type ReviewVerdict = 'pass' | 'revise' | 'fail';

export interface ReviewIssue {
  section_id: string;
  severity: ReviewSeverity;
  category: ReviewCategory;
  description: string;
  suggestion: string;
}

export interface ReviewReport {
  verdict: ReviewVerdict;
  issues: ReviewIssue[];
  overall_score: number;
  summary: string;
}
```

- [ ] **Step 4: Create draft.types.ts**

```typescript
// apps/client/src/ee/ai/types/draft.types.ts
/**
 * Draft models — mirrors agent-service/app/models/draft.py
 *
 * Section-by-section draft tracking.
 */

export type DraftStatus = 'pending' | 'drafting' | 'done' | 'revising';

export interface SectionDraft {
  section_id: string;
  title: string;
  content: string;
  word_count: number;
  status: DraftStatus;
  revision_count: number;
}
```

- [ ] **Step 5: Create events-v2.types.ts**

```typescript
// apps/client/src/ee/ai/types/events-v2.types.ts
/**
 * SSE Event v2 protocol — mirrors agent-service/app/models/events.py
 *
 * New event types for the PydanticAI-based orchestrator.
 * The existing AgentSSEEvent in agent.types.ts remains for the
 * current LangGraph system until migration is complete.
 */

export interface StepEvent {
  type: 'step_start' | 'step_done';
  step_name: string;
  description: string;
  result_summary: string;
}

export interface ContentEvent {
  type: 'content_delta' | 'content_cleared';
  chunk: string;
  section_id: string | null;
}

export interface InteractionEvent {
  type: 'await_user_input';
  phase: 'brief' | 'blueprint' | 'review';
  data: Record<string, unknown>;
}

export interface SectionProgressEvent {
  type: 'section_progress';
  current: number;
  total: number;
  section_title: string;
}

export interface CompletionEvent {
  type: 'done' | 'error' | 'cancelled';
  final_content: string;
  error_message: string;
}

export type SSEEventV2 =
  | StepEvent
  | ContentEvent
  | InteractionEvent
  | SectionProgressEvent
  | CompletionEvent;
```

- [ ] **Step 6: Verify TypeScript compiles (no syntax errors)**

Run: `cd /e/test/Docmost && npx tsc --noEmit apps/client/src/ee/ai/types/brief.types.ts apps/client/src/ee/ai/types/blueprint.types.ts apps/client/src/ee/ai/types/review.types.ts apps/client/src/ee/ai/types/draft.types.ts apps/client/src/ee/ai/types/events-v2.types.ts 2>&1 || echo "Note: tsc may need project context; verify no syntax errors manually"`

- [ ] **Step 7: Commit**

Run: `cd /e/test/Docmost && git add apps/client/src/ee/ai/types/brief.types.ts apps/client/src/ee/ai/types/blueprint.types.ts apps/client/src/ee/ai/types/review.types.ts apps/client/src/ee/ai/types/draft.types.ts apps/client/src/ee/ai/types/events-v2.types.ts && git commit -m "feat(client): add TypeScript types for AI Creator v2 (Brief, Blueprint, Review, Draft, Events)"`

---

## Chunk 5: Frontend Component Scaffolding

### Task 10: Scaffold frontend component directories

**Files:**
- Create: `apps/client/src/ee/ai/components/ai-creator/smart-brief/SmartBriefCard.tsx`
- Create: `apps/client/src/ee/ai/components/ai-creator/blueprint/BlueprintModal.tsx`
- Create: `apps/client/src/ee/ai/components/ai-creator/live-draft/DraftProgressBar.tsx`
- Create: `apps/client/src/ee/ai/components/ai-creator/review/ReviewModal.tsx`
- Create: `apps/client/src/ee/ai/components/ai-creator/draft-manager/DraftPanel.tsx`

- [ ] **Step 1: Create SmartBriefCard placeholder**

```tsx
// apps/client/src/ee/ai/components/ai-creator/smart-brief/SmartBriefCard.tsx
import { Card, Text } from '@mantine/core';

/**
 * SmartBriefCard — displays the AI-generated CreationBrief for user review.
 *
 * Shows audience, goal, target length, style, tone, structure/image strategy.
 * User can approve, modify, or request regeneration.
 *
 * TODO: Phase 2 implementation
 */
export function SmartBriefCard() {
  return (
    <Card withBorder p="md">
      <Text c="dimmed" size="sm">
        TODO: SmartBriefCard — Creation brief review and editing
      </Text>
    </Card>
  );
}
```

- [ ] **Step 2: Create BlueprintModal placeholder**

```tsx
// apps/client/src/ee/ai/components/ai-creator/blueprint/BlueprintModal.tsx
import { Modal, Text } from '@mantine/core';

/**
 * BlueprintModal — displays the document blueprint for user review.
 *
 * Shows section plan with titles, word budgets, key points, and visual plans.
 * User can reorder sections, adjust word budgets, or approve.
 *
 * TODO: Phase 2 implementation
 */
interface BlueprintModalProps {
  opened: boolean;
  onClose: () => void;
}

export function BlueprintModal({ opened, onClose }: BlueprintModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title="Document Blueprint" size="lg">
      <Text c="dimmed" size="sm">
        TODO: BlueprintModal — Document structure review and editing
      </Text>
    </Modal>
  );
}
```

- [ ] **Step 3: Create DraftProgressBar placeholder**

```tsx
// apps/client/src/ee/ai/components/ai-creator/live-draft/DraftProgressBar.tsx
import { Progress, Text, Stack } from '@mantine/core';

/**
 * DraftProgressBar — shows section-by-section writing progress.
 *
 * Displays which section is currently being drafted, how many are complete,
 * and the overall progress percentage.
 *
 * TODO: Phase 3 implementation
 */
export function DraftProgressBar() {
  return (
    <Stack gap="xs">
      <Text size="sm" c="dimmed">
        TODO: DraftProgressBar — Section-by-section progress
      </Text>
      <Progress value={0} size="sm" />
    </Stack>
  );
}
```

- [ ] **Step 4: Create ReviewModal placeholder**

```tsx
// apps/client/src/ee/ai/components/ai-creator/review/ReviewModal.tsx
import { Modal, Text } from '@mantine/core';

/**
 * ReviewModal — displays the ReviewReport for user review.
 *
 * Shows issues by section with severity, category, and suggestions.
 * User can accept suggested fixes, request revision, or approve as-is.
 *
 * TODO: Phase 4 implementation
 */
interface ReviewModalProps {
  opened: boolean;
  onClose: () => void;
}

export function ReviewModal({ opened, onClose }: ReviewModalProps) {
  return (
    <Modal opened={opened} onClose={onClose} title="Quality Review" size="lg">
      <Text c="dimmed" size="sm">
        TODO: ReviewModal — Quality review results and actions
      </Text>
    </Modal>
  );
}
```

- [ ] **Step 5: Create DraftPanel placeholder**

```tsx
// apps/client/src/ee/ai/components/ai-creator/draft-manager/DraftPanel.tsx
import { Paper, Text } from '@mantine/core';

/**
 * DraftPanel — manages and displays section drafts.
 *
 * Shows all section drafts with their statuses, allows expanding individual
 * sections, and provides controls for manual editing and regeneration.
 *
 * TODO: Phase 3 implementation
 */
export function DraftPanel() {
  return (
    <Paper withBorder p="md">
      <Text c="dimmed" size="sm">
        TODO: DraftPanel — Section draft management
      </Text>
    </Paper>
  );
}
```

- [ ] **Step 6: Commit**

Run: `cd /e/test/Docmost && git add apps/client/src/ee/ai/components/ai-creator/smart-brief/SmartBriefCard.tsx apps/client/src/ee/ai/components/ai-creator/blueprint/BlueprintModal.tsx apps/client/src/ee/ai/components/ai-creator/live-draft/DraftProgressBar.tsx apps/client/src/ee/ai/components/ai-creator/review/ReviewModal.tsx apps/client/src/ee/ai/components/ai-creator/draft-manager/DraftPanel.tsx && git commit -m "feat(client): scaffold AI Creator v2 components (SmartBrief, Blueprint, DraftProgress, Review, DraftPanel)"`

---

## Chunk 6: Orchestrator Scaffolding

### Task 11: Create Orchestrator and Workers scaffolding

**Files:**
- Create: `agent-service/app/orchestrator/__init__.py`
- Create: `agent-service/app/orchestrator/engine.py`
- Create: `agent-service/app/orchestrator/prompts.py`
- Create: `agent-service/app/orchestrator/tools.py`
- Create: `agent-service/app/workers/__init__.py`
- Create: `agent-service/tests/test_orchestrator/__init__.py`
- Create: `agent-service/tests/test_orchestrator/test_engine.py`
- Create: `agent-service/tests/test_orchestrator/test_prompts.py`

- [ ] **Step 1: Write failing tests for orchestrator scaffolding**

```python
# agent-service/tests/test_orchestrator/__init__.py
```

```python
# agent-service/tests/test_orchestrator/test_engine.py
from app.orchestrator.engine import CreationOrchestrator


def test_orchestrator_class_exists():
    """CreationOrchestrator class should be importable."""
    assert CreationOrchestrator is not None


def test_orchestrator_instantiation():
    """CreationOrchestrator should be instantiable with no args."""
    orchestrator = CreationOrchestrator()
    assert orchestrator is not None
```

```python
# agent-service/tests/test_orchestrator/test_prompts.py
from app.orchestrator.prompts import ORCHESTRATOR_SYSTEM_PROMPT


def test_system_prompt_exists():
    """ORCHESTRATOR_SYSTEM_PROMPT should be a non-empty string."""
    assert isinstance(ORCHESTRATOR_SYSTEM_PROMPT, str)
    assert len(ORCHESTRATOR_SYSTEM_PROMPT) > 100
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/test_orchestrator/ -v`
Expected: FAIL with `ModuleNotFoundError`

- [ ] **Step 3: Implement orchestrator package init**

```python
# agent-service/app/orchestrator/__init__.py
"""PydanticAI-based orchestrator for AI Creator v2.

This package replaces app/agent/ (LangGraph-based) with a PydanticAI
agent-driven architecture. During migration, both systems coexist.
"""
```

- [ ] **Step 4: Implement CreationOrchestrator scaffold**

```python
# agent-service/app/orchestrator/engine.py
"""CreationOrchestrator — the main entry point for AI Creator v2.

Replaces the LangGraph StateGraph (app/agent/graph.py) with a PydanticAI
agent-driven orchestration engine. The orchestrator manages the full
lifecycle: Evidence → Brief → Blueprint → Draft → Review.

This file is a scaffold. Phase 1 will add the actual PydanticAI agent
and tool registration.
"""
from __future__ import annotations

from app.models.state import CreationState


class CreationOrchestrator:
    """Orchestrates the AI content creation pipeline.

    Lifecycle:
        1. Evidence gathering — read sources, parse uploads, search
        2. Briefing — analyze intent, produce CreationBrief
        3. Blueprint — plan document structure (CreationBlueprint)
        4. Drafting — write section by section (SectionDraft[])
        5. Review — quality check (ReviewReport), optionally loop back

    The orchestrator uses PydanticAI agents internally. Each phase
    is a method that takes CreationState and returns updated state.

    Usage (Phase 1+):
        orchestrator = CreationOrchestrator()
        async for event in orchestrator.run(state):
            yield event  # SSEEvent instances
    """

    def __init__(self) -> None:
        """Initialize the orchestrator.

        TODO (Phase 1): Accept config, create PydanticAI agent,
        register tools from app/orchestrator/tools.py.
        """
        self._state: CreationState | None = None

    async def run(self, state: CreationState):
        """Run the full creation pipeline.

        Args:
            state: Initial CreationState with user input.

        Yields:
            SSEEvent instances for frontend consumption.

        TODO (Phase 1): Implement the actual pipeline.
        """
        raise NotImplementedError("Phase 1 will implement the orchestration pipeline")
```

- [ ] **Step 5: Implement ORCHESTRATOR_SYSTEM_PROMPT**

```python
# agent-service/app/orchestrator/prompts.py
"""System prompts for the AI Creator v2 orchestrator.

These prompts configure the PydanticAI agent's behavior. They are
constants, not templates — dynamic context is injected via tool results
and structured output schemas.
"""

ORCHESTRATOR_SYSTEM_PROMPT = """\
You are a professional content creation agent embedded in a collaborative \
document management system (similar to Notion or Confluence).

Your job is to create high-quality documents based on user requests, source \
materials, and structured plans.

## Core Principles

1. **Evidence First**: Always read and understand source materials before \
writing. Never generate content that contradicts or ignores provided sources.

2. **Structured Creation**: For complex documents, follow the \
Brief → Blueprint → Draft → Review pipeline. For simple requests, \
skip directly to writing.

3. **Length Fidelity**: Match the target word count within the specified \
tolerance. Neither pad with filler nor aggressively compress.

4. **Natural Voice**: Write like a knowledgeable human author, not an AI. \
Avoid cliches, hedging phrases, and formulaic transitions. Vary sentence \
structure and paragraph length naturally.

5. **Source Grounding**: When source material is provided, ground your \
writing in it. Preserve factual accuracy, reuse valuable examples, and \
maintain the source's level of specificity.

6. **CJK Awareness**: The system handles Chinese, Japanese, and Korean text. \
Word counts use CJK-aware counting (each CJK character = 1 word). Adapt \
writing style to the language of the request.

## Interaction Protocol

- When you need user input, use the await_user_input tool with the \
appropriate phase (brief, blueprint, or review).
- When streaming content, emit content_delta events for live preview.
- Report progress with step_start/step_done events.
- If evidence gathering fails for a required source, emit an error event \
and stop. Do not fabricate content.

## Anti-Patterns to Avoid

- Do not ask clarifying questions when the answer is obvious from context.
- Do not propose multiple options when the task is straightforward.
- Do not use phrases like "certainly", "I'd be happy to", "let me", \
"here is", or other AI-assistant markers.
- Do not add disclaimers, warnings, or meta-commentary unless specifically \
relevant to the content.
- Do not pad sections with repetitive summaries or filler paragraphs.
"""
```

- [ ] **Step 6: Implement tools registry scaffold**

```python
# agent-service/app/orchestrator/tools.py
"""Tool registry for the AI Creator v2 orchestrator.

Adapts existing tools from app/tools/ for use with PydanticAI.
During Phase 0, this is an empty registry. Phase 1 will wire up
the existing 9 tools (tavily_search, firecrawl_scrape, docling_parser,
vlm_understand, nanobana_imggen, image_annotate, docmost_page_read,
docmost_rag, docmost_upload) as PydanticAI tools.
"""
from __future__ import annotations


# Tool functions will be registered here in Phase 1.
# Each tool will be a plain async function decorated with @agent.tool
# that wraps the existing LangChain tool implementation.
#
# Example (Phase 1):
#
#   @orchestrator_agent.tool
#   async def search_web(ctx: RunContext[CreationState], query: str) -> str:
#       """Search the web for relevant information."""
#       return await tavily_search(query)

REGISTERED_TOOLS: list[str] = []
"""List of tool names registered with the orchestrator. Populated at import time in Phase 1."""
```

- [ ] **Step 7: Create workers package init**

```python
# agent-service/app/workers/__init__.py
"""Worker functions for the AI Creator v2 orchestrator.

Workers are phase-specific functions that implement the actual logic
for each creation phase (evidence, briefing, blueprint, drafting, review).
They replace the LangGraph node functions in app/agent/nodes/.

This package is a scaffold. Workers will be implemented in Phases 1-4.
"""
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/test_orchestrator/ -v`
Expected: ALL 3 PASS

- [ ] **Step 9: Update models __init__.py with re-exports**

```python
# agent-service/app/models/__init__.py
"""Pydantic v2 data models for the AI Creator v2 orchestrator.

All models are re-exported here for convenient imports:
    from app.models import CreationState, CreationBrief, CreationBlueprint, ...
"""
from app.models.brief import CreationBrief
from app.models.asset_map import AssetItem, AssetMap
from app.models.blueprint import VisualPlan, SectionPlan, CreationBlueprint
from app.models.draft import SectionDraft
from app.models.review import ReviewIssue, ReviewReport
from app.models.events import (
    StepEvent,
    ContentEvent,
    InteractionEvent,
    SectionProgressEvent,
    CompletionEvent,
    SSEEvent,
    serialize_sse_event,
)
from app.models.state import CreationState

__all__ = [
    "CreationBrief",
    "AssetItem",
    "AssetMap",
    "VisualPlan",
    "SectionPlan",
    "CreationBlueprint",
    "SectionDraft",
    "ReviewIssue",
    "ReviewReport",
    "StepEvent",
    "ContentEvent",
    "InteractionEvent",
    "SectionProgressEvent",
    "CompletionEvent",
    "SSEEvent",
    "serialize_sse_event",
    "CreationState",
]
```

- [ ] **Step 10: Write import test for re-exports**

```python
# agent-service/tests/test_models/test_imports.py
"""Verify all models are importable from the package root."""


def test_import_all_from_models():
    """All public models should be importable from app.models."""
    from app.models import (
        CreationBrief,
        AssetItem,
        AssetMap,
        VisualPlan,
        SectionPlan,
        CreationBlueprint,
        SectionDraft,
        ReviewIssue,
        ReviewReport,
        StepEvent,
        ContentEvent,
        InteractionEvent,
        SectionProgressEvent,
        CompletionEvent,
        SSEEvent,
        serialize_sse_event,
        CreationState,
    )
    # All should be non-None class/function objects
    assert all(obj is not None for obj in [
        CreationBrief, AssetItem, AssetMap, VisualPlan, SectionPlan,
        CreationBlueprint, SectionDraft, ReviewIssue, ReviewReport,
        StepEvent, ContentEvent, InteractionEvent, SectionProgressEvent,
        CompletionEvent, SSEEvent, serialize_sse_event, CreationState,
    ])
```

- [ ] **Step 11: Run all tests to verify everything works together**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/test_models/ tests/test_utils/ tests/test_orchestrator/ -v`
Expected: ALL PASS (should be ~50+ tests total)

- [ ] **Step 12: Commit**

Run: `cd /e/test/Docmost && git add agent-service/app/orchestrator/__init__.py agent-service/app/orchestrator/engine.py agent-service/app/orchestrator/prompts.py agent-service/app/orchestrator/tools.py agent-service/app/workers/__init__.py agent-service/app/models/__init__.py agent-service/tests/test_orchestrator/__init__.py agent-service/tests/test_orchestrator/test_engine.py agent-service/tests/test_orchestrator/test_prompts.py agent-service/tests/test_models/test_imports.py && git commit -m "feat(agent): scaffold orchestrator (engine, prompts, tools) and workers package with tests"`

---

## Completion Checklist

When all tasks are done, verify:

- [ ] `cd /e/test/Docmost/agent-service && python -m pytest tests/test_models/ tests/test_utils/ tests/test_orchestrator/ -v` — all tests pass
- [ ] `cd /e/test/Docmost/agent-service && python -c "from app.models import CreationState; print('OK')"` — models importable
- [ ] `cd /e/test/Docmost/agent-service && python -c "from app.orchestrator.engine import CreationOrchestrator; print('OK')"` — orchestrator importable
- [ ] `cd /e/test/Docmost/agent-service && python -c "from app.utils.text import count_words; print(count_words('Hello 你好'))"` — prints 3
- [ ] Existing LangGraph system still works: `cd /e/test/Docmost/agent-service && python -c "from app.agent.graph import build_agent_graph; print('OK')"`
- [ ] Frontend types exist: `ls apps/client/src/ee/ai/types/{brief,blueprint,review,draft,events-v2}.types.ts`
- [ ] Frontend components scaffolded: `ls apps/client/src/ee/ai/components/ai-creator/{smart-brief,blueprint,live-draft,review,draft-manager}/`

## Files Created (Summary)

### Python (agent-service/)
| File | Purpose |
|------|---------|
| `app/models/__init__.py` | Package init with re-exports |
| `app/models/brief.py` | CreationBrief model |
| `app/models/asset_map.py` | AssetItem, AssetMap models |
| `app/models/blueprint.py` | VisualPlan, SectionPlan, CreationBlueprint models |
| `app/models/draft.py` | SectionDraft model |
| `app/models/review.py` | ReviewIssue, ReviewReport models |
| `app/models/events.py` | SSE v2 event models + serialize_sse_event |
| `app/models/state.py` | CreationState unified state container |
| `app/utils/__init__.py` | Utils package init |
| `app/utils/text.py` | count_words (CJK-aware) |
| `app/orchestrator/__init__.py` | Orchestrator package init |
| `app/orchestrator/engine.py` | CreationOrchestrator scaffold |
| `app/orchestrator/prompts.py` | ORCHESTRATOR_SYSTEM_PROMPT |
| `app/orchestrator/tools.py` | Tool registry scaffold |
| `app/workers/__init__.py` | Workers package init |

### Tests (agent-service/tests/)
| File | Purpose |
|------|---------|
| `tests/test_models/__init__.py` | Test package init |
| `tests/test_models/test_brief.py` | CreationBrief tests (6) |
| `tests/test_models/test_asset_map.py` | AssetItem/AssetMap tests (7) |
| `tests/test_models/test_blueprint.py` | Blueprint tests (8) |
| `tests/test_models/test_draft.py` | SectionDraft tests (4) |
| `tests/test_models/test_review.py` | ReviewIssue/ReviewReport tests (8) |
| `tests/test_models/test_events.py` | SSE event tests (14) |
| `tests/test_models/test_state.py` | CreationState tests (9) |
| `tests/test_models/test_imports.py` | Re-export verification (1) |
| `tests/test_utils/__init__.py` | Test package init |
| `tests/test_utils/test_text.py` | count_words tests (10) |
| `tests/test_orchestrator/__init__.py` | Test package init |
| `tests/test_orchestrator/test_engine.py` | Orchestrator scaffold tests (2) |
| `tests/test_orchestrator/test_prompts.py` | Prompt constant tests (1) |

### TypeScript (apps/client/src/ee/ai/)
| File | Purpose |
|------|---------|
| `types/brief.types.ts` | CreationBrief interface |
| `types/blueprint.types.ts` | Blueprint interfaces |
| `types/review.types.ts` | Review interfaces |
| `types/draft.types.ts` | SectionDraft interface |
| `types/events-v2.types.ts` | SSE v2 event types |
| `components/ai-creator/smart-brief/SmartBriefCard.tsx` | Placeholder |
| `components/ai-creator/blueprint/BlueprintModal.tsx` | Placeholder |
| `components/ai-creator/live-draft/DraftProgressBar.tsx` | Placeholder |
| `components/ai-creator/review/ReviewModal.tsx` | Placeholder |
| `components/ai-creator/draft-manager/DraftPanel.tsx` | Placeholder |

### Modified
| File | Change |
|------|--------|
| `agent-service/pyproject.toml` | Added `pydantic-ai>=0.2` dependency |

**Total: 30 new files, 1 modified file, ~70 tests**
