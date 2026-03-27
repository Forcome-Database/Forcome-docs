# Phase 3: 文档智能体增强 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除文档图片碎片化问题，引入 VLM 图片理解能力，实现 MiniMax 级别的"干净提取→语义理解→精确放置→自动尺寸"文档处理体验。

**Architecture:** 图片提取从 MinerU 的 YOLO 布局检测改为原生提取（DOCX/PPTX 从 ZIP 取 word/media/*, PDF 从 PyMuPDF 取嵌入图片）。新增 `describe_images` 工具让 Agent 通过 VLM 理解图片内容后再决定放置位置。commit 管线增加图片自动尺寸步骤。

**Tech Stack:** Python 3.11+, zipfile(stdlib), Pillow, PyMuPDF(pymupdf), PydanticAI, LangChain VLM; NestJS + sharp

**Spec:** `docs/superpowers/specs/2026-03-27-document-image-extraction-research.md`

**Worktree:** `E:/test/Docmost/.worktrees/feat-intelligent-agent`（分支 `feat/intelligent-agent`）

**前提：** Phase 1 + Phase 2 已完成（22 commits）

---

## 文件结构

### 新建文件

```
agent-service/app/agent/
├── tools/
│   ├── describe_images.py          # 新工具：VLM 批量图片描述
│   └── native_image_extractor.py   # DOCX/PPTX/PDF 原生图片提取

agent-service/tests/agent/
├── tools/
│   ├── test_describe_images.py
│   └── test_native_image_extractor.py

apps/server/src/ee/ai/
└── ai-image-dimension-setter.ts    # commit 管线图片自动尺寸
```

### 修改文件

| 文件 | 变更 |
|------|------|
| `agent-service/app/agent/deps.py` | 新增 `image_payloads` 字段（extract→describe 数据传递） |
| `agent-service/app/config.py` | 新增 `ai_vlm_model`, `ai_vlm_driver`, `ai_vlm_api_key` 字段 |
| `agent-service/app/tools/vlm_understand.py` | 支持独立 VLM 模型配置 + 多图批量描述 |
| `agent-service/app/agent/tools/extract_document.py` | 使用原生图片提取替换 MinerU 图片 |
| `agent-service/app/agent/tools/__init__.py` | 注册 `describe_images_tool` |
| `agent-service/app/agent/skill.py` | 更新 Skill 提示词，引导多步推理 |
| `agent-service/pyproject.toml` | 新增 `pymupdf` 依赖 |
| `apps/server/package.json` | 新增 `sharp` 依赖（需确认 Docker 支持原生编译） |
| `apps/server/src/core/page/services/page.service.ts` | 在 commitAiContent 中调用图片尺寸设置 |

### 显式延迟项（Phase 4）

| 项目 | 原因 |
|------|------|
| `tool_progress` SSE 子步骤事件 | 需要扩展 SSE 协议 + 前端组件，单独迭代 |
| 前端 ToolCallStep 多步骤展示 | 依赖 `tool_progress` 事件，一起延迟 |

---

## Task 0: 新增 PyMuPDF 依赖

**Files:**
- Modify: `agent-service/pyproject.toml`

- [ ] **Step 1: 添加 pymupdf 依赖**

```toml
# pyproject.toml [project] dependencies 中添加
"pymupdf>=1.25",
```

- [ ] **Step 2: 安装并验证**

```bash
cd agent-service && pip install -e ".[dev]"
python -c "import pymupdf; print('pymupdf OK:', pymupdf.__version__)"
```

- [ ] **Step 3: 提交**

```bash
git add agent-service/pyproject.toml
git commit -m "chore(deps): add pymupdf for PDF native image extraction"
```

---

## Task 1: 原生图片提取器

**Files:**
- Create: `agent-service/app/agent/tools/native_image_extractor.py`
- Test: `agent-service/tests/agent/tools/test_native_image_extractor.py`

**职责：** 从 DOCX/PPTX/PDF 中提取原始嵌入图片（绕过 MinerU YOLO 碎片化）。

- [ ] **Step 1: 写失败测试**

```python
# tests/agent/tools/test_native_image_extractor.py
import base64
import io
import zipfile
import pytest
from PIL import Image


def _make_docx_with_images(image_count: int) -> bytes:
    """创建包含指定数量图片的最小 DOCX ZIP。"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        # 最小 DOCX 结构
        zf.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>')
        for i in range(image_count):
            # 创建一个 200x150 的测试图片
            img = Image.new("RGB", (200, 150), color=(i * 30 % 256, 100, 200))
            img_buf = io.BytesIO()
            img.save(img_buf, format="PNG")
            zf.writestr(f"word/media/image{i+1}.png", img_buf.getvalue())
        # 添加一个 20x20 的小图标（应被过滤）
        tiny = Image.new("RGB", (20, 20), color=(0, 0, 0))
        tiny_buf = io.BytesIO()
        tiny.save(tiny_buf, format="PNG")
        zf.writestr("word/media/bullet.png", tiny_buf.getvalue())
    return buf.getvalue()


def test_extract_docx_images():
    from app.agent.tools.native_image_extractor import extract_native_images
    docx_bytes = _make_docx_with_images(3)
    images = extract_native_images(docx_bytes, "test.docx")
    # 3 个 200x150 图片应保留，1 个 20x20 应被过滤
    assert len(images) == 3
    for img in images:
        assert img.b64  # 有 base64 数据
        assert img.parser == "docx_native"
        assert img.mime_type == "image/png"


def test_extract_filters_tiny_images():
    from app.agent.tools.native_image_extractor import extract_native_images
    docx_bytes = _make_docx_with_images(0)  # 只有 20x20 小图标
    images = extract_native_images(docx_bytes, "test.docx")
    assert len(images) == 0


def test_extract_non_zip_returns_empty():
    from app.agent.tools.native_image_extractor import extract_native_images
    images = extract_native_images(b"not a zip file", "test.docx")
    assert len(images) == 0


def test_extract_pptx_images():
    from app.agent.tools.native_image_extractor import extract_native_images
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types></Types>')
        img = Image.new("RGB", (300, 200), color=(100, 100, 100))
        img_buf = io.BytesIO()
        img.save(img_buf, format="JPEG")
        zf.writestr("ppt/media/image1.jpg", img_buf.getvalue())
    images = extract_native_images(buf.getvalue(), "slides.pptx")
    assert len(images) == 1
    assert images[0].mime_type == "image/jpeg"


def test_extract_pdf_images():
    """PDF 原生图片提取（需要 pymupdf）。"""
    import pymupdf
    from app.agent.tools.native_image_extractor import extract_native_images

    # 创建包含一张图片的最小 PDF
    doc = pymupdf.open()
    page = doc.new_page(width=612, height=792)
    # 插入一张 200x150 的测试图片
    img = Image.new("RGB", (200, 150), color=(50, 100, 200))
    img_buf = io.BytesIO()
    img.save(img_buf, format="PNG")
    img_bytes = img_buf.getvalue()
    page.insert_image(pymupdf.Rect(100, 100, 300, 250), stream=img_bytes)
    pdf_bytes = doc.tobytes()
    doc.close()

    images = extract_native_images(pdf_bytes, "test.pdf")
    assert len(images) >= 1
    assert images[0].parser == "pdf_native"
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd agent-service && python -m pytest tests/agent/tools/test_native_image_extractor.py -v
```
Expected: FAIL (module not found)

- [ ] **Step 3: 实现原生图片提取器**

```python
# agent-service/app/agent/tools/native_image_extractor.py
"""从 Office XML (DOCX/PPTX) 和 PDF 中原生提取嵌入图片。

绕过 MinerU 的 YOLO 布局检测，直接从文件结构中提取原始图片，
消除截图被拆碎为 UI 元素碎片的问题。
"""
from __future__ import annotations

import base64
import io
import logging
import zipfile
from pathlib import Path

from PIL import Image

from app.models.source_assets import SourceImagePayload

logger = logging.getLogger(__name__)

MIN_PIXEL_AREA = 2500  # 50x50 — 过滤装饰性小图标/项目符号
MIN_FILE_BYTES = 500   # 过滤极小文件

# Office XML ZIP 中图片的路径前缀
_MEDIA_PREFIXES = {
    "docx": "word/media/",
    "doc": "word/media/",
    "pptx": "ppt/media/",
    "ppt": "ppt/media/",
}

# 支持的光栅图片扩展名（跳过 EMF/WMF 矢量格式）
_RASTER_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".tif"}

_MIME_MAP = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".tiff": "image/tiff",
    ".tif": "image/tiff",
}


def _get_format_key(filename: str) -> str | None:
    """从文件名提取格式 key（docx/pptx 等）。"""
    ext = Path(filename).suffix.lower().lstrip(".")
    return ext if ext in _MEDIA_PREFIXES else None


def _extract_from_office_zip(
    file_bytes: bytes, media_prefix: str,
) -> list[SourceImagePayload]:
    """从 Office XML ZIP 中提取 media/ 目录下的光栅图片。"""
    try:
        zf = zipfile.ZipFile(io.BytesIO(file_bytes))
    except (zipfile.BadZipFile, Exception):
        return []

    images: list[SourceImagePayload] = []
    for name in sorted(zf.namelist()):
        if not name.startswith(media_prefix):
            continue

        ext = Path(name).suffix.lower()
        if ext not in _RASTER_EXTS:
            continue

        img_bytes = zf.read(name)
        if len(img_bytes) < MIN_FILE_BYTES:
            continue

        # 读取像素尺寸（Pillow 只读 header，极快）
        try:
            with Image.open(io.BytesIO(img_bytes)) as pil_img:
                w, h = pil_img.size
        except Exception:
            continue

        if w * h < MIN_PIXEL_AREA:
            continue

        images.append(SourceImagePayload(
            index=len(images),
            b64=base64.b64encode(img_bytes).decode("utf-8"),
            desc=f"Embedded image ({w}x{h})",
            mime_type=_MIME_MAP.get(ext, "image/png"),
            parser="docx_native",
            source_ref=name,
            confidence=1.0,
        ))

    zf.close()
    logger.info(
        "native_image_extraction",
        extra={"source": "office_zip", "prefix": media_prefix, "count": len(images)},
    )
    return images


def _extract_from_pdf(file_bytes: bytes) -> list[SourceImagePayload]:
    """从 PDF 中用 PyMuPDF 提取嵌入图片。"""
    try:
        import pymupdf
    except ImportError:
        logger.warning("pymupdf not installed, skipping PDF native extraction")
        return []

    images: list[SourceImagePayload] = []
    try:
        doc = pymupdf.open(stream=file_bytes, filetype="pdf")
    except Exception:
        return []

    seen_xrefs: set[int] = set()
    for page in doc:
        for img_info in page.get_images(full=True):
            xref = img_info[0]
            if xref in seen_xrefs:
                continue
            seen_xrefs.add(xref)

            try:
                base_image = doc.extract_image(xref)
            except Exception:
                continue

            img_bytes = base_image.get("image")
            img_ext = base_image.get("ext", "png")
            if not img_bytes or len(img_bytes) < MIN_FILE_BYTES:
                continue

            # 读取像素尺寸
            try:
                with Image.open(io.BytesIO(img_bytes)) as pil_img:
                    w, h = pil_img.size
            except Exception:
                continue

            if w * h < MIN_PIXEL_AREA:
                continue

            mime = _MIME_MAP.get(f".{img_ext}", "image/png")
            images.append(SourceImagePayload(
                index=len(images),
                b64=base64.b64encode(img_bytes).decode("utf-8"),
                desc=f"Embedded image ({w}x{h})",
                mime_type=mime,
                page_number=page.number + 1,
                parser="pdf_native",
                source_ref=f"page{page.number + 1}_xref{xref}",
                confidence=1.0,
            ))

    doc.close()
    logger.info(
        "native_image_extraction",
        extra={"source": "pdf", "count": len(images)},
    )
    return images


def extract_native_images(
    file_bytes: bytes, filename: str,
) -> list[SourceImagePayload]:
    """从文件中原生提取嵌入图片。

    - DOCX/PPTX: 从 ZIP 的 word/media/ 或 ppt/media/ 直接提取
    - PDF: 用 PyMuPDF 提取嵌入图片对象
    - 其他格式: 返回空列表（回退到 MinerU）

    Args:
        file_bytes: 原始文件字节
        filename: 文件名（用于判断格式）

    Returns:
        SourceImagePayload 列表，过滤掉了装饰性小图
    """
    fmt = _get_format_key(filename)
    if fmt and fmt in _MEDIA_PREFIXES:
        return _extract_from_office_zip(file_bytes, _MEDIA_PREFIXES[fmt])

    if filename.lower().endswith(".pdf"):
        return _extract_from_pdf(file_bytes)

    return []
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd agent-service && python -m pytest tests/agent/tools/test_native_image_extractor.py -v
```
Expected: 4 passed

- [ ] **Step 5: 提交**

```bash
git add agent-service/app/agent/tools/native_image_extractor.py agent-service/tests/agent/tools/test_native_image_extractor.py
git commit -m "feat(agent): add native image extractor for DOCX/PPTX/PDF"
```

---

## Task 2: VLM 独立配置 + 多图批量描述

**Files:**
- Modify: `agent-service/app/config.py`
- Modify: `agent-service/app/tools/vlm_understand.py`
- Test: `agent-service/tests/agent/tools/test_describe_images.py`

**目的：** 支持 `.env` 中 `AI_VLM_MODEL` / `AI_VLM_DRIVER` 独立配置 VLM 模型（便宜的 gemini-flash），并新增多图批量描述函数。

- [ ] **Step 1: config.py 增加 VLM 字段**

在 `Settings` 类中（`agent-service/app/config.py`）添加：

```python
# 在 agent_llm_api_url 之后添加
ai_vlm_model: str = ""
ai_vlm_driver: str = ""
ai_vlm_api_key: str = ""  # VLM 独立 API key，回退到 llm_api_key
```

新增属性：

```python
@property
def vlm_provider(self) -> str:
    """VLM 独立 provider，回退到 LLM provider。"""
    return self.ai_vlm_driver or self.llm_provider

@property
def vlm_model(self) -> str:
    """VLM 独立模型名，回退到 LLM 模型。"""
    return self.ai_vlm_model or self.llm_model

@property
def vlm_api_key(self) -> str:
    """VLM 独立 API key，回退到 LLM API key。"""
    return self.ai_vlm_api_key or self.llm_api_key
```

- [ ] **Step 2: 更新 vlm_understand.py 使用独立 VLM 配置**

修改 `_get_vlm()` 函数，使用 `settings.vlm_provider` 和 `settings.vlm_model`：

```python
def _get_vlm():
    """获取 VLM 模型实例（优先使用独立 VLM 配置）"""
    provider = settings.vlm_provider
    model = settings.vlm_model

    api_key = settings.vlm_api_key

    if provider in ("openai", "openai-compatible"):
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(
            model=model,
            api_key=api_key,
            base_url=settings.llm_api_url if provider == "openai-compatible" else None,
        )
    elif provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(model=model, google_api_key=settings.gemini_api_key or api_key)
    else:
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(model=model, api_key=api_key)
```

- [ ] **Step 3: 新增 `vlm_describe_batch` 函数**

在 `vlm_understand.py` 底部添加：

```python
def vlm_describe_batch(images_b64: list[tuple[str, str]]) -> list[str]:
    """一次 VLM 调用描述多张图片。

    Args:
        images_b64: [(b64_data, mime_type), ...] 列表

    Returns:
        与输入等长的描述字符串列表
    """
    if not images_b64:
        return []

    llm = _get_vlm()
    content = [
        {"type": "text", "text": (
            "以下是从文档中提取的图片。请为每张图片写一句简短描述（中文），"
            "说明图片展示的内容（如：PC端配置界面截图、手机端运行状态截图）。\n"
            "格式：每行一个，如 '1. PC端Clash导入配置界面'"
        )},
    ]
    for i, (b64, mime) in enumerate(images_b64):
        content.append({"type": "text", "text": f"\n图片 {i+1}:"})
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:{mime};base64,{b64}"},
        })

    message = HumanMessage(content=content)
    response = llm.invoke([message])
    raw = response.content or ""

    # 解析编号列表，回退到按行分割
    lines = [l.strip() for l in raw.strip().split("\n") if l.strip()]
    descriptions = []
    for i in range(len(images_b64)):
        found = False
        for line in lines:
            if line.startswith(f"{i+1}.") or line.startswith(f"{i+1}、"):
                desc = line.split(".", 1)[-1].split("、", 1)[-1].strip()
                descriptions.append(desc)
                found = True
                break
        if not found:
            descriptions.append(lines[i] if i < len(lines) else f"Image {i+1}")

    return descriptions
```

- [ ] **Step 4: 写测试**

```python
# tests/agent/tools/test_describe_images.py
from unittest.mock import patch, MagicMock


def test_vlm_describe_batch_parses_numbered_list():
    from app.tools.vlm_understand import vlm_describe_batch

    mock_response = MagicMock()
    mock_response.content = "1. PC端Clash配置界面\n2. 代理模式选择截图\n3. 系统代理启动界面"

    mock_llm = MagicMock()
    mock_llm.invoke.return_value = mock_response

    with patch("app.tools.vlm_understand._get_vlm", return_value=mock_llm):
        results = vlm_describe_batch([
            ("base64data1", "image/png"),
            ("base64data2", "image/jpeg"),
            ("base64data3", "image/png"),
        ])

    assert len(results) == 3
    assert "Clash配置" in results[0]
    assert "代理" in results[1]


def test_vlm_describe_batch_empty_input():
    from app.tools.vlm_understand import vlm_describe_batch
    assert vlm_describe_batch([]) == []
```

- [ ] **Step 5: 运行测试**

```bash
cd agent-service && python -m pytest tests/agent/tools/test_describe_images.py -v
```

- [ ] **Step 6: 提交**

```bash
git add agent-service/app/config.py agent-service/app/tools/vlm_understand.py agent-service/tests/agent/tools/test_describe_images.py
git commit -m "feat(agent): add independent VLM config and batch image description"
```

---

## Task 2.5: AgentDeps 增加 image_payloads 字段

**Files:**
- Modify: `agent-service/app/agent/deps.py`

**目的：** 让 extract_document 提取的图片 payloads 通过 deps 传递给 describe_images，避免重复提取。

- [ ] **Step 1: 在 AgentDeps 中添加 image_payloads 字段**

在 `deps.py` 的 `AgentDeps` dataclass 中，`uploaded_image_urls` 之后添加：

```python
# 原生提取的图片 payloads（extract_document 填充，describe_images 消费）
image_payloads: list = field(default_factory=list)
# 类型: list[SourceImagePayload]，用 list 避免循环导入
```

- [ ] **Step 2: 提交**

```bash
git add agent-service/app/agent/deps.py
git commit -m "feat(agent): add image_payloads to AgentDeps for cross-tool data sharing"
```

---

## Task 3: 重构 extract_document — 使用原生图片提取

**Files:**
- Modify: `agent-service/app/agent/tools/extract_document.py`
- Test: `agent-service/tests/agent/tools/test_extract_document.py`（更新现有测试）

**关键变更：**
1. 先尝试原生图片提取（zipfile/PyMuPDF），成功则替换 MinerU 图片
2. MinerU 仅用于文本（`full.md`），不再依赖其图片
3. 增强返回格式：文档摘要 + 图片元数据（尺寸、文件大小）

- [ ] **Step 1: 重写 extract_document_impl**

```python
# agent-service/app/agent/tools/extract_document.py
"""工具：从用户上传的文件中提取文本和图片。

图片提取策略：
- DOCX/PPTX: zipfile 原生提取 word/media/*（原始质量，零碎片）
- PDF: PyMuPDF 提取嵌入图片对象
- 兜底: MinerU 图片（仅当原生提取返回空时）
文本提取: 始终使用 MinerU（full.md 结构化文本）
"""
from __future__ import annotations

import asyncio
import base64
import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.agent.deps import AgentDeps

from pydantic_ai import RunContext

logger = logging.getLogger(__name__)


async def extract_document_impl(deps: "AgentDeps", purpose: str = "") -> str:
    """可测试的核心逻辑（不依赖 RunContext）。"""
    if not deps.files:
        return "[No Files] No files were uploaded. Ask the user to upload a document."

    try:
        from app.workers.asset_parser import parse_document
        from app.agent.tools.native_image_extractor import extract_native_images

        loop = asyncio.get_running_loop()

        # 1. MinerU 提取文本（并行处理所有文件）
        parse_tasks = [
            loop.run_in_executor(
                None, parse_document, f["content_b64"], f["filename"], f["mimetype"]
            )
            for f in deps.files
        ]
        results = await asyncio.wait_for(asyncio.gather(*parse_tasks), timeout=120)

        # 2. 原生提取图片（替代 MinerU 碎片图片）
        all_native_images = []
        for f in deps.files:
            try:
                file_bytes = base64.b64decode(f["content_b64"])
                native = extract_native_images(file_bytes, f["filename"])
                if native:
                    all_native_images.extend(native)
                    logger.info(
                        f"Native extraction: {len(native)} images from {f['filename']}"
                    )
            except Exception as e:
                logger.warning(f"Native image extraction failed for {f['filename']}: {e}")

        # 如果原生提取无结果，回退到 MinerU 图片
        if not all_native_images:
            for am in results:
                for item in getattr(am, "items", []):
                    if getattr(item, "type", "") == "image":
                        # MinerU 图片已是 AssetItem 格式，需转换
                        from app.models.source_assets import SourceImagePayload
                        content = getattr(item, "content", "")
                        if content.startswith("data:image/"):
                            _, b64 = content.split(",", 1)
                            all_native_images.append(SourceImagePayload(
                                index=len(all_native_images),
                                b64=b64,
                                desc=getattr(item, "caption", ""),
                                mime_type=getattr(item, "mime_type", "image/png"),
                                parser="mineru_fallback",
                                source_ref=getattr(item, "source_ref", ""),
                            ))

        # 3. 上传图片到 Docmost（如有 page_id）
        all_image_urls: dict[str, str] = {}
        image_metadata: list[dict] = []
        if deps.page_id and all_native_images:
            try:
                from app.tools.source_image_store import upload_source_image
                from PIL import Image as PILImage
                import io

                for img in all_native_images:
                    try:
                        img_bytes = base64.b64decode(img.b64)
                        # 获取像素尺寸
                        with PILImage.open(io.BytesIO(img_bytes)) as pil:
                            w, h = pil.size

                        # 上传
                        url = await loop.run_in_executor(
                            None,
                            upload_source_image,
                            deps.page_id,
                            img.b64,
                            f"image{img.index + 1}{_ext_for_mime(img.mime_type)}",
                            img.mime_type,
                        )

                        if url and not url.startswith("data:"):
                            ref = f"image{img.index + 1}"
                            all_image_urls[ref] = url
                            deps.uploaded_image_urls[ref] = url
                            image_metadata.append({
                                "ref": ref,
                                "url": url,
                                "width": w,
                                "height": h,
                                "size_kb": round(len(img_bytes) / 1024, 1),
                            })
                    except Exception as e:
                        logger.warning(f"Image upload failed for image{img.index + 1}: {e}")
            except Exception as img_err:
                logger.warning(f"Image upload pipeline failed (non-fatal): {img_err}")

        # 3b. 将图片 payloads 保存到 deps，供 describe_images 工具复用（避免重复提取）
        deps.image_payloads = all_native_images

        # 4. 构建文本内容
        text_parts = []
        for am in results:
            if getattr(am, "source_markdown", None):
                text_parts.append(am.source_markdown)
            else:
                for item in getattr(am, "items", []):
                    if getattr(item, "type", "") in ("text", "table", "code"):
                        text_parts.append(item.content)

        content = "\n\n".join(text_parts) or "No text content extracted."
        word_count = sum(len(p.split()) for p in text_parts)

        # 5. 构建增强返回格式
        doc_title = ""
        for am in results:
            t = getattr(am, "document_title", "")
            if t:
                doc_title = t
                break

        summary = f"[Document Summary]\nTitle: {doc_title or 'Untitled'}\nWords: {word_count}\nImages: {len(image_metadata)} uploaded"

        image_section = ""
        if image_metadata:
            lines = []
            for m in image_metadata:
                lines.append(
                    f"  {m['ref']}: ({m['width']}x{m['height']}, {m['size_kb']}KB) → {m['url']}"
                )
            image_section = (
                f"\n\n[Uploaded Images ({len(image_metadata)} total)]\n"
                + "\n".join(lines)
                + "\n\nIMPORTANT: Use these EXACT URLs as image src in your Markdown output."
                + "\nEvery URL above MUST appear in your final output."
                + "\nCall `describe_images` tool next to understand what each image shows,"
                + "\nthen place each image after the text it illustrates."
            )

        return f"{summary}{image_section}\n\n[Document Content]\n\n{content}"

    except asyncio.TimeoutError:
        return "[Error] Document extraction timed out after 120 seconds."
    except Exception as e:
        return f"[Error] Failed to extract document: {type(e).__name__}: {e}"


def _ext_for_mime(mime: str) -> str:
    return {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
    }.get(mime, ".png")


async def extract_document_tool(ctx: RunContext["AgentDeps"], purpose: str = "") -> str:
    """Extract text and images from uploaded document files.

    Call this when the user has uploaded PDF, DOCX, PPTX, or other document files.
    Extracts original embedded images (not layout-detected crops) and uploads them to Docmost.
    After calling this, call `describe_images` to understand image content before placing them.

    Args:
        purpose: What to focus on (e.g., "full content", "images only", "table data").
    """
    return await extract_document_impl(ctx.deps, purpose)
```

- [ ] **Step 2: 运行现有测试确认兼容**

```bash
cd agent-service && python -m pytest tests/agent/tools/test_extract_document.py -v
```

- [ ] **Step 3: 提交**

```bash
git add agent-service/app/agent/tools/extract_document.py
git commit -m "feat(agent): use native image extraction in extract_document tool"
```

---

## Task 4: 新增 describe_images 工具

**Files:**
- Create: `agent-service/app/agent/tools/describe_images.py`
- Modify: `agent-service/app/agent/tools/__init__.py`

**职责：** Agent 的第二步工具 — VLM 批量描述所有已提取的图片内容。

- [ ] **Step 1: 实现工具**

```python
# agent-service/app/agent/tools/describe_images.py
"""工具：VLM 批量描述已上传图片内容。

让 Agent 理解每张图片展示了什么，以便在 Markdown 中精确放置。
使用独立的 VLM 模型（如 gemini-flash），单次多图调用，成本极低。
"""
from __future__ import annotations

import asyncio
import base64
import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.agent.deps import AgentDeps

from pydantic_ai import RunContext

logger = logging.getLogger(__name__)


async def describe_images_impl(deps: "AgentDeps") -> str:
    """可测试的核心逻辑。"""
    if not deps.uploaded_image_urls:
        return "[No Images] No images have been uploaded. Call extract_document first."

    # 从 deps.image_payloads 获取图片数据（extract_document 已保存，避免重复提取）
    image_payloads = getattr(deps, "image_payloads", None) or []
    if not image_payloads:
        return "[No Images] No image data available. Call extract_document first."

    try:
        from app.tools.vlm_understand import vlm_describe_batch

        # 准备 VLM 输入（直接从 deps 读取，零重复提取）
        images_for_vlm = [(img.b64, img.mime_type) for img in image_payloads]

        # 单次多图 VLM 调用
        loop = asyncio.get_running_loop()
        descriptions = await loop.run_in_executor(
            None, vlm_describe_batch, images_for_vlm,
        )

        # 构建返回
        lines = []
        url_list = list(deps.uploaded_image_urls.values())
        for i, desc in enumerate(descriptions):
            url = url_list[i] if i < len(url_list) else "?"
            lines.append(f"  Image {i+1}: \"{desc}\" → {url}")

        return (
            f"[Image Descriptions ({len(descriptions)} images)]\n"
            + "\n".join(lines)
            + "\n\nUse these descriptions to place each image after the text it illustrates."
            + "\nExample: If Image 2 shows '代理模式选择', place it after the '选择代理模式' step."
        )

    except Exception as e:
        logger.warning(f"describe_images failed: {e}")
        return f"[Error] Failed to describe images: {type(e).__name__}: {e}"


async def describe_images_tool(ctx: RunContext["AgentDeps"]) -> str:
    """Understand the content of all uploaded document images using VLM.

    Call this AFTER extract_document to understand what each image shows.
    Returns a description for each image to help you place them correctly
    in your Markdown output.
    """
    return await describe_images_impl(ctx.deps)
```

- [ ] **Step 2: 注册到 ALL_TOOLS**

修改 `agent-service/app/agent/tools/__init__.py`：

```python
from app.agent.tools.extract_document import extract_document_tool
from app.agent.tools.describe_images import describe_images_tool
from app.agent.tools.scrape_url import scrape_url_tool
from app.agent.tools.search_web import search_web_tool
from app.agent.tools.read_page import read_page_tool

ALL_TOOLS = [
    extract_document_tool,
    describe_images_tool,
    scrape_url_tool,
    search_web_tool,
    read_page_tool,
]

__all__ = [
    "ALL_TOOLS",
    "extract_document_tool",
    "describe_images_tool",
    "scrape_url_tool",
    "search_web_tool",
    "read_page_tool",
]
```

- [ ] **Step 3: 运行全部测试**

```bash
cd agent-service && python -m pytest tests/agent/ -v -m "not e2e" --tb=short
```

- [ ] **Step 4: 提交**

```bash
git add agent-service/app/agent/tools/describe_images.py agent-service/app/agent/tools/__init__.py
git commit -m "feat(agent): add describe_images tool for VLM batch image understanding"
```

---

## Task 5: 更新 Skill 提示词 — 多步推理引导

**Files:**
- Modify: `agent-service/app/agent/skill.py`

- [ ] **Step 1: 更新 Multimodal Input Handling 和 Workflow 部分**

将 `skill.py` 中的 `## Multimodal Input Handling` 和 `## Workflow Protocol` 替换为：

```python
# 在 TIPTAP_CREATION_SKILL 中更新以下两段

## Workflow Protocol

1. **UNDERSTAND** the input — read the user's instruction and any uploaded content
2. **EXTRACT** content when files are uploaded:
   - Call `extract_document` tool FIRST → returns text + image metadata
   - Then call `describe_images` tool → returns VLM description for each image
3. **PLAN** image placement based on VLM descriptions:
   - Match each image description to the relevant section in the text
   - Example: "Image 2: PC端代理模式选择" → place after the proxy selection step
4. **GENERATE** formatted Markdown output following ALL rules below
5. **VERIFY** before finishing: every uploaded image URL appears in output

## Multimodal Input Handling

When the user uploads files (PDF, DOCX, PPTX, images):
1. Call `extract_document` tool — extracts text + uploads original images
2. Call `describe_images` tool — VLM describes each image's content
3. Use the descriptions to intelligently place images in your output
4. Do NOT try to read binary document content directly
5. Do NOT skip the `describe_images` step — you need to know what each image shows
   to place it correctly in the document
```

- [ ] **Step 2: 更新 Images 规则中的 alt text 指引**

```python
# 在 ### Images 部分更新
### Images

```markdown
![VLM description from describe_images tool](exact-docmost-url)
```

**Rules (MANDATORY):**
- Use ONLY URLs returned by the `extract_document` tool
- Use the VLM description from `describe_images` as the alt text
- Place each image IMMEDIATELY AFTER the text it illustrates
- Match image descriptions to text sections for correct placement
- NEVER stack all images at the document end
- NEVER omit any uploaded image — every URL from tool results MUST appear
```

- [ ] **Step 3: 运行 skill 测试**

```bash
cd agent-service && python -m pytest tests/agent/test_skill.py -v
```

- [ ] **Step 4: 提交**

```bash
git add agent-service/app/agent/skill.py
git commit -m "feat(agent): update skill prompt for multi-step reasoning with VLM"
```

---

## Task 6: SSE 进度事件增强

**Files:**
- Modify: `agent-service/app/agent/event_bridge.py`

**目的：** 新增 `tool_progress` 事件类型支持（前端 ToolCallStep 可展示子步骤）。

- [ ] **Step 1: 在 event_bridge.py 的 TOOL_DESCRIPTIONS 中添加新工具**

```python
TOOL_DESCRIPTIONS: dict[str, str] = {
    "extract_document_tool": "正在提取文档内容与图片...",
    "describe_images_tool": "正在理解图片内容...",
    "scrape_url_tool": "正在抓取网页内容...",
    "search_web_tool": "正在搜索相关信息...",
    "read_page_tool": "正在读取页面内容...",
}
```

- [ ] **Step 2: 提交**

```bash
git add agent-service/app/agent/event_bridge.py
git commit -m "feat(agent): add describe_images to SSE tool descriptions"
```

---

## Task 7: 图片自动尺寸（NestJS commit 管线）

**Files:**
- Create: `apps/server/src/ee/ai/ai-image-dimension-setter.ts`
- Modify: `apps/server/src/core/page/services/page.service.ts`
- Modify: `apps/server/package.json`（添加 sharp）

- [ ] **Step 1: 添加 sharp 依赖**

```bash
cd apps/server && pnpm add sharp @types/sharp
```

- [ ] **Step 2: 实现图片尺寸设置器**

```typescript
// apps/server/src/ee/ai/ai-image-dimension-setter.ts
import sharp from 'sharp';
import { StorageService } from '../../integrations/storage/storage.service';

/**
 * 页面内容宽度参考值（px）。
 * TipTap 编辑器实际渲染宽度约 720px。
 */
