# 阶段 2：素材与规划实施计划

> **对于智能体执行者：** 要求：使用 superpowers:subagent-driven-development （如果子代理可用）或 superpowers:executing-plans 来实施此计划。步骤使用复选框 (`- [ ]`) 语法进行跟踪。

**目标：** 构建结构化资产解析、智能简报交互、具有可视化规划的创建蓝图以及 2 级任务路径。

**架构：** AssetParser Worker使用Docling + VLM进行深度资产提取。 VisualPlanner Worker 分析部分以规划图像。 Smart Brief 是一张侧边栏卡。蓝图是一个带有可拖动部分的弹出模式。全部由 Orchestrator 工具提供支持。

**技术栈：** PydanticAI、Docling、Pillow、VLM、Mantine UI、@dnd-kit/sortable

**先决条件（从阶段 0 和阶段 1）：**
- Pydantic 型号：`CreationBrief`、`AssetMap`、`AssetItem`、`CreationBlueprint`、`SectionPlan`、`VisualPlan`
- 中文字数统计实用程序（`app/utils/word_count.py`）
- 带有 ReAct 循环的 Orchestrator 引擎 (`app/orchestrator/engine.py`)
- `ask_user` 用于用户交互中断的工具
- 现有工具：`docling_parser`、`vlm_understand`、`docmost_upload`、`tavily_search`、`firecrawl_scrape`、`docmost_rag`、`docmost_page_read`
- SSE 事件协议和 `asyncio.Queue` 事件流

---

## 文件结构概述

### 新文件（代理服务）

| 文件 | 用途 |
|------|---------|
| `agent-service/app/workers/__init__.py` | 工人包初始化 |
| `agent-service/app/workers/asset_parser.py` | AssetParser Worker — 文档和图像处理 |
| `agent-service/app/workers/visual_planner.py` | VisualPlanner Worker — 每个部分的图像/图表策略 |
| `agent-service/app/workers/researcher.py` | Researcher Worker — 包含搜索/抓取/RAG 工具 |
| `agent-service/app/orchestrator/tools/parse_assets.py` | Orchestrator 工具包装 AssetParser |
| `agent-service/app/orchestrator/tools/create_brief.py` | 用于生成智能简报的 Orchestrator 工具 |
| `agent-service/app/orchestrator/tools/create_blueprint.py` | 用于生成蓝图的 Orchestrator 工具 |
| `agent-service/app/orchestrator/tools/research.py` | Orchestrator 工具包装 研究人员 工作者 |
| `agent-service/tests/workers/__init__.py` | 工人测试包 |
| `agent-service/tests/workers/test_asset_parser.py` | AssetParser 单元测试 |
| `agent-service/tests/workers/test_visual_planner.py` | VisualPlanner 单元测试 |
| `agent-service/tests/workers/test_researcher.py` | 研究员单元测试 |
| `agent-service/tests/orchestrator/test_parse_assets.py` | parse_assets 工具测试 |
| `agent-service/tests/orchestrator/test_create_brief.py` | create_brief 工具测试 |
| `agent-service/tests/orchestrator/test_create_blueprint.py` | create_blueprint 工具测试 |
| `agent-service/tests/orchestrator/test_e2e_level2.py` | 2级端到端集成测试 |

### 新文件（前端）

| 文件 | 用途 |
|------|---------|
| `apps/client/src/ee/ai/components/ai-creator/smart-brief/SmartBriefCard.tsx` | 智能简报侧边栏卡 |
| `apps/client/src/ee/ai/components/ai-creator/smart-brief/index.ts` | 智能短筒出口 |
| `apps/client/src/ee/ai/components/ai-creator/blueprint/BlueprintModal.tsx` | 蓝图弹出模式 |
| `apps/client/src/ee/ai/components/ai-creator/blueprint/SectionCard.tsx` | 可拖动的分区卡 |
| `apps/client/src/ee/ai/components/ai-creator/blueprint/use-blueprint-editor.ts` | 蓝图状态管理挂钩 |
| `apps/client/src/ee/ai/components/ai-creator/blueprint/index.ts` | 蓝图桶出口 |

### 修改文件

| 文件 | 变更 |
|------|--------|
| `agent-service/app/orchestrator/engine.py` | 注册第二阶段工具，更新系统提示 |
| `agent-service/app/orchestrator/prompts.py` | 添加 2 级协调器指令 |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-chat.tsx` | 在事件上渲染 SmartBriefCard 和 BlueprintModal |

---

## 分块 1：AssetParser Worker：文档解析

### 任务 1：AssetParser Worker — document parsing

AssetParser 封装了现有的 `docling_parser` 工具，用于从上传的文档中提取结构化资产。每个提取的元素（文本段、标题、表格、代码块）都成为 `AssetMap` 中的 `AssetItem`。

**文件：**
- 创建：`agent-service/app/workers/__init__.py`
- 创建：`agent-service/app/workers/asset_parser.py`
- 测试： `agent-service/tests/workers/__init__.py`
- 测试： `agent-service/tests/workers/test_asset_parser.py`

**上下文：** 现有的 `docling_parser` 工具 (`app/tools/docling_parser.py`) 采用 `(file_content_b64, filename, mimetype)` 并返回带有 `{"text": "...", "images": [...], "image_count": N}` 的 JSON。 `text` 字段包含带有标题的 markdown。 `AssetItem` 模型（来自 `app/models/asset_map.py`）具有类型：`text`、`image`、`table`、`code`、`mermaid`、`heading_structure`。 `count_words` 实用程序位于 `app/utils/word_count.py`。

- [ ] **第 1 步：为 AssetParser 文档解析编写失败测试**

```python
# agent-service/tests/workers/__init__.py
```

```python
# agent-service/tests/workers/test_asset_parser.py
import json
import pytest
from unittest.mock import patch, MagicMock

from app.models.asset_map import AssetItem, AssetMap


class TestParseDocument:
    """Test document parsing into AssetMap."""

    def test_simple_markdown_extraction(self):
        """Parse a simple markdown document into text and heading assets."""
        from app.workers.asset_parser import parse_document

        # Simulate docling output: markdown with headings
        docling_result = json.dumps({
            "text": "[Document: test.md]\n\n# Title\n\nIntro paragraph.\n\n## Section 1\n\nContent of section 1.\n\n## Section 2\n\nContent of section 2.",
            "images": [],
            "image_count": 0,
        })

        with patch("app.workers.asset_parser.docling_parser") as mock_docling:
            mock_docling.invoke.return_value = docling_result
            asset_map = parse_document(
                file_content_b64="dGVzdA==",
                filename="test.md",
                mimetype="text/markdown",
            )

        assert isinstance(asset_map, AssetMap)
        # Should have heading_structure asset
        heading_assets = [a for a in asset_map.items if a.type == "heading_structure"]
        assert len(heading_assets) >= 1
        # Should have text assets for each section
        text_assets = [a for a in asset_map.items if a.type == "text"]
        assert len(text_assets) >= 2
        # Source word count should be populated
        assert asset_map.source_word_count > 0

    def test_table_extraction(self):
        """Tables in markdown should become table AssetItems."""
        from app.workers.asset_parser import parse_document

        docling_result = json.dumps({
            "text": "[Document: data.md]\n\n# Report\n\n| Name | Value |\n|------|-------|\n| A | 1 |\n| B | 2 |\n\nSome text after table.",
            "images": [],
            "image_count": 0,
        })

        with patch("app.workers.asset_parser.docling_parser") as mock_docling:
            mock_docling.invoke.return_value = docling_result
            asset_map = parse_document(
                file_content_b64="dGVzdA==",
                filename="data.md",
                mimetype="text/markdown",
            )

        table_assets = [a for a in asset_map.items if a.type == "table"]
        assert len(table_assets) >= 1
        assert "|" in table_assets[0].content

    def test_code_block_extraction(self):
        """Fenced code blocks should become code AssetItems."""
        from app.workers.asset_parser import parse_document

        docling_result = json.dumps({
            "text": "[Document: readme.md]\n\n# Setup\n\n```python\nprint('hello')\n```\n\nRun the above.",
            "images": [],
            "image_count": 0,
        })

        with patch("app.workers.asset_parser.docling_parser") as mock_docling:
            mock_docling.invoke.return_value = docling_result
            asset_map = parse_document(
                file_content_b64="dGVzdA==",
                filename="readme.md",
                mimetype="text/markdown",
            )

        code_assets = [a for a in asset_map.items if a.type == "code"]
        assert len(code_assets) >= 1
        assert "print" in code_assets[0].content

    def test_heading_structure_extraction(self):
        """Should extract heading hierarchy into source_structure."""
        from app.workers.asset_parser import parse_document

        docling_result = json.dumps({
            "text": "[Document: doc.md]\n\n# Title\n\n## Chapter 1\n\n### Section 1.1\n\n## Chapter 2\n\nContent.",
            "images": [],
            "image_count": 0,
        })

        with patch("app.workers.asset_parser.docling_parser") as mock_docling:
            mock_docling.invoke.return_value = docling_result
            asset_map = parse_document(
                file_content_b64="dGVzdA==",
                filename="doc.md",
                mimetype="text/markdown",
            )

        assert len(asset_map.source_structure) >= 4
        assert asset_map.source_structure[0] == {"level": 1, "title": "Title"}
        assert asset_map.source_section_counts.get("h1", 0) >= 1
        assert asset_map.source_section_counts.get("h2", 0) >= 2

    def test_section_word_counts(self):
        """Each text asset should have word count in its summary."""
        from app.workers.asset_parser import parse_document

        docling_result = json.dumps({
            "text": "[Document: doc.md]\n\n# Title\n\n这是一段包含十个中文字符的文本内容。\n\n## Section\n\n另一段内容。",
            "images": [],
            "image_count": 0,
        })

        with patch("app.workers.asset_parser.docling_parser") as mock_docling:
            mock_docling.invoke.return_value = docling_result
            asset_map = parse_document(
                file_content_b64="dGVzdA==",
                filename="doc.md",
                mimetype="text/markdown",
            )

        text_assets = [a for a in asset_map.items if a.type == "text"]
        # Each text asset summary should mention word count
        for asset in text_assets:
            assert "word" in asset.summary.lower() or "字" in asset.summary
```

- [ ] **第 2 步：运行测试以验证它们是否失败**

```bash
cd /e/test/Docmost/agent-service && python -m pytest tests/workers/test_asset_parser.py -v
```

预期：失败 — `ModuleNotFoundError: No module named 'app.workers'`

- [ ] **第 3 步：实现AssetParser文档解析**

```python
# agent-service/app/workers/__init__.py
"""Workers — specialized processing units called by the Orchestrator."""
```

```python
# agent-service/app/workers/asset_parser.py
"""AssetParser Worker — deep asset extraction from uploaded documents.

Uses Docling for document parsing and extracts structured assets:
text segments, heading structures, tables, code blocks, and images.
Each element becomes an AssetItem in an AssetMap.
"""
from __future__ import annotations

import json
import re
import uuid
from typing import TYPE_CHECKING

from app.models.asset_map import AssetItem, AssetMap
from app.tools.docling_parser import docling_parser
from app.utils.word_count import count_words

if TYPE_CHECKING:
    pass


def _generate_asset_id(prefix: str = "asset") -> str:
    """Generate a unique asset ID."""
    return f"{prefix}-{uuid.uuid4().hex[:8]}"


def _extract_headings(markdown: str) -> tuple[list[dict], dict[str, int]]:
    """Extract heading structure and counts from markdown.

    Returns:
        (source_structure, source_section_counts)
    """
    structure = []
    counts: dict[str, int] = {}
    for line in markdown.split("\n"):
        match = re.match(r"^(#{1,6})\s+(.+)$", line.strip())
        if match:
            level = len(match.group(1))
            title = match.group(2).strip()
            structure.append({"level": level, "title": title})
            key = f"h{level}"
            counts[key] = counts.get(key, 0) + 1
    return structure, counts


def _split_sections(markdown: str) -> list[dict]:
    """Split markdown into sections by headings.

    Returns list of {"heading": str | None, "level": int, "content": str}.
    """
    sections = []
    current_heading = None
    current_level = 0
    current_lines: list[str] = []

    for line in markdown.split("\n"):
        match = re.match(r"^(#{1,6})\s+(.+)$", line.strip())
        if match:
            # Save previous section
            if current_lines:
                sections.append({
                    "heading": current_heading,
                    "level": current_level,
                    "content": "\n".join(current_lines).strip(),
                })
            current_heading = match.group(2).strip()
            current_level = len(match.group(1))
            current_lines = []
        else:
            current_lines.append(line)

    # Save last section
    if current_lines:
        sections.append({
            "heading": current_heading,
            "level": current_level,
            "content": "\n".join(current_lines).strip(),
        })

    return sections


def _extract_tables(text: str) -> list[str]:
    """Extract markdown tables from text."""
    tables = []
    lines = text.split("\n")
    table_lines: list[str] = []
    in_table = False

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("|") and "|" in stripped[1:]:
            in_table = True
            table_lines.append(stripped)
        elif in_table:
            if table_lines:
                tables.append("\n".join(table_lines))
            table_lines = []
            in_table = False

    if table_lines:
        tables.append("\n".join(table_lines))

    return tables


def _extract_code_blocks(text: str) -> list[dict]:
    """Extract fenced code blocks from text.

    Returns list of {"lang": str, "content": str}.
    """
    blocks = []
    pattern = re.compile(r"```(\w*)\n(.*?)```", re.DOTALL)
    for match in pattern.finditer(text):
        blocks.append({
            "lang": match.group(1) or "text",
            "content": match.group(2).strip(),
        })
    return blocks


def parse_document(
    file_content_b64: str,
    filename: str,
    mimetype: str,
) -> AssetMap:
    """Parse a document into an AssetMap using Docling.

    Args:
        file_content_b64: Base64-encoded file content
        filename: Original filename
        mimetype: MIME type of the file

    Returns:
        AssetMap with extracted assets, structure, and word counts
    """
    # Call existing docling_parser tool
    raw_result = docling_parser.invoke({
        "file_content_b64": file_content_b64,
        "filename": filename,
        "mimetype": mimetype,
    })
    parsed = json.loads(raw_result)

    full_text = parsed.get("text", "")
    raw_images = parsed.get("images", [])

    # Remove the "[Document: ...]" prefix if present
    text_body = re.sub(r"^\[Document:[^\]]*\]\s*", "", full_text).strip()

    items: list[AssetItem] = []

    # 1. Extract heading structure
    structure, section_counts = _extract_headings(text_body)
    if structure:
        items.append(AssetItem(
            id=_generate_asset_id("heading"),
            type="heading_structure",
            source=filename,
            content="\n".join(
                f"{'#' * h['level']} {h['title']}" for h in structure
            ),
            summary=f"Document structure: {len(structure)} headings",
        ))

    # 2. Extract code blocks (before splitting sections, so we can remove them)
    code_blocks = _extract_code_blocks(text_body)
    for cb in code_blocks:
        items.append(AssetItem(
            id=_generate_asset_id("code"),
            type="code",
            source=filename,
            content=cb["content"],
            summary=f"Code block ({cb['lang']})",
        ))

    # 3. Extract tables
    tables = _extract_tables(text_body)
    for i, table in enumerate(tables):
        items.append(AssetItem(
            id=_generate_asset_id("table"),
            type="table",
            source=filename,
            content=table,
            summary=f"Table {i + 1} from {filename}",
        ))

    # 4. Split into text sections
    sections = _split_sections(text_body)
    total_words = 0
    for section in sections:
        content = section["content"]
        if not content.strip():
            continue
        # Remove code blocks and tables from text content for word counting
        clean = re.sub(r"```\w*\n.*?```", "", content, flags=re.DOTALL)
        clean = re.sub(r"\|[^\n]+\|(\n\|[^\n]+\|)*", "", clean)
        clean = clean.strip()
        if not clean:
            continue

        wc = count_words(clean)
        total_words += wc

        heading = section["heading"] or "Preamble"
        items.append(AssetItem(
            id=_generate_asset_id("text"),
            type="text",
            source=filename,
            content=content,
            summary=f"Section '{heading}': {wc} words",
        ))

    # 5. Store raw image data for later processing (任务 2)
    # Images are NOT processed here — see process_images()

    return AssetMap(
        items=items,
        source_structure=structure,
        source_word_count=total_words,
        source_section_counts=section_counts,
    )
```

- [ ] **第 4 步：运行测试以验证其通过**

```bash
cd /e/test/Docmost/agent-service && python -m pytest tests/workers/test_asset_parser.py -v
```

预期：全部 5 项通过

- [ ] **第 5 步：提交**

```bash
git add agent-service/app/workers/__init__.py agent-service/app/workers/asset_parser.py agent-service/tests/workers/__init__.py agent-service/tests/workers/test_asset_parser.py
git commit -m "feat(worker): add AssetParser document parsing with heading/table/code extraction"
```

---

## 分块 2：AssetParser Worker：图像处理

### 任务 2：AssetParser Worker — image processing

扩展 AssetParser 以处理由 Docling 提取的图像：将每个图像上传到 Docmost，通过 VLM 分类，并创建 `AssetItem(type="image")` 条目。

**文件：**
- 修改：`agent-service/app/workers/asset_parser.py`
- 测试：`agent-service/tests/workers/test_asset_parser.py`（附加）

**上下文：** 现有的 `vlm_understand` 工具 (`app/tools/vlm_understand.py`) 采用 `(image_b64, question)` 并返回文本描述。现有的 `docmost_upload` 工具 (`app/tools/docmost_api.py`) 采用 `(file_content_b64, filename, page_id)` 并返回 URL 字符串。

- [ ] **第 1 步：编写图像处理失败的测试**

附加到`agent-service/tests/workers/test_asset_parser.py`：

```python
class TestProcessImages:
    """Test image extraction, classification, and upload."""

    def test_images_uploaded_and_classified(self):
        """Each extracted image should be uploaded and VLM-classified."""
        from app.workers.asset_parser import process_images

        raw_images = [
            {"index": 0, "b64": "iVBORw0KGgoAAAANS...", "desc": "Architecture diagram"},
            {"index": 1, "b64": "iVBORw0KGgoAAAANS...", "desc": "Screenshot"},
        ]

        with patch("app.workers.asset_parser.docmost_upload") as mock_upload, \
             patch("app.workers.asset_parser.vlm_understand") as mock_vlm:
            mock_upload.invoke.return_value = "https://docmost.example.com/img/123.png"
            mock_vlm.invoke.return_value = "This is a system architecture diagram showing three microservices connected via REST APIs."

            image_assets = process_images(
                raw_images=raw_images,
                filename="report.pdf",
                page_id="page-001",
            )

        assert len(image_assets) == 2
        assert all(a.type == "image" for a in image_assets)
        # Each image should have a URL in content
        assert "https://" in image_assets[0].content
        # Each image should have VLM summary
        assert image_assets[0].summary != ""

    def test_image_classification(self):
        """VLM output should be parsed to classify image type."""
        from app.workers.asset_parser import classify_image

        assert classify_image("This is a screenshot of a web application") == "screenshot"
        assert classify_image("Architecture diagram showing microservices") == "diagram"
        assert classify_image("A photograph of the team") == "photo"
        assert classify_image("Bar chart showing quarterly revenue") == "chart"
        assert classify_image("Hand-drawn illustration of the concept") == "illustration"
        assert classify_image("Some random content") == "other"

    def test_empty_images(self):
        """No images should return empty list."""
        from app.workers.asset_parser import process_images

        result = process_images(
            raw_images=[],
            filename="doc.md",
            page_id="page-001",
        )
        assert result == []

    def test_vlm_failure_graceful(self):
        """If VLM fails, image should still be created with fallback summary."""
        from app.workers.asset_parser import process_images

        raw_images = [{"index": 0, "b64": "abc123", "desc": "Figure 1"}]

        with patch("app.workers.asset_parser.docmost_upload") as mock_upload, \
             patch("app.workers.asset_parser.vlm_understand") as mock_vlm:
            mock_upload.invoke.return_value = "https://docmost.example.com/img/456.png"
            mock_vlm.invoke.side_effect = Exception("VLM service unavailable")

            image_assets = process_images(
                raw_images=raw_images,
                filename="report.pdf",
                page_id="page-001",
            )

        assert len(image_assets) == 1
        # Should use the desc from Docling as fallback
        assert "Figure 1" in image_assets[0].summary
```

- [ ] **第 2 步：运行测试以验证它们是否失败**

```bash
cd /e/test/Docmost/agent-service && python -m pytest tests/workers/test_asset_parser.py::TestProcessImages -v
```

预期：失败 — `ImportError: cannot import name 'process_images'`

- [ ] **第 3 步：实现图像处理功能**

Add to `agent-service/app/workers/asset_parser.py`:

```python
from app.tools.docmost_api import docmost_upload
from app.tools.vlm_understand import vlm_understand

# Image classification keywords
_IMAGE_CLASSIFIERS = {
    "screenshot": ["screenshot", "screen capture", "ui", "interface", "window"],
    "diagram": ["diagram", "architecture", "flowchart", "uml", "schematic"],
    "photo": ["photo", "photograph", "picture of"],
    "chart": ["chart", "graph", "bar", "pie", "line chart", "histogram", "revenue", "data viz"],
    "illustration": ["illustration", "drawing", "sketch", "hand-drawn", "artwork"],
}


def classify_image(vlm_description: str) -> str:
    """Classify image type based on VLM description.

    Returns one of: screenshot, diagram, photo, chart, illustration, other.
    """
    desc_lower = vlm_description.lower()
    for category, keywords in _IMAGE_CLASSIFIERS.items():
        if any(kw in desc_lower for kw in keywords):
            return category
    return "other"


def process_images(
    raw_images: list[dict],
    filename: str,
    page_id: str,
) -> list[AssetItem]:
    """Process extracted images: upload to Docmost, classify via VLM.

    Args:
        raw_images: List of {"index": int, "b64": str, "desc": str} from docling_parser
        filename: Source filename for provenance
        page_id: Docmost page ID for image upload

    Returns:
        List of AssetItem(type="image") with URLs and classifications
    """
    if not raw_images:
        return []

    image_assets: list[AssetItem] = []

    for img in raw_images:
        b64_data = img.get("b64", "")
        fallback_desc = img.get("desc", f"Image {img.get('index', 0) + 1}")

        # Upload to Docmost
        img_filename = f"{filename}_img_{img.get('index', 0)}.png"
        url = docmost_upload.invoke({
            "file_content_b64": b64_data,
            "filename": img_filename,
            "page_id": page_id,
        })

        # Classify via VLM
        vlm_summary = fallback_desc
        classification = "other"
        try:
            vlm_result = vlm_understand.invoke({
                "image_b64": b64_data,
                "question": "Describe this image in detail. What type of image is it (screenshot, diagram, photo, chart, illustration)?",
            })
            vlm_summary = vlm_result
            classification = classify_image(vlm_result)
        except Exception:
            vlm_summary = fallback_desc

        image_assets.append(AssetItem(
            id=_generate_asset_id("img"),
            type="image",
            source=filename,
            content=f"![{fallback_desc}]({url})",
            summary=f"{vlm_summary} [type: {classification}]",
            suggested_usage=f"Reuse as {classification} in relevant section",
        ))

    return image_assets