const PAGE_CONTENT_WIDTH = 720;

export interface ImageDimensionAttachment {
  id: string;
  fileName: string;
  filePath: string;
}

/**
 * 遍历 ProseMirror JSON 中的 image 节点，
 * 根据附件实际像素尺寸自动设置 width 和 aspectRatio。
 *
 * 策略:
 *  - 窄图（< 50% 页宽，如手机截图）→ 50%
 *  - 中等图（50%-100% 页宽）→ 按实际比例
 *  - 宽图（> 页宽）→ 100%
 */
export async function setAiImageDimensions(
  prosemirrorJson: any,
  attachments: ImageDimensionAttachment[],
  storageService: StorageService,
): Promise<{ document: any; updatedCount: number }> {
  if (!prosemirrorJson || !attachments.length) {
    return { document: prosemirrorJson, updatedCount: 0 };
  }

  const byId = new Map(attachments.map((a) => [a.id, a]));

  // 批量获取尺寸（并行，快速）
  const dimensionCache = new Map<string, { width: number; height: number }>();
  await Promise.all(
    attachments.map(async (att) => {
      try {
        const buffer = await storageService.read(att.filePath);
        const metadata = await sharp(buffer).metadata();
        if (metadata.width && metadata.height) {
          dimensionCache.set(att.id, {
            width: metadata.width,
            height: metadata.height,
          });
        }
      } catch {
        // 无法读取尺寸，跳过
      }
    }),
  );

  let updatedCount = 0;

  const visit = (node: any) => {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'image' && node.attrs?.attachmentId) {
      const dims = dimensionCache.get(node.attrs.attachmentId);
      if (dims) {
        // 设置 aspectRatio
        if (!node.attrs.aspectRatio) {
          node.attrs.aspectRatio = dims.width / dims.height;
        }

        // 智能宽度：仅对默认 100% 的图片调整
        if (!node.attrs.width || node.attrs.width === '100%') {
          if (dims.width < PAGE_CONTENT_WIDTH * 0.5) {
            node.attrs.width = '50%';
          } else if (dims.width < PAGE_CONTENT_WIDTH) {
            const pct = Math.round((dims.width / PAGE_CONTENT_WIDTH) * 100);
            node.attrs.width = `${Math.min(pct, 100)}%`;
          }
          // 宽图保持 100%
        }

        updatedCount++;
      }
    }

    if (Array.isArray(node.content)) {
      for (const child of node.content) {
        visit(child);
      }
    }
  };

  visit(prosemirrorJson);
  return { document: prosemirrorJson, updatedCount };
}
```

- [ ] **Step 3: 在 commitAiContent 中调用**

在 `page.service.ts` 中需要做两处修改：

**修改 1**: 将 `canonicalizeAiAttachmentImageNodes` 私有方法重构，暴露 attachments 查询结果：

```typescript
// 在 commitAiContent 方法中（约 line 324-335），替换现有的 canonicalize 调用为：
const pageAttachments = await this.attachmentRepo.findByPageId(currentPage.id);