```

- [ ] **第 4 步：运行测试以验证其通过**

```bash
cd /e/test/Docmost/agent-service && python -m pytest tests/workers/test_asset_parser.py -v
```

预期：全部 9 项通过（任务 1 中的 5 项 + 4 项新任务）

- [ ] **第 5 步：提交**

```bash
git add agent-service/app/workers/asset_parser.py agent-service/tests/workers/test_asset_parser.py
git commit -m "feat(worker): add AssetParser image processing with VLM classification and upload"
```

---

## 分块 3：parse_assets 编排器工具

### 任务 3：Register parse_assets as Orchestrator tool

将 AssetParser Worker 包装为可由 Orchestrator 调用的 PydanticAI 工具。

**文件：**
- 创建：`agent-service/app/orchestrator/tools/parse_assets.py`
- 测试： `agent-service/tests/orchestrator/test_parse_assets.py`

**上下文：** PydanticAI 工具是用 Orchestrator 代理的 `@agent.tool` 装饰器装饰的普通函数，或者通过工具列表注册。协调器引擎 (`app/orchestrator/engine.py`) 将工具传递给 PydanticAI 代理。每个工具接收 `RunContext` 作为第一个参数并返回 LLM 看到的结果。

- [ ] **第 1 步：为 parse_assets 工具编写失败测试**

```python
# agent-service/tests/orchestrator/test_parse_assets.py
import json
import pytest
from unittest.mock import patch, MagicMock, AsyncMock

from app.models.asset_map import AssetMap


class TestParseAssetsTool:
    """Test the parse_assets orchestrator tool."""

    @pytest.mark.asyncio
    async def test_single_file_parsing(self):
        """parse_assets should call AssetParser and return serialized AssetMap."""
        from app.orchestrator.tools.parse_assets import parse_assets_impl

        mock_asset_map = AssetMap(
            items=[],
            source_word_count=100,
            source_structure=[{"level": 1, "title": "Test"}],
        )

        with patch("app.orchestrator.tools.parse_assets.parse_document", return_value=mock_asset_map):
            result = await parse_assets_impl(
                files=[{
                    "content_b64": "dGVzdA==",
                    "filename": "test.pdf",
                    "mimetype": "application/pdf",
                }],
                page_id="page-001",
            )

        assert "source_word_count" in result
        parsed = json.loads(result)
        assert parsed["source_word_count"] == 100

    @pytest.mark.asyncio
    async def test_multiple_files_merged(self):
        """Multiple files should produce a merged AssetMap."""
        from app.orchestrator.tools.parse_assets import parse_assets_impl

        map1 = AssetMap(items=[], source_word_count=500)
        map2 = AssetMap(items=[], source_word_count=300)

        with patch("app.orchestrator.tools.parse_assets.parse_document", side_effect=[map1, map2]):
            result = await parse_assets_impl(
                files=[
                    {"content_b64": "YQ==", "filename": "a.pdf", "mimetype": "application/pdf"},
                    {"content_b64": "Yg==", "filename": "b.pdf", "mimetype": "application/pdf"},
                ],
                page_id="page-001",
            )

        parsed = json.loads(result)
        assert parsed["source_word_count"] == 800

    @pytest.mark.asyncio
    async def test_empty_files_list(self):
        """Empty files list should return empty AssetMap."""
        from app.orchestrator.tools.parse_assets import parse_assets_impl

        result = await parse_assets_impl(files=[], page_id="page-001")
        parsed = json.loads(result)
        assert parsed["source_word_count"] == 0
        assert parsed["items"] == []
```

- [ ] **第 2 步：运行测试以验证它们是否失败**

```bash
cd /e/test/Docmost/agent-service && python -m pytest tests/orchestrator/test_parse_assets.py -v
```

预期：失败 — `ModuleNotFoundError: No module named 'app.orchestrator.tools.parse_assets'`

- [ ] **第 3 步：实现parse_assets工具**

```python
# agent-service/app/orchestrator/tools/parse_assets.py
"""parse_assets — Orchestrator tool for document asset extraction.

Wraps the AssetParser Worker. Called by the Orchestrator when files
are uploaded and need to be parsed into structured assets.
"""
from __future__ import annotations

import json
import logging

from app.models.asset_map import AssetMap
from app.workers.asset_parser import parse_document, process_images

logger = logging.getLogger(__name__)


async def parse_assets_impl(
    files: list[dict],
    page_id: str,
) -> str:
    """Parse uploaded files into a structured AssetMap.

    Args:
        files: List of {"content_b64": str, "filename": str, "mimetype": str}
        page_id: Docmost page ID (for image uploads)

    Returns:
        JSON-serialized AssetMap
    """
    if not files:
        return AssetMap().model_dump_json()

    merged_items = []
    total_word_count = 0
    merged_structure = []
    merged_section_counts: dict[str, int] = {}

    for file_info in files:
        try:
            asset_map = parse_document(
                file_content_b64=file_info["content_b64"],
                filename=file_info["filename"],
                mimetype=file_info["mimetype"],
            )

            merged_items.extend(asset_map.items)
            total_word_count += asset_map.source_word_count
            merged_structure.extend(asset_map.source_structure)

            for key, val in asset_map.source_section_counts.items():
                merged_section_counts[key] = merged_section_counts.get(key, 0) + val

        except Exception as e:
            logger.error(f"Failed to parse {file_info.get('filename', '?')}: {e}")
            continue

    result = AssetMap(
        items=merged_items,
        source_word_count=total_word_count,
        source_structure=merged_structure,
        source_section_counts=merged_section_counts,
    )

    return result.model_dump_json()
```

- [ ] **第 4 步：运行测试以验证其通过**

```bash
cd /e/test/Docmost/agent-service && python -m pytest tests/orchestrator/test_parse_assets.py -v
```

预期：全部 3 项通过

- [ ] **第 5 步：提交**

```bash
git add agent-service/app/orchestrator/tools/parse_assets.py agent-service/tests/orchestrator/test_parse_assets.py
git commit -m "feat(orchestrator): add parse_assets tool wrapping AssetParser Worker"
```

---

## 分块 4：Smart Brief 生成

### 任务 4：Smart Brief generation tool

LLM 分析用户提示 + AssetMap，生成具有 AI 推荐默认值的 `CreationBrief`，然后通过 `ask_user` 将其呈现给用户。

**文件：**
- 创建：`agent-service/app/orchestrator/tools/create_brief.py`
- 测试： `agent-service/tests/orchestrator/test_create_brief.py`

**上下文：** `CreationBrief` 模型（来自 `app/models/brief.py`）具有字段：`audience`、`goal`、`target_length`、`length_tolerance`、`style`、`tone`、`structure_strategy`、`image_strategy`、`constraints`。 `ask_user` 工具（从第 1 阶段开始，`app/orchestrator/tools/user_interaction.py`）中断代理循环并向前端发送 SSE 事件，然后通过 `/v2/agent/resume` 端点等待用户响应。

- [ ] **第 1 步：为 create_brief 编写失败测试**

```python
# agent-service/tests/orchestrator/test_create_brief.py
import json
import pytest
from unittest.mock import patch, MagicMock, AsyncMock

from app.models.brief import CreationBrief
from app.models.asset_map import AssetMap


class TestCreateBrief:
    """Test Smart Brief generation."""

    @pytest.mark.asyncio
    async def test_brief_from_simple_prompt(self):
        """Simple prompt without assets should produce a valid brief."""
        from app.orchestrator.tools.create_brief import generate_brief

        # Mock LLM to return a valid brief
        mock_brief = CreationBrief(
            audience="general",
            goal="Write a blog post about AI",
            target_length=2000,
            style="conversational",
            tone="friendly",
            structure_strategy="ai_recommend",
            image_strategy="none",
        )

        with patch("app.orchestrator.tools.create_brief._llm_generate_brief", new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = mock_brief
            result = await generate_brief(
                user_message="写一篇关于 AI 的博客文章",
                asset_map=None,
            )

        assert isinstance(result, CreationBrief)
        assert result.target_length > 0
        assert result.audience != ""

    @pytest.mark.asyncio
    async def test_brief_with_assets_adjusts_strategy(self):
        """Brief with source assets should recommend copy_source structure."""
        from app.orchestrator.tools.create_brief import generate_brief

        asset_map = AssetMap(
            items=[],
            source_word_count=5000,
            source_structure=[
                {"level": 1, "title": "Title"},
                {"level": 2, "title": "Section 1"},
                {"level": 2, "title": "Section 2"},
            ],
        )

        mock_brief = CreationBrief(
            audience="developers",
            goal="Reformat the document",
            target_length=5000,
            style="technical",
            tone="professional",
            structure_strategy="copy_source",
            image_strategy="reuse_source",
        )

        with patch("app.orchestrator.tools.create_brief._llm_generate_brief", new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = mock_brief
            result = await generate_brief(
                user_message="优化排版",
                asset_map=asset_map,
            )

        assert result.structure_strategy == "copy_source"

    @pytest.mark.asyncio
    async def test_brief_target_length_scales_with_source(self):
        """When source material exists, target_length should be proportional."""
        from app.orchestrator.tools.create_brief import estimate_target_length

        # No source: use defaults
        assert estimate_target_length(None, "写一篇博客") >= 1000

        # With source: scale based on source word count
        asset_map = AssetMap(source_word_count=3000)
        length = estimate_target_length(asset_map, "优化排版")
        assert 2000 <= length <= 5000

    def test_brief_serialization_for_sse(self):
        """Brief should serialize to JSON for SSE event payload."""
        brief = CreationBrief(
            audience="managers",
            goal="Executive summary",
            target_length=800,
            style="formal",
            tone="authoritative",
            structure_strategy="ai_recommend",
            image_strategy="none",
        )
        payload = json.loads(brief.model_dump_json())
        assert "audience" in payload
        assert "target_length" in payload
        assert payload["target_length"] == 800
```

- [ ] **第 2 步：运行测试以验证它们是否失败**

```bash
cd /e/test/Docmost/agent-service && python -m pytest tests/orchestrator/test_create_brief.py -v
```

预期：失败 — `ModuleNotFoundError: No module named 'app.orchestrator.tools.create_brief'`

- [ ] **第 3 步：实施 create_brief 工具**

```python
# agent-service/app/orchestrator/tools/create_brief.py
"""create_brief — Orchestrator tool for Smart Brief generation.

Analyzes user prompt + AssetMap to generate a CreationBrief with
AI-recommended defaults. The brief is then presented to the user
for confirmation/editing via ask_user.
"""
from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING

from pydantic_ai import Agent

from app.models.asset_map import AssetMap
from app.models.brief import CreationBrief
from app.orchestrator.llm_factory import create_pydantic_ai_model

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

# Brief generation prompt
_BRIEF_PROMPT = """\
You are generating a CreationBrief for a document creation task.

User's request: {user_message}

{asset_context}

Based on the user's request and available source materials, generate a CreationBrief with:
- audience: Who will read this (e.g., developers, managers, general public)
- goal: What the content should achieve (1 sentence)
- target_length: Target word count (consider source length if available)
- style: Writing style (technical, conversational, formal, academic, etc.)
- tone: Tone of voice (professional, friendly, authoritative, etc.)
- structure_strategy: "copy_source" if reformatting existing content, "ai_recommend" if creating new, "user_defined" if user specified an outline
- image_strategy: "reuse_source" if source has images, "generate_new" for new content, "mixed" for combination, "none" if text-only
- constraints: Any specific requirements from the user's prompt (as a list)

Respond with valid JSON matching the CreationBrief schema.
"""


def estimate_target_length(asset_map: AssetMap | None, user_message: str) -> int:
    """Estimate a reasonable target word count.

    Rules:
    - No source material: 1500-3000 based on prompt complexity
    - With source: roughly match source length (±20%)
    - User explicitly mentions length: respect that
    """
    import re

    # Check for explicit length in user message
    length_match = re.search(r"(\d{3,5})\s*[字词words]", user_message)
    if length_match:
        return int(length_match.group(1))

    if asset_map and asset_map.source_word_count > 0:
        # Scale with source, slightly shorter for summaries, same for reformats
        return max(500, asset_map.source_word_count)

    # Default: estimate based on prompt
    if any(kw in user_message for kw in ["短", "简", "brief", "short", "summary"]):
        return 1000
    if any(kw in user_message for kw in ["详细", "完整", "comprehensive", "detailed"]):
        return 3000

    return 1500


async def _llm_generate_brief(
    user_message: str,
    asset_map: AssetMap | None,
) -> CreationBrief:
    """Use LLM to generate a CreationBrief from user prompt and assets."""
    model = create_pydantic_ai_model()

    asset_context = ""
    if asset_map and asset_map.source_word_count > 0:
        asset_context = (
            f"Source material available:\n"
            f"- Word count: {asset_map.source_word_count}\n"
            f"- Sections: {len(asset_map.source_structure)}\n"
            f"- Assets: {len(asset_map.items)} items\n"
            f"- Structure: {json.dumps(asset_map.source_structure[:10], ensure_ascii=False)}"
        )
    else:
        asset_context = "No source material provided. Creating from scratch."

    prompt = _BRIEF_PROMPT.format(
        user_message=user_message,
        asset_context=asset_context,
    )

    agent = Agent(
        model,
        result_type=CreationBrief,
        system_prompt="You are a content planning assistant. Return a valid CreationBrief JSON.",
    )

    result = await agent.run(prompt)
    return result.data


async def generate_brief(
    user_message: str,
    asset_map: AssetMap | None,
) -> CreationBrief:
    """Generate a Smart Brief with AI-recommended defaults.

    Args:
        user_message: User's original request
        asset_map: Parsed assets from uploaded files (None if no files)

    Returns:
        CreationBrief with recommended values
    """
    brief = await _llm_generate_brief(user_message, asset_map)

    # Override target_length with our estimation if LLM gave unreasonable value
    estimated = estimate_target_length(asset_map, user_message)
    if brief.target_length < 100 or brief.target_length > 50000:
        brief = brief.model_copy(update={"target_length": estimated})

    return brief
```

- [ ] **第 4 步：运行测试以验证其通过**

```bash
cd /e/test/Docmost/agent-service && python -m pytest tests/orchestrator/test_create_brief.py -v
```

预期：全部 4 项通过

- [ ] **第 5 步：提交**

```bash
git add agent-service/app/orchestrator/tools/create_brief.py agent-service/tests/orchestrator/test_create_brief.py
git commit -m "feat(orchestrator): add Smart Brief generation tool with LLM analysis"
```

---

## 分块 5：SmartBriefCard 前端

### 任务 5：Smart Brief 前端 — SmartBriefCard component

当收到 `brief_ready` SSE 事件时，在 AI Creator 侧栏中呈现的 Mantine 卡。显示 AI 推荐的默认值并让用户确认或修改。

**文件：**
- 创建：`apps/client/src/ee/ai/components/ai-creator/smart-brief/SmartBriefCard.tsx`
- 创建：`apps/client/src/ee/ai/components/ai-creator/smart-brief/index.ts`

**上下文：** AI Creator 聊天流程在 `ai-creator-chat.tsx` 中呈现消息。带有 `phase: "brief"` 的 SSE 事件应触发 SmartBriefCard。前端通过 `/v2/agent/resume` 端点发回用户响应。 Mantine v8 组件：`Card`、`Select`、`NumberInput`、`Button`、`Group`、`Stack`、`Text`、`Badge`。

- [ ] **第 1 步：创建 SmartBriefCard 组件**

```tsx
// apps/client/src/ee/ai/components/ai-creator/smart-brief/SmartBriefCard.tsx
import { useState, useCallback } from "react";
import {
  Card,
  Select,
  NumberInput,
  Button,
  Group,
  Stack,
  Text,
  Badge,
  Divider,
} from "@mantine/core";
import { useTranslation } from "react-i18next";

export interface SmartBriefData {
  audience: string;
  goal: string;
  target_length: number;
  length_tolerance: number;
  style: string;
  tone: string;
  structure_strategy: "copy_source" | "ai_recommend" | "user_defined";
  image_strategy: "reuse_source" | "generate_new" | "mixed" | "none";
  constraints: string[];
}

interface AssetMapPreviewData {
  total_items: number;
  text_count: number;
  image_count: number;
  table_count: number;
  code_count: number;
  source_word_count: number;
}

interface SmartBriefCardProps {
  brief: SmartBriefData;
  assetPreview?: AssetMapPreviewData;
  onConfirm: (brief: SmartBriefData) => void;
  onModify: (brief: SmartBriefData) => void;
  disabled?: boolean;
}

const STYLE_OPTIONS = [
  { value: "technical", label: "技术" },
  { value: "conversational", label: "对话" },
  { value: "formal", label: "正式" },
  { value: "academic", label: "学术" },
  { value: "casual", label: "休闲" },
];

const TONE_OPTIONS = [
  { value: "professional", label: "专业" },
  { value: "friendly", label: "友好" },
  { value: "authoritative", label: "权威" },
  { value: "neutral", label: "中性" },
];

const STRUCTURE_OPTIONS = [
  { value: "copy_source", label: "复制源文档结构" },
  { value: "ai_recommend", label: "AI 推荐结构" },
  { value: "user_defined", label: "自定义结构" },
];

const IMAGE_OPTIONS = [
  { value: "reuse_source", label: "复用源图片" },
  { value: "generate_new", label: "生成新图片" },
  { value: "mixed", label: "混合" },
  { value: "none", label: "无图片" },
];

export function SmartBriefCard({
  brief,
  assetPreview,
  onConfirm,
  onModify,
  disabled = false,
}: SmartBriefCardProps) {
  const [editedBrief, setEditedBrief] = useState<SmartBriefData>(brief);
  const [isEditing, setIsEditing] = useState(false);

  const handleFieldChange = useCallback(
    <K extends keyof SmartBriefData>(field: K, value: SmartBriefData[K]) => {
      setEditedBrief((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const handleConfirm = useCallback(() => {
    onConfirm(editedBrief);
  }, [editedBrief, onConfirm]);

  const handleModify = useCallback(() => {
    if (isEditing) {
      onModify(editedBrief);
    } else {
      setIsEditing(true);
    }
  }, [isEditing, editedBrief, onModify]);

  return (
    <Card shadow="sm" padding="md" radius="md" withBorder>
      <Stack gap="sm">
        <Group justify="space-between">
          <Text fw={600} size="sm">
            Smart Brief
          </Text>
          <Badge color="blue" variant="light" size="sm">
            AI 推荐
          </Badge>
        </Group>

        <Text size="xs" c="dimmed">
          {editedBrief.goal}
        </Text>

        {assetPreview && (
          <>
            <Divider />
            <Group gap="xs">
              <Badge size="xs" variant="dot">
                {assetPreview.source_word_count} 字
              </Badge>
              {assetPreview.image_count > 0 && (
                <Badge size="xs" variant="dot" color="green">
                  {assetPreview.image_count} 图片
                </Badge>
              )}
              {assetPreview.table_count > 0 && (
                <Badge size="xs" variant="dot" color="orange">
                  {assetPreview.table_count} 表格
                </Badge>
              )}
              {assetPreview.code_count > 0 && (
                <Badge size="xs" variant="dot" color="grape">
                  {assetPreview.code_count} 代码块
                </Badge>
              )}
            </Group>
          </>
        )}

        <Divider />

        <Select
          label="受众"
          size="xs"
          value={editedBrief.audience}
          onChange={(v) => v && handleFieldChange("audience", v)}
          data={["general", "developers", "managers", "beginners", "experts"]}
          disabled={disabled || !isEditing}
          allowDeselect={false}
        />

        <Select
          label="写作风格"
          size="xs"
          value={editedBrief.style}
          onChange={(v) =>
            v && handleFieldChange("style", v)
          }
          data={STYLE_OPTIONS}
          disabled={disabled || !isEditing}
          allowDeselect={false}
        />

        <Select
          label="语气"
          size="xs"
          value={editedBrief.tone}
          onChange={(v) =>
            v && handleFieldChange("tone", v)
          }
          data={TONE_OPTIONS}
          disabled={disabled || !isEditing}
          allowDeselect={false}
        />

        <NumberInput
          label="目标字数"
          size="xs"
          value={editedBrief.target_length}
          onChange={(v) =>
            handleFieldChange("target_length", typeof v === "number" ? v : 1500)
          }
          min={100}
          max={50000}
          step={500}
          disabled={disabled || !isEditing}
        />

        <Select
          label="结构策略"
          size="xs"
          value={editedBrief.structure_strategy}
          onChange={(v) =>
            v &&
            handleFieldChange(
              "structure_strategy",
              v as SmartBriefData["structure_strategy"],
            )
          }
          data={STRUCTURE_OPTIONS}
          disabled={disabled || !isEditing}
          allowDeselect={false}
        />

        <Select
          label="图片策略"
          size="xs"
          value={editedBrief.image_strategy}
          onChange={(v) =>
            v &&
            handleFieldChange(
              "image_strategy",
              v as SmartBriefData["image_strategy"],
            )
          }
          data={IMAGE_OPTIONS}
          disabled={disabled || !isEditing}
          allowDeselect={false}
        />

        <Group justify="flex-end" mt="xs">
          <Button
            variant="subtle"
            size="xs"
            onClick={handleModify}
            disabled={disabled}
          >
            {isEditing ? "确认修改" : "修改详情"}
          </Button>
          <Button size="xs" onClick={handleConfirm} disabled={disabled}>
            确认开始
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
```

- [ ] **第 2 步：创建桶导出**

```tsx
// apps/client/src/ee/ai/components/ai-creator/smart-brief/index.ts
export { SmartBriefCard } from "./SmartBriefCard";
export type { SmartBriefData } from "./SmartBriefCard";
```

- [ ] **第 3 步：验证 TypeScript 是否编译**

```bash
cd /e/test/Docmost && npx tsc --noEmit --project apps/client/tsconfig.json 2>&1 | head -20
```

预期：没有与 SmartBriefCard 相关的错误

- [ ] **第 4 步：提交**

```bash
git add apps/client/src/ee/ai/components/ai-creator/smart-brief/
git commit -m "feat(ui): add SmartBriefCard component for AI Creator brief confirmation"
```

---

## 分块 6：Blueprint 生成

### 任务 6：Blueprint generation tool

LLM 从 Brief + AssetMap 生成 `CreationBlueprint`。每个部分都有标题、字数预算、要点和资源参考。文字预算总计为 `Brief.target_length` (±5%)。

**文件：**
- 创建：`agent-service/app/orchestrator/tools/create_blueprint.py`
- 测试： `agent-service/tests/orchestrator/test_create_blueprint.py`

**上下文：** `CreationBlueprint`（来自 `app/models/blueprint.py`）具有字段：`title`、`summary`、`sections`（`SectionPlan` 列表）、`total_target_words`。每个 `SectionPlan` 具有：`section_id`、`title`、`target_words`、`key_points`、`asset_ids`、`visuals`、`depends_on`。

- [ ] **第 1 步：为 create_blueprint 编写失败测试**

```python
# agent-service/tests/orchestrator/test_create_blueprint.py
import json
import pytest
from unittest.mock import patch, AsyncMock

from app.models.brief import CreationBrief
from app.models.asset_map import AssetMap, AssetItem
from app.models.blueprint import CreationBlueprint, SectionPlan


class TestCreateBlueprint:
    """Test Blueprint generation from Brief + AssetMap."""

    @pytest.mark.asyncio
    async def test_blueprint_from_brief(self):
        """Should generate a valid blueprint from a brief."""
        from app.orchestrator.tools.create_blueprint import generate_blueprint

        brief = CreationBrief(
            audience="developers",
            goal="Write API documentation",
            target_length=3000,
            style="technical",
            tone="professional",
            structure_strategy="ai_recommend",
            image_strategy="none",
        )

        mock_blueprint = CreationBlueprint(
            title="API Documentation",
            summary="Comprehensive API reference",
            sections=[
                SectionPlan(section_id="s1", title="Introduction", target_words=500, key_points=["Overview"]),
                SectionPlan(section_id="s2", title="Authentication", target_words=800, key_points=["Auth flow"]),
                SectionPlan(section_id="s3", title="Endpoints", target_words=1200, key_points=["REST API"]),
                SectionPlan(section_id="s4", title="Error Handling", target_words=500, key_points=["Error codes"]),
            ],
            total_target_words=3000,
        )

        with patch("app.orchestrator.tools.create_blueprint._llm_generate_blueprint", new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = mock_blueprint
            result = await generate_blueprint(brief=brief, asset_map=None)

        assert isinstance(result, CreationBlueprint)
        assert len(result.sections) >= 2
        # Word budgets should sum to ±5% of target
        total = sum(s.target_words for s in result.sections)
        assert abs(total - brief.target_length) / brief.target_length <= 0.05

    @pytest.mark.asyncio
    async def test_blueprint_copy_source_preserves_structure(self):
        """copy_source strategy should mirror source heading structure."""
        from app.orchestrator.tools.create_blueprint import generate_blueprint

        brief = CreationBrief(
            audience="general",
            goal="Reformat document",
            target_length=2000,
            style="formal",
            tone="neutral",
            structure_strategy="copy_source",
            image_strategy="reuse_source",
        )

        asset_map = AssetMap(
            items=[
                AssetItem(id="h1", type="heading_structure", source="doc.pdf",
                         content="# Title\n## Chapter 1\n## Chapter 2\n## Conclusion"),
            ],
            source_structure=[
                {"level": 1, "title": "Title"},
                {"level": 2, "title": "Chapter 1"},
                {"level": 2, "title": "Chapter 2"},
                {"level": 2, "title": "Conclusion"},
            ],
            source_word_count=2000,
        )

        mock_blueprint = CreationBlueprint(
            title="Title",
            sections=[
                SectionPlan(section_id="s1", title="Chapter 1", target_words=800, key_points=["Content"]),
                SectionPlan(section_id="s2", title="Chapter 2", target_words=800, key_points=["Content"]),
                SectionPlan(section_id="s3", title="Conclusion", target_words=400, key_points=["Summary"]),
            ],
            total_target_words=2000,
        )

        with patch("app.orchestrator.tools.create_blueprint._llm_generate_blueprint", new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = mock_blueprint
            result = await generate_blueprint(brief=brief, asset_map=asset_map)

        assert len(result.sections) >= 3

    @pytest.mark.asyncio
    async def test_blueprint_assigns_asset_ids(self):
        """Sections should reference relevant asset IDs."""
        from app.orchestrator.tools.create_blueprint import generate_blueprint

        brief = CreationBrief(
            audience="developers",
            goal="Technical guide",
            target_length=2000,
            style="technical",
            tone="professional",
            structure_strategy="ai_recommend",
            image_strategy="mixed",
        )

        asset_map = AssetMap(
            items=[
                AssetItem(id="code-1", type="code", source="example.py", content="print('hi')"),
                AssetItem(id="img-1", type="image", source="arch.png", content="![arch](url)"),
            ],
            source_word_count=500,
        )

        mock_blueprint = CreationBlueprint(
            title="Tech Guide",
            sections=[
                SectionPlan(section_id="s1", title="Overview", target_words=500, key_points=["Arch"], asset_ids=["img-1"]),
                SectionPlan(section_id="s2", title="Code", target_words=1500, key_points=["Example"], asset_ids=["code-1"]),
            ],
            total_target_words=2000,
        )

        with patch("app.orchestrator.tools.create_blueprint._llm_generate_blueprint", new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = mock_blueprint
            result = await generate_blueprint(brief=brief, asset_map=asset_map)

        all_asset_refs = []
        for s in result.sections:
            all_asset_refs.extend(s.asset_ids)
        # At least some assets should be referenced
        assert len(all_asset_refs) > 0

    def test_word_budget_normalization(self):
        """Word budgets should be normalized to sum to target_length."""
        from app.orchestrator.tools.create_blueprint import normalize_word_budgets

        sections = [
            SectionPlan(section_id="s1", title="A", target_words=300, key_points=["x"]),
            SectionPlan(section_id="s2", title="B", target_words=500, key_points=["y"]),
            SectionPlan(section_id="s3", title="C", target_words=200, key_points=["z"]),
        ]

        normalized = normalize_word_budgets(sections, target_total=2000)
        total = sum(s.target_words for s in normalized)
        assert abs(total - 2000) <= 10  # rounding tolerance
```

- [ ] **第 2 步：运行测试以验证它们是否失败**

```bash
cd /e/test/Docmost/agent-service && python -m pytest tests/orchestrator/test_create_blueprint.py -v
```

预期：失败 — `ModuleNotFoundError: No module named 'app.orchestrator.tools.create_blueprint'`

- [ ] **第 3 步：实现create_blueprint工具**

```python
# agent-service/app/orchestrator/tools/create_blueprint.py
"""create_blueprint — Orchestrator tool for Blueprint generation.

Generates a CreationBlueprint from Brief + AssetMap. Each section gets
a word budget, key points, and asset references. The blueprint is
presented to the user for approval via ask_user.
"""
from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING

from pydantic_ai import Agent

from app.models.asset_map import AssetMap
from app.models.brief import CreationBrief
from app.models.blueprint import CreationBlueprint, SectionPlan
from app.orchestrator.llm_factory import create_pydantic_ai_model

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)

_BLUEPRINT_PROMPT = """\
You are generating a CreationBlueprint for a document.

Brief:
- Audience: {audience}
- Goal: {goal}
- Target length: {target_length} words
- Style: {style}
- Tone: {tone}
- Structure strategy: {structure_strategy}
- Image strategy: {image_strategy}
- Constraints: {constraints}

{asset_context}

Generate a CreationBlueprint with:
1. A document title
2. A brief summary (1-2 sentences)
3. Ordered sections, each with:
   - section_id: "s1", "s2", etc.
   - title: Section heading
   - target_words: Word budget (all budgets must sum to ~{target_length})
   - key_points: What this section must cover (at least 1)
   - asset_ids: IDs of relevant assets to incorporate (from the asset list)
   - depends_on: section_ids that must be written first (for context)

{structure_instruction}

Important: section word budgets MUST sum to approximately {target_length} words (±5%).

Respond with valid JSON matching the CreationBlueprint schema.
"""


def normalize_word_budgets(
    sections: list[SectionPlan],
    target_total: int,
) -> list[SectionPlan]:
    """Normalize section word budgets to sum to target_total.

    Preserves relative proportions while adjusting absolute values.
    """
    if not sections:
        return sections

    current_total = sum(s.target_words for s in sections)
    if current_total == 0:
        # Equal distribution
        per_section = target_total // len(sections)
        remainder = target_total - per_section * len(sections)
        result = []
        for i, s in enumerate(sections):
            words = per_section + (1 if i < remainder else 0)
            result.append(s.model_copy(update={"target_words": words}))
        return result

    # Scale proportionally
    ratio = target_total / current_total
    result = []
    running_total = 0
    for i, s in enumerate(sections):
        if i == len(sections) - 1:
            # Last section gets the remainder to avoid rounding drift
            words = target_total - running_total
        else:
            words = round(s.target_words * ratio)
        running_total += words
        result.append(s.model_copy(update={"target_words": max(50, words)}))

    return result


async def _llm_generate_blueprint(
    brief: CreationBrief,
    asset_map: AssetMap | None,
) -> CreationBlueprint:
    """Use LLM to generate a CreationBlueprint."""
    model = create_pydantic_ai_model()

    asset_context = "No source assets available."
    if asset_map and asset_map.items:
        asset_lines = []
        for item in asset_map.items:
            asset_lines.append(f"- [{item.id}] type={item.type}, source={item.source}: {item.summary or item.content[:100]}")
        asset_context = f"Available assets:\n" + "\n".join(asset_lines)

    structure_instruction = ""
    if brief.structure_strategy == "copy_source" and asset_map and asset_map.source_structure:
        headings = "\n".join(
            f"{'  ' * (h['level'] - 1)}{h['title']}" for h in asset_map.source_structure
        )
        structure_instruction = f"IMPORTANT: Mirror this source structure:\n{headings}"
    elif brief.structure_strategy == "user_defined":
        structure_instruction = "Use the structure provided by the user in their constraints."
    else:
        structure_instruction = "Design an optimal structure for this content."

    prompt = _BLUEPRINT_PROMPT.format(
        audience=brief.audience,
        goal=brief.goal,
        target_length=brief.target_length,
        style=brief.style,
        tone=brief.tone,
        structure_strategy=brief.structure_strategy,
        image_strategy=brief.image_strategy,
        constraints=json.dumps(brief.constraints, ensure_ascii=False),
        asset_context=asset_context,
        structure_instruction=structure_instruction,
    )

    agent = Agent(
        model,
        result_type=CreationBlueprint,
        system_prompt="You are a document structure planner. Return a valid CreationBlueprint JSON.",
    )

    result = await agent.run(prompt)
    return result.data


async def generate_blueprint(
    brief: CreationBrief,
    asset_map: AssetMap | None,
) -> CreationBlueprint:
    """Generate a CreationBlueprint from Brief and AssetMap.

    Args:
        brief: The confirmed CreationBrief
        asset_map: Parsed assets (None if no files)

    Returns:
        CreationBlueprint with normalized word budgets
    """
    blueprint = await _llm_generate_blueprint(brief, asset_map)

    # Normalize word budgets to match target
    normalized_sections = normalize_word_budgets(
        blueprint.sections, brief.target_length,
    )
    blueprint = blueprint.model_copy(update={
        "sections": normalized_sections,
        "total_target_words": brief.target_length,
    })

    return blueprint
```

- [ ] **第 4 步：运行测试以验证其通过**

```bash
cd /e/test/Docmost/agent-service && python -m pytest tests/orchestrator/test_create_blueprint.py -v
```

预期：全部 4 项通过

- [ ] **第 5 步：提交**

```bash
git add agent-service/app/orchestrator/tools/create_blueprint.py agent-service/tests/orchestrator/test_create_blueprint.py
git commit -m "feat(orchestrator): add Blueprint generation tool with word budget normalization"
```

---

## 分块 7：VisualPlanner Worker

### 任务 7：VisualPlanner Worker

分析每个部分的描述+可用资产来规划视觉元素（Mermaid 图、重复使用的图像、人工智能生成的图像）。

**文件：**
- 创建：`agent-service/app/workers/visual_planner.py`
- 测试： `agent-service/tests/workers/test_visual_planner.py`

**上下文：** `VisualPlan` 模型（来自 `app/models/blueprint.py`）具有字段：`type`（图像/表格/Mermaid/代码/图表）、`description`、`placement`、`source_asset_id`。 `SectionPlan` 有一个 `visuals` 字段（VisualPlan 列表）。 VisualPlanner 在蓝图生成之后、写入之前运行。

- [ ] **第 1 步：为 VisualPlanner 编写失败测试**

```python
# agent-service/tests/workers/test_visual_planner.py
import pytest

from app.models.asset_map import AssetItem, AssetMap
from app.models.blueprint import SectionPlan, VisualPlan, CreationBlueprint
from app.models.brief import CreationBrief


class TestVisualPlanner:
    """Test visual element planning for sections."""

    def test_process_section_suggests_mermaid(self):
        """Sections describing processes should get Mermaid diagram suggestions."""
        from app.workers.visual_planner import plan_visuals_for_section

        section = SectionPlan(
            section_id="s1",
            title="系统架构",
            target_words=500,
            key_points=["Describe the data flow between services", "Show the request lifecycle"],
        )

        visuals = plan_visuals_for_section(
            section=section,
            asset_map=AssetMap(),
            image_strategy="mixed",
        )

        mermaid_visuals = [v for v in visuals if v.type == "mermaid"]
        assert len(mermaid_visuals) >= 1

    def test_process_section_suggests_reuse(self):
        """Sections with matching source images should suggest reuse."""
        from app.workers.visual_planner import plan_visuals_for_section

        section = SectionPlan(
            section_id="s1",
            title="Architecture Overview",
            target_words=500,
            key_points=["System architecture"],
            asset_ids=["img-1"],
        )

        asset_map = AssetMap(
            items=[
                AssetItem(
                    id="img-1",
                    type="image",
                    source="arch.png",
                    content="![Architecture](https://example.com/arch.png)",
                    summary="System architecture diagram [type: diagram]",
                ),
            ],
        )

        visuals = plan_visuals_for_section(
            section=section,
            asset_map=asset_map,
            image_strategy="reuse_source",
        )

        reuse_visuals = [v for v in visuals if v.source_asset_id is not None]
        assert len(reuse_visuals) >= 1
        assert reuse_visuals[0].source_asset_id == "img-1"

    def test_no_visuals_when_strategy_none(self):
        """image_strategy='none' should produce no visuals."""
        from app.workers.visual_planner import plan_visuals_for_section

        section = SectionPlan(
            section_id="s1",
            title="Text Only",
            target_words=500,
            key_points=["Content"],
        )

        visuals = plan_visuals_for_section(
            section=section,
            asset_map=AssetMap(),
            image_strategy="none",
        )

        assert visuals == []

    def test_suggests_ai_image_for_concepts(self):
        """Concept sections should get AI image suggestions when strategy allows."""
        from app.workers.visual_planner import plan_visuals_for_section

        section = SectionPlan(
            section_id="s1",
            title="What is Machine Learning?",
            target_words=800,
            key_points=["Explain ML concepts", "Types of learning"],
        )

        visuals = plan_visuals_for_section(
            section=section,
            asset_map=AssetMap(),
            image_strategy="generate_new",
        )

        ai_visuals = [v for v in visuals if v.source_asset_id is None and v.type == "image"]
        assert len(ai_visuals) >= 1

    def test_plan_all_sections(self):
        """plan_all_visuals should process every section in the blueprint."""
        from app.workers.visual_planner import plan_all_visuals

        blueprint = CreationBlueprint(
            title="Test",
            sections=[
                SectionPlan(section_id="s1", title="Intro", target_words=300, key_points=["Overview"]),
                SectionPlan(section_id="s2", title="Process Flow", target_words=500, key_points=["Data flow", "Steps"]),
                SectionPlan(section_id="s3", title="Summary", target_words=200, key_points=["Recap"]),
            ],
            total_target_words=1000,
        )

        updated = plan_all_visuals(
            blueprint=blueprint,
            asset_map=AssetMap(),
            image_strategy="mixed",
        )

        assert len(updated.sections) == 3
        # At least the "Process Flow" section should have visuals
        s2 = next(s for s in updated.sections if s.section_id == "s2")
        assert len(s2.visuals) >= 1
```

- [ ] **第 2 步：运行测试以验证它们是否失败**

```bash
cd /e/test/Docmost/agent-service && python -m pytest tests/workers/test_visual_planner.py -v
```

预期：失败 — `ModuleNotFoundError: No module named 'app.workers.visual_planner'`

- [ ] **第 3 步：实施 VisualPlanner Worker**

```python
# agent-service/app/workers/visual_planner.py
"""VisualPlanner Worker — plans visual elements for each section.

Analyzes section descriptions and available assets to determine
what visual elements (Mermaid, reused images, AI images, tables)
should be included in each section.
"""
from __future__ import annotations

import re
from typing import TYPE_CHECKING

from app.models.asset_map import AssetMap
from app.models.blueprint import CreationBlueprint, SectionPlan, VisualPlan

if TYPE_CHECKING:
    pass

# Keywords suggesting process/flow diagrams
_PROCESS_KEYWORDS = [
    "flow", "process", "lifecycle", "pipeline", "workflow", "steps",
    "流程", "流水线", "生命周期", "步骤", "阶段",
    "architecture", "架构", "系统",
]

# Keywords suggesting conceptual content (good for AI images)
_CONCEPT_KEYWORDS = [
    "concept", "what is", "introduction", "overview", "explain",
    "概念", "什么是", "介绍", "概述", "解释", "理解",
]

# Keywords suggesting comparison (good for tables)
_COMPARISON_KEYWORDS = [
    "compare", "comparison", "versus", "vs", "difference", "pros and cons",
    "对比", "比较", "区别", "优缺点",
]


def _text_matches_keywords(text: str, keywords: list[str]) -> bool:
    """Check if text contains any of the given keywords (case-insensitive)."""
    text_lower = text.lower()
    return any(kw in text_lower for kw in keywords)


def _get_section_text(section: SectionPlan) -> str:
    """Combine section title and key points into searchable text."""
    parts = [section.title]
    parts.extend(section.key_points)
    return " ".join(parts)


def plan_visuals_for_section(
    section: SectionPlan,
    asset_map: AssetMap,
    image_strategy: str,
) -> list[VisualPlan]:
    """Plan visual elements for a single section.

    Args:
        section: The section plan to analyze
        asset_map: Available assets from source materials
        image_strategy: "reuse_source" | "generate_new" | "mixed" | "none"

    Returns:
        List of VisualPlan elements for this section
    """
    if image_strategy == "none":
        return []

    visuals: list[VisualPlan] = []
    section_text = _get_section_text(section)

    # 1. Check for reusable images from assets
    if image_strategy in ("reuse_source", "mixed"):
        for asset_id in section.asset_ids:
            matching = [a for a in asset_map.items if a.id == asset_id and a.type == "image"]
            for asset in matching:
                visuals.append(VisualPlan(
                    type="image",
                    description=asset.summary or f"Image from {asset.source}",
                    placement="after heading",
                    source_asset_id=asset.id,
                ))

    # 2. Check for process/flow → suggest Mermaid
    if _text_matches_keywords(section_text, _PROCESS_KEYWORDS):
        visuals.append(VisualPlan(
            type="mermaid",
            description=f"Flow diagram for: {section.title}",
            placement="after heading",
        ))

    # 3. Check for comparison → suggest table
    if _text_matches_keywords(section_text, _COMPARISON_KEYWORDS):
        # Only add if no table asset already referenced
        has_table = any(
            a.type == "table" for a in asset_map.items if a.id in section.asset_ids
        )
        if not has_table:
            visuals.append(VisualPlan(
                type="table",
                description=f"Comparison table for: {section.title}",
                placement="inline",
            ))

    # 4. Check for concepts → suggest AI image (if strategy allows)
    if image_strategy in ("generate_new", "mixed"):
        if _text_matches_keywords(section_text, _CONCEPT_KEYWORDS):
            # Only if no image already planned for this section
            has_image = any(v.type == "image" for v in visuals)
            if not has_image:
                visuals.append(VisualPlan(
                    type="image",
                    description=f"Conceptual illustration for: {section.title}",
                    placement="section start",
                ))

    return visuals


def plan_all_visuals(
    blueprint: CreationBlueprint,
    asset_map: AssetMap,
    image_strategy: str,
) -> CreationBlueprint:
    """Plan visuals for all sections in a blueprint.

    Args:
        blueprint: The blueprint to enhance with visual plans
        asset_map: Available assets
        image_strategy: From the CreationBrief

    Returns:
        Updated blueprint with VisualPlans populated on each section
    """
    updated_sections = []
    for section in blueprint.sections:
        visuals = plan_visuals_for_section(section, asset_map, image_strategy)
        updated = section.model_copy(update={"visuals": visuals})
        updated_sections.append(updated)

    return blueprint.model_copy(update={"sections": updated_sections})
```

- [ ] **第 4 步：运行测试以验证其通过**

```bash
cd /e/test/Docmost/agent-service && python -m pytest tests/workers/test_visual_planner.py -v
```

预期：全部 5 项通过

- [ ] **第 5 步：提交**

```bash
git add agent-service/app/workers/visual_planner.py agent-service/tests/workers/test_visual_planner.py
git commit -m "feat(worker): add VisualPlanner for section-level image/diagram planning"
```

---

## 分块 8：Blueprint 模态框前端

### 任务 8：Blueprint Modal 前端

具有可拖动部分（左面板）和实时 Markdown 轮廓预览（右面板）的 Mantine Modal。

**文件：**
- 创建：`apps/client/src/ee/ai/components/ai-creator/blueprint/BlueprintModal.tsx`
- 创建：`apps/client/src/ee/ai/components/ai-creator/blueprint/SectionCard.tsx`
- 创建：`apps/client/src/ee/ai/components/ai-creator/blueprint/use-blueprint-editor.ts`
- 创建：`apps/client/src/ee/ai/components/ai-creator/blueprint/index.ts`

**上下文：** 当 Orchestrator 发送 `blueprint_ready` SSE 事件时，蓝图模式将打开。用户可以通过拖放对各个部分重新排序、调整字数预算以及查看实时 Markdown 大纲预览。使用 `@dnd-kit/sortable` 进行拖放。模态通过 `/v2/agent/resume` 发回最终蓝图。

- [ ] **第 1 步：安装@dnd-kit/sortable依赖项**

```bash
cd /e/test/Docmost && pnpm add @dnd-kit/sortable @dnd-kit/core @dnd-kit/utilities --filter @docmost/client
```

注意：如果已经安装，则此操作无效。

- [ ] **第 2 步：创建 use-blueprint-editor 挂钩**

```typescript
// apps/client/src/ee/ai/components/ai-creator/blueprint/use-blueprint-editor.ts
import { useState, useCallback, useMemo } from "react";
import { arrayMove } from "@dnd-kit/sortable";

export interface SectionPlanData {
  section_id: string;
  title: string;
  target_words: number;
  key_points: string[];
  asset_ids: string[];
  visuals: Array<{
    type: string;
    description: string;
    placement: string;
    source_asset_id?: string | null;
  }>;
  depends_on: string[];
}

export interface BlueprintData {
  title: string;
  summary: string;
  sections: SectionPlanData[];
  total_target_words: number;
}

export function useBlueprintEditor(initialBlueprint: BlueprintData) {
  const [blueprint, setBlueprint] = useState<BlueprintData>(initialBlueprint);

  const totalWords = useMemo(
    () => blueprint.sections.reduce((sum, s) => sum + s.target_words, 0),
    [blueprint.sections],
  );

  const markdownPreview = useMemo(() => {
    const lines = [`# ${blueprint.title}`, ""];
    if (blueprint.summary) {
      lines.push(`> ${blueprint.summary}`, "");
    }
    for (const section of blueprint.sections) {
      lines.push(`## ${section.title}`);
      lines.push(`*${section.target_words} 字*`);
      for (const point of section.key_points) {
        lines.push(`- ${point}`);
      }
      if (section.visuals.length > 0) {
        lines.push(
          `📊 ${section.visuals.map((v) => v.type).join(", ")}`,
        );
      }
      lines.push("");
    }
    return lines.join("\n");
  }, [blueprint]);

  const reorderSections = useCallback(
    (oldIndex: number, newIndex: number) => {
      setBlueprint((prev) => ({
        ...prev,
        sections: arrayMove(prev.sections, oldIndex, newIndex),
      }));
    },
    [],
  );

  const updateSection = useCallback(
    (sectionId: string, updates: Partial<SectionPlanData>) => {
      setBlueprint((prev) => ({
        ...prev,
        sections: prev.sections.map((s) =>
          s.section_id === sectionId ? { ...s, ...updates } : s,
        ),
      }));
    },
    [],
  );

  const removeSection = useCallback((sectionId: string) => {
    setBlueprint((prev) => ({
      ...prev,
      sections: prev.sections.filter((s) => s.section_id !== sectionId),
    }));
  }, []);

  const addSection = useCallback((afterSectionId: string | null) => {
    setBlueprint((prev) => {
      const newId = `s${Date.now()}`;
      const newSection: SectionPlanData = {
        section_id: newId,
        title: "New Section",
        target_words: 300,
        key_points: [""],
        asset_ids: [],
        visuals: [],
        depends_on: [],
      };

      if (afterSectionId === null) {
        return { ...prev, sections: [...prev.sections, newSection] };
      }

      const idx = prev.sections.findIndex(
        (s) => s.section_id === afterSectionId,
      );
      const sections = [...prev.sections];
      sections.splice(idx + 1, 0, newSection);
      return { ...prev, sections };
    });
  }, []);

  return {
    blueprint,
    totalWords,
    markdownPreview,
    reorderSections,
    updateSection,
    removeSection,
    addSection,
  };
}
```

- [ ] **第 3 步：创建SectionCard组件**

```tsx
// apps/client/src/ee/ai/components/ai-creator/blueprint/SectionCard.tsx
import { Card, TextInput, NumberInput, Group, ActionIcon, Badge, Text, Stack } from "@mantine/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { IconGripVertical, IconTrash } from "@tabler/icons-react";
import type { SectionPlanData } from "./use-blueprint-editor";

interface SectionCardProps {
  section: SectionPlanData;
  onUpdate: (updates: Partial<SectionPlanData>) => void;
  onRemove: () => void;
}

export function SectionCard({ section, onUpdate, onRemove }: SectionCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: section.section_id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      shadow="xs"
      padding="xs"
      radius="sm"
      withBorder
    >
      <Group gap="xs" wrap="nowrap">
        <ActionIcon
          variant="subtle"
          size="sm"
          {...attributes}
          {...listeners}
          style={{ cursor: "grab" }}
        >
          <IconGripVertical size={14} />
        </ActionIcon>

        <Stack gap={4} style={{ flex: 1 }}>
          <TextInput
            size="xs"
            value={section.title}
            onChange={(e) => onUpdate({ title: e.target.value })}
            styles={{ input: { fontWeight: 600 } }}
          />

          <Group gap="xs">
            <NumberInput
              size="xs"
              value={section.target_words}
              onChange={(v) =>
                onUpdate({
                  target_words: typeof v === "number" ? v : 300,
                })
              }
              min={50}
              max={10000}
              step={100}
              suffix=" 字"
              w={120}
            />
            {section.visuals.map((v, i) => (
              <Badge key={i} size="xs" variant="light" color="blue">
                {v.type}
              </Badge>
            ))}
          </Group>
        </Stack>

        <ActionIcon
          variant="subtle"
          color="red"
          size="sm"
          onClick={onRemove}
        >
          <IconTrash size={14} />
        </ActionIcon>
      </Group>
    </Card>
  );
}
```

- [ ] **第 4 步：创建BlueprintModal组件**

```tsx
// apps/client/src/ee/ai/components/ai-creator/blueprint/BlueprintModal.tsx
import { useCallback } from "react";
import {
  Modal,
  Grid,
  Stack,
  ScrollArea,
  Button,
  Group,
  Text,
  Code,
  Badge,
  Divider,
} from "@mantine/core";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { SectionCard } from "./SectionCard";
import { useBlueprintEditor, type BlueprintData } from "./use-blueprint-editor";

interface BlueprintModalProps {
  opened: boolean;
  onClose: () => void;
  blueprint: BlueprintData;
  onConfirm: (blueprint: BlueprintData) => void;
  onRegenerate: () => void;
}

export function BlueprintModal({
  opened,
  onClose,
  blueprint: initialBlueprint,
  onConfirm,
  onRegenerate,
}: BlueprintModalProps) {
  const {
    blueprint,
    totalWords,
    markdownPreview,
    reorderSections,
    updateSection,
    removeSection,
    addSection,
  } = useBlueprintEditor(initialBlueprint);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (over && active.id !== over.id) {
        const oldIndex = blueprint.sections.findIndex(
          (s) => s.section_id === active.id,
        );
        const newIndex = blueprint.sections.findIndex(
          (s) => s.section_id === over.id,
        );
        reorderSections(oldIndex, newIndex);
      }
    },
    [blueprint.sections, reorderSections],
  );

  const handleConfirm = useCallback(() => {
    onConfirm({ ...blueprint, total_target_words: totalWords });
  }, [blueprint, totalWords, onConfirm]);

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Creation Blueprint"
      size="xl"
      centered
    >
      <Grid gutter="md">
        {/* Left panel: Section list (60%) */}
        <Grid.Col span={7}>
          <Stack gap="xs">
            <Group justify="space-between">
              <Text size="sm" fw={600}>
                Sections
              </Text>
              <Button
                variant="subtle"
                size="xs"
                onClick={() => addSection(null)}
              >
                + Add Section
              </Button>
            </Group>

            <ScrollArea h={400}>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={blueprint.sections.map((s) => s.section_id)}
                  strategy={verticalListSortingStrategy}
                >
                  <Stack gap="xs">
                    {blueprint.sections.map((section) => (
                      <SectionCard
                        key={section.section_id}
                        section={section}
                        onUpdate={(updates) =>
                          updateSection(section.section_id, updates)
                        }
                        onRemove={() => removeSection(section.section_id)}
                      />
                    ))}
                  </Stack>
                </SortableContext>
              </DndContext>
            </ScrollArea>
          </Stack>
        </Grid.Col>

        {/* Right panel: Markdown preview (40%) */}
        <Grid.Col span={5}>
          <Stack gap="xs">
            <Text size="sm" fw={600}>
              Outline Preview
            </Text>
            <ScrollArea h={400}>
              <Code block style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>
                {markdownPreview}
              </Code>
            </ScrollArea>
          </Stack>
        </Grid.Col>
      </Grid>

      <Divider my="sm" />

      {/* Bottom toolbar */}
      <Group justify="space-between">
        <Group gap="xs">
          <Badge
            variant="light"
            color={
              Math.abs(totalWords - initialBlueprint.total_target_words) /
                initialBlueprint.total_target_words <=
              0.05
                ? "green"
                : "orange"
            }
          >
            Total: {totalWords} / {initialBlueprint.total_target_words} words
          </Badge>
          <Badge variant="light">{blueprint.sections.length} sections</Badge>
        </Group>

        <Group gap="xs">
          <Button variant="subtle" size="sm" onClick={onRegenerate}>
            Regenerate
          </Button>
          <Button size="sm" onClick={handleConfirm}>
            Confirm
          </Button>
        </Group>
      </Group>
    </Modal>
  );
}
```

- [ ] **第 5 步：创建桶导出**

```typescript
// apps/client/src/ee/ai/components/ai-creator/blueprint/index.ts
export { BlueprintModal } from "./BlueprintModal";
export { SectionCard } from "./SectionCard";
export { useBlueprintEditor } from "./use-blueprint-editor";
export type { BlueprintData, SectionPlanData } from "./use-blueprint-editor";
```

- [ ] **第 6 步：验证 TypeScript 是否编译**

```bash
cd /e/test/Docmost && npx tsc --noEmit --project apps/client/tsconfig.json 2>&1 | head -20
```

预期：没有与蓝图组件相关的错误

- [ ] **第 7 步：提交**

```bash
git add apps/client/src/ee/ai/components/ai-creator/blueprint/
git commit -m "feat(ui): add BlueprintModal with draggable sections and live outline preview"
```

---

## 分块 9：Researcher Worker

### 任务 9：Researcher Worker

将现有的搜索/抓取/RAG 工具包装到 Orchestrator 的统一研究界面中。

**文件：**
- 创建：`agent-service/app/workers/researcher.py`
- 创建：`agent-service/app/orchestrator/tools/research.py`
- 测试： `agent-service/tests/workers/test_researcher.py`

**上下文：** 现有工具：`tavily_search`（网络搜索）、`firecrawl_scrape`（网页抓取）、`docmost_rag`（知识库搜索）、`docmost_page_read`（阅读 Docmost 页面）。研究人员将这些内容包装起来，以提供带有源引文的结构化研究结果。

- [ ] **第 1 步：为研究员工作者编写失败测试**

```python
# agent-service/tests/workers/test_researcher.py
import pytest
from unittest.mock import patch, MagicMock


class TestResearcher:
    """Test the Researcher Worker."""

    def test_web_search(self):
        """Should call tavily_search and return structured results."""
        from app.workers.researcher import research_web

        with patch("app.workers.researcher.tavily_search") as mock_tavily:
            mock_tavily.invoke.return_value = "Result 1: AI overview\nResult 2: ML basics"
            results = research_web("artificial intelligence overview")

        assert len(results) >= 1
        assert results[0]["source"] == "web"
        assert results[0]["content"] != ""

    def test_knowledge_base_search(self):
        """Should call docmost_rag and return structured results."""
        from app.workers.researcher import research_knowledge_base

        with patch("app.workers.researcher.docmost_rag") as mock_rag:
            mock_rag.invoke.return_value = "**Page Title**\nRelevant content here"
            results = research_knowledge_base(
                query="project architecture",
                workspace_id="ws-001",
            )

        assert len(results) >= 1
        assert results[0]["source"] == "knowledge_base"

    def test_page_read(self):
        """Should call docmost_page_read and return structured result."""
        from app.workers.researcher import research_page

        with patch("app.workers.researcher.docmost_page_read") as mock_read:
            mock_read.invoke.return_value = "# Page Title\n\nPage content here."
            result = research_page(page_id="page-001")

        assert result["source"] == "docmost_page"
        assert "Page content" in result["content"]

    def test_combined_research(self):
        """research_all should combine web + KB results."""
        from app.workers.researcher import research_all

        with patch("app.workers.researcher.tavily_search") as mock_tavily, \
             patch("app.workers.researcher.docmost_rag") as mock_rag:
            mock_tavily.invoke.return_value = "Web result"
            mock_rag.invoke.return_value = "KB result"

            results = research_all(
                query="test topic",
                workspace_id="ws-001",
                include_web=True,
                include_kb=True,
            )

        # Should have results from both sources
        sources = {r["source"] for r in results}
        assert "web" in sources
        assert "knowledge_base" in sources
```

- [ ] **第 2 步：运行测试以验证它们是否失败**

```bash
cd /e/test/Docmost/agent-service && python -m pytest tests/workers/test_researcher.py -v
```

预期：失败 — `ModuleNotFoundError: No module named 'app.workers.researcher'`

- [ ] **第 3 步：实施研究员工作人员**

```python
# agent-service/app/workers/researcher.py
"""Researcher Worker — unified research interface.

Wraps existing tools (tavily_search, firecrawl_scrape, docmost_rag,
docmost_page_read) to provide structured research results with
source citations for the Orchestrator.
"""
from __future__ import annotations

import logging
from typing import TypedDict

from app.tools.tavily_search import tavily_search
from app.tools.firecrawl_scrape import firecrawl_scrape
from app.tools.docmost_api import docmost_rag, docmost_page_read

logger = logging.getLogger(__name__)


class ResearchResult(TypedDict):
    source: str       # "web", "knowledge_base", "docmost_page", "web_scrape"
    query: str        # The query/URL used
    content: str      # The retrieved content
    citation: str     # Citation string for attribution


def research_web(query: str) -> list[ResearchResult]:
    """Search the web via Tavily and return structured results."""
    try:
        raw = tavily_search.invoke({"query": query})
        return [{
            "source": "web",
            "query": query,
            "content": raw,
            "citation": f"Web search: {query}",
        }]
    except Exception as e:
        logger.error(f"Web search failed: {e}")
        return []


def research_knowledge_base(
    query: str,
    workspace_id: str,
    space_id: str | None = None,
) -> list[ResearchResult]:
    """Search Docmost knowledge base via RAG."""
    try:
        raw = docmost_rag.invoke({
            "query": query,
            "workspace_id": workspace_id,
            "space_id": space_id,
        })
        return [{
            "source": "knowledge_base",
            "query": query,
            "content": raw,
            "citation": f"Knowledge base: {query}",
        }]
    except Exception as e:
        logger.error(f"KB search failed: {e}")
        return []


def research_page(page_id: str) -> ResearchResult:
    """Read a specific Docmost page."""
    try:
        raw = docmost_page_read.invoke({"page_id": page_id})
        return {
            "source": "docmost_page",
            "query": page_id,
            "content": raw,
            "citation": f"Docmost page: {page_id}",
        }
    except Exception as e:
        logger.error(f"Page read failed: {e}")
        return {
            "source": "docmost_page",
            "query": page_id,
            "content": f"Failed to read page: {e}",
            "citation": f"Docmost page: {page_id} (error)",
        }


def scrape_url(url: str) -> ResearchResult:
    """Scrape a web page via Firecrawl."""
    try:
        raw = firecrawl_scrape.invoke({"url": url})
        return {
            "source": "web_scrape",
            "query": url,
            "content": raw,
            "citation": f"Web page: {url}",
        }
    except Exception as e:
        logger.error(f"Scrape failed: {e}")
        return {
            "source": "web_scrape",
            "query": url,
            "content": f"Failed to scrape: {e}",
            "citation": f"Web page: {url} (error)",
        }


def research_all(
    query: str,
    workspace_id: str,
    include_web: bool = True,
    include_kb: bool = True,
    space_id: str | None = None,
) -> list[ResearchResult]:
    """Perform combined research across all available sources.

    Args:
        query: Research query
        workspace_id: Docmost workspace ID
        include_web: Whether to search the web
        include_kb: Whether to search the knowledge base
        space_id: Optional space ID to narrow KB search

    Returns:
        Combined list of ResearchResults from all sources
    """
    results: list[ResearchResult] = []

    if include_web:
        results.extend(research_web(query))

    if include_kb:
        results.extend(research_knowledge_base(query, workspace_id, space_id))

    return results
```

- [ ] **第 4 步：实施研究协调器工具**

```python
# agent-service/app/orchestrator/tools/research.py
"""research — Orchestrator tool for research.

Wraps the Researcher Worker to provide a unified research interface
accessible from the Orchestrator's ReAct loop.
"""
from __future__ import annotations

import json
import logging

from app.workers.researcher import research_all, research_page, scrape_url

logger = logging.getLogger(__name__)


async def research_impl(
    query: str,
    workspace_id: str,
    include_web: bool = True,
    include_kb: bool = True,
    space_id: str | None = None,
    page_ids: list[str] | None = None,
    urls: list[str] | None = None,
) -> str:
    """Execute research across multiple sources.

    Returns JSON-serialized list of research results.
    """
    results = research_all(
        query=query,
        workspace_id=workspace_id,
        include_web=include_web,
        include_kb=include_kb,
        space_id=space_id,
    )

    # Read specific pages if requested
    if page_ids:
        for pid in page_ids:
            results.append(research_page(pid))

    # Scrape specific URLs if requested
    if urls:
        for url in urls:
            results.append(scrape_url(url))

    return json.dumps(results, ensure_ascii=False)
```

- [ ] **第 5 步：运行测试以验证其通过**

```bash
cd /e/test/Docmost/agent-service && python -m pytest tests/workers/test_researcher.py -v
```

预期：全部 4 项通过

- [ ] **第 6 步：提交**

```bash
git add agent-service/app/workers/researcher.py agent-service/app/orchestrator/tools/research.py agent-service/tests/workers/test_researcher.py
git commit -m "feat(worker): add Researcher Worker with unified search/scrape/RAG interface"
```

---

## 分块 10：注册第 2 阶段全部工具

### 任务 10：Register all Phase 2 tools with Orchestrator

更新 Orchestrator 引擎以注册第 2 阶段工具并更新第 2 级路径处理的系统提示。

**文件：**
- 修改：`agent-service/app/orchestrator/engine.py`
- 修改：`agent-service/app/orchestrator/prompts.py`

**上下文：** Orchestrator 引擎 (`app/orchestrator/engine.py`) 创建 PydanticAI 代理并注册工具。系统提示符 (`app/orchestrator/prompts.py`) 定义 Orchestrator 如何决定任务级别和执行策略。

- [ ] **第 1 步：使用 2 级说明更新提示.py**

将以下内容添加到 `agent-service/app/orchestrator/prompts.py` 中的 `ORCHESTRATOR_SYSTEM_PROMPT`：

```python
_LEVEL2_INSTRUCTIONS = """
## Level 2: Structured Edit Path

When complexity is Level 2 (file uploads, formatting, continuation, expansion):

1. Call `parse_assets` to extract structured assets from uploaded files
2. Call `create_brief` to generate a Smart Brief with AI-recommended defaults
3. Send the brief to the user via `ask_user` with phase="brief"
4. Wait for user confirmation/modifications
5. Once confirmed, proceed to write using the brief as guidance
6. Call `finalize` to merge content into the page

Key rules for Level 2:
- Always parse uploaded files before writing
- Present the Smart Brief for user confirmation
- Skip Blueprint (no section-by-section planning needed)
- Use a single writing pass guided by the brief
- Respect the user's chosen structure_strategy and image_strategy
"""
```

- [ ] **第 2 步：更新engine.py以注册第2阶段工具**

更新 `agent-service/app/orchestrator/engine.py` 中的工具注册：

```python
# Add imports at top of engine.py
from app.orchestrator.tools.parse_assets import parse_assets_impl
from app.orchestrator.tools.create_brief import generate_brief
from app.orchestrator.tools.create_blueprint import generate_blueprint
from app.orchestrator.tools.research import research_impl

# In the tool registration section, add:
# Phase 2 tools
async def parse_assets_tool(ctx, files: list[dict], page_id: str) -> str:
    """Parse uploaded files into structured assets (text, images, tables, code)."""
    return await parse_assets_impl(files=files, page_id=page_id)

async def create_brief_tool(ctx, user_message: str, asset_map_json: str | None = None) -> str:
    """Generate a Smart Brief with AI-recommended defaults for the creation task."""
    from app.models.asset_map import AssetMap
    asset_map = AssetMap.model_validate_json(asset_map_json) if asset_map_json else None
    brief = await generate_brief(user_message=user_message, asset_map=asset_map)
    return brief.model_dump_json()

async def create_blueprint_tool(ctx, brief_json: str, asset_map_json: str | None = None) -> str:
    """Generate a Creation Blueprint with section plans and word budgets."""
    from app.models.brief import CreationBrief
    from app.models.asset_map import AssetMap
    brief = CreationBrief.model_validate_json(brief_json)
    asset_map = AssetMap.model_validate_json(asset_map_json) if asset_map_json else None
    blueprint = await generate_blueprint(brief=brief, asset_map=asset_map)
    return blueprint.model_dump_json()

async def research_tool(ctx, query: str, workspace_id: str, include_web: bool = True, include_kb: bool = True) -> str:
    """Research a topic across web search and knowledge base."""
    return await research_impl(query=query, workspace_id=workspace_id, include_web=include_web, include_kb=include_kb)
```

- [ ] **第 3 步：验证引擎启动时没有错误**

```bash
cd /e/test/Docmost/agent-service && python -c "from app.orchestrator.engine import create_orchestrator_agent; print('OK')"
```

预期：打印“OK”

- [ ] **第 4 步：提交**

```bash
git add agent-service/app/orchestrator/engine.py agent-service/app/orchestrator/prompts.py
git commit -m "feat(orchestrator): register Phase 2 tools and add Level 2 system prompt"
```

---

## 分块 11：Level 2 端到端测试

### 任务 11：Level 2 end-to-end test

测试完整的2级路径：上传文件→parse_assets→ask_user(brief)→write→done。

**文件：**
- 创建：`agent-service/tests/orchestrator/test_e2e_level2.py`

- [ ] **第 1 步：编写 2 级集成测试**

```python
# agent-service/tests/orchestrator/test_e2e_level2.py
"""End-to-end test for Level 2 path: file upload → parse → brief → write → done."""
import json
import pytest
from unittest.mock import patch, AsyncMock, MagicMock

from app.models.brief import CreationBrief
from app.models.asset_map import AssetMap, AssetItem


class TestLevel2E2E:
    """End-to-end Level 2 integration tests."""

    @pytest.mark.asyncio
    async def test_level2_file_upload_flow(self):
        """Full Level 2 path: upload file → parse → brief → write."""
        from app.orchestrator.tools.parse_assets import parse_assets_impl
        from app.orchestrator.tools.create_brief import generate_brief

        # Step 1: Parse assets
        with patch("app.orchestrator.tools.parse_assets.parse_document") as mock_parse:
            mock_parse.return_value = AssetMap(
                items=[
                    AssetItem(id="t1", type="text", source="doc.pdf", content="Chapter 1 content"),
                    AssetItem(id="h1", type="heading_structure", source="doc.pdf",
                             content="# Title\n## Chapter 1"),
                ],
                source_word_count=2000,
                source_structure=[
                    {"level": 1, "title": "Title"},
                    {"level": 2, "title": "Chapter 1"},
                ],
            )

            asset_map_json = await parse_assets_impl(
                files=[{"content_b64": "dGVzdA==", "filename": "doc.pdf", "mimetype": "application/pdf"}],
                page_id="page-001",
            )

        asset_map = AssetMap.model_validate_json(asset_map_json)
        assert asset_map.source_word_count == 2000
        assert len(asset_map.items) == 2

        # Step 2: Generate brief
        mock_brief = CreationBrief(
            audience="general",
            goal="Reformat the document",
            target_length=2000,
            style="formal",
            tone="professional",
            structure_strategy="copy_source",
            image_strategy="reuse_source",
        )

        with patch("app.orchestrator.tools.create_brief._llm_generate_brief", new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = mock_brief
            brief = await generate_brief(
                user_message="优化排版",
                asset_map=asset_map,
            )

        assert brief.structure_strategy == "copy_source"
        assert brief.target_length == 2000

    @pytest.mark.asyncio
    async def test_level2_complexity_detection(self):
        """Single file upload should be detected as Level 2."""
        from app.orchestrator.tools.complexity import analyze_task_complexity

        result = analyze_task_complexity(
            user_message="优化排版",
            files=[{"filename": "doc.pdf", "mimetype": "application/pdf"}],
            intent_route="document_transform",
            template_id=None,
            selected_text=None,
        )

        assert result["level"] == 2

    @pytest.mark.asyncio
    async def test_level2_asset_map_serialization(self):
        """AssetMap should survive the JSON serialization round-trip through tools."""
        from app.orchestrator.tools.parse_assets import parse_assets_impl

        original_map = AssetMap(
            items=[
                AssetItem(id="t1", type="text", source="test.md", content="Hello world",
                         summary="Section 'Intro': 2 words"),
            ],
            source_word_count=2,
            source_structure=[{"level": 1, "title": "Intro"}],
        )

        with patch("app.orchestrator.tools.parse_assets.parse_document") as mock_parse:
            mock_parse.return_value = original_map
            result_json = await parse_assets_impl(
                files=[{"content_b64": "dGVzdA==", "filename": "test.md", "mimetype": "text/markdown"}],
                page_id="p1",
            )

        restored = AssetMap.model_validate_json(result_json)
        assert restored.source_word_count == 2
        assert len(restored.items) == 1
        assert restored.items[0].id == "t1"
```

- [ ] **第 2 步：运行测试**

```bash
cd /e/test/Docmost/agent-service && python -m pytest tests/orchestrator/test_e2e_level2.py -v
```

预期：全部 3 项通过

- [ ] **第 3 步：运行完整的测试套件以验证没有回归**

```bash
cd /e/test/Docmost/agent-service && python -m pytest tests/ -v --tb=short
```

预期：所有测试均通过

- [ ] **第 4 步：提交**

```bash
git add agent-service/tests/orchestrator/test_e2e_level2.py
git commit -m "test(orchestrator): add Level 2 end-to-end integration tests"
```
## 实施状态更新 (2026-03-19)

- 解析器提取的源图像现在保留为 `AssetItem(type="image")`，而不是在文档解析后删除。
- 提取的图像通过内容哈希进行重复数据删除，并重新托管到稳定的 Docmost URL 以便下游重用。
- 资产元数据现在包含规划所需的出处字段：来源、标题、源文件、源页面、源标题和 MIME 类型。
- 蓝图规划现在对每个部分进行排名 `visual_candidates`，并让用户在编写开始之前确认要重用哪个源图。
- 工作台蓝图 UI 现在呈现源图像候选并通过代理会话发送回规范图像策略决策。