let processedJson = parsedProsemirrorJson;

// Step 1: 规范化图片 URL 和 attachmentId
if (pageAttachments.length) {
  processedJson = canonicalizeAttachmentImageNodes(
    processedJson, pageAttachments,
  ).document;
}

// Step 2: 自动设置图片尺寸（新增）
import { setAiImageDimensions } from '../../ee/ai/ai-image-dimension-setter';

const dimensionResult = await setAiImageDimensions(
  processedJson,
  pageAttachments.map(a => ({
    id: a.id,
    fileName: a.fileName,
    filePath: a.filePath,
  })),
  this.storageService,  // 需确认 StorageService 已注入到 PageService
);
processedJson = dimensionResult.document;
```

**修改 2**: 如果 `StorageService` 未注入到 `PageService`，需要在构造函数中添加：

```typescript
constructor(
  // ... 现有依赖 ...
  private readonly storageService: StorageService,
) {}
```

并在 module 中确保 `StorageModule` 被导入。检查方法：搜索 `StorageService` 在 `page.module.ts` 中是否已注册。

注意：需要确认 `this.storageService` 是否已注入到 `PageService`。如果没有，需要在构造函数中注入。

- [ ] **Step 4: 编译验证**

```bash
cd apps/server && npx tsc --noEmit --pretty 2>&1 | head -20
```

- [ ] **Step 5: 提交**

```bash
git add apps/server/package.json apps/server/src/ee/ai/ai-image-dimension-setter.ts apps/server/src/core/page/services/page.service.ts
git commit -m "feat(server): auto-set image dimensions in AI commit pipeline"
```

---

## Task 8: 运行全部测试 + 端到端验证

- [ ] **Step 1: Python 测试**

```bash
cd agent-service && python -m pytest tests/agent/ -v -m "not e2e" --tb=short
```
Expected: 所有测试通过

- [ ] **Step 2: TypeScript 编译**

```bash
cd apps/client && npx tsc --noEmit --pretty 2>&1 | head -10
cd apps/server && npx tsc --noEmit --pretty 2>&1 | head -10
```

- [ ] **Step 3: 端到端冒烟验证**

重启 Agent Service 后，在浏览器中测试：

| TC | 操作 | 预期 |
|----|------|------|
| TC-01 | 上传 DOCX + "请优化排版" | Agent 调用 extract_document（原生提取 4-8 张图片）→ 调用 describe_images → 生成带图文的 Markdown |
| TC-02 | 检查 ToolCallStep | 显示"正在提取文档内容与图片..."和"正在理解图片内容..." |
| TC-03 | 检查流式预览中的图片 | 图片正常显示（`/api/files/...` 路径），无碎片小图 |
| TC-04 | 点击"应用到页面" | 编辑器中图片正确显示 + 手机截图 50% 宽 + PC 截图 100% 宽 |
| TC-05 | 上传 PDF 文件 | 同样的效果（PyMuPDF 提取） |

- [ ] **Step 4: 修复发现的问题**

- [ ] **Step 5: 最终提交**

```bash
git add -A && git commit -m "fix(agent): address Phase 3 smoke test issues"
```

---

## 任务依赖图与执行顺序

```
Task 0 (pymupdf 依赖) ← 无依赖
  ↓
Task 1 (原生图片提取器) ← Task 0
  ↓
Task 2 (VLM 独立配置 + 批量描述) ← 无依赖（可与 Task 1 并行）
  ↓
Task 3 (重构 extract_document) ← Task 1
  ↓
Task 4 (describe_images 工具) ← Task 2, Task 3
  ↓
Task 5 (Skill 提示词) ← Task 4
  ↓
Task 6 (SSE 事件) ← Task 4
  ↓
Task 7 (图片自动尺寸) ← 无依赖（NestJS 独立）
  ↓
Task 8 (端到端验证) ← 全部
```

**推荐执行顺序：**
1. Task 0（pymupdf 依赖）
2. Task 1 + Task 2（并行：原生提取 + VLM 配置）
3. Task 3（重构 extract_document）
4. Task 4（describe_images 工具）
5. Task 5 + Task 6（并行：Skill + SSE）
6. Task 7（图片自动尺寸，NestJS 独立）
7. Task 8（端到端验证）
