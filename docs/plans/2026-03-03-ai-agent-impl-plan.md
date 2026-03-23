# AI Agent 智能体重构 实施计划

> **对于Claude：** 必须使用的子技能：使用超能力：executing-plans来逐个任务地实施该计划。

**目标：** 将 Docmost AI 助手升级为 LangGraph 驱动的自主智能体，具备文档解析、深度调研、图片生成/标注、上下文感知修改能力。

**架构：**独立Python FastAPI微服务（LangGraph Agent Core + 9工具）+ NestJS网关层（认证/转发/SSE代理）+前置轻量增强（步骤推进嵌入气泡）。

**技术栈：** Python 3.12、FastAPI、LangGraph、Docling、Tavily、Firecrawl、Pillow、NestJS、React/Jotai/Mantine

**设计文档：** `docs/plans/2026-03-03-ai-agent-architecture-design.md`

---

## 阶段 1: Agent Service 项目脚手架

### 任务 1.1: 创建 Python 项目结构

**文件：**
- 创建：`agent-service/pyproject.toml`
- 创建：`agent-service/app/__init__.py`
- 创建：`agent-service/app/config.py`
- 创建：`agent-service/tests/__init__.py`
- 创建：`agent-service/tests/conftest.py`

**第 1 步：创建项目目录和pyproject.toml**

```toml
# agent-service/pyproject.toml
[project]
name = "docmost-agent"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "fastapi>=0.115",
    "uvicorn[standard]>=0.32",
    "langgraph>=0.2",
    "langchain-core>=0.3",
    "langchain-openai>=0.2",
    "langchain-google-genai>=2.0",
    "docling>=2.0",
    "firecrawl-py>=1.0",
    "tavily-python>=0.5",
    "Pillow>=10.0",
    "httpx>=0.27",
    "sse-starlette>=2.0",
    "pydantic>=2.0",
    "pydantic-settings>=2.0",
]

[project.optional-dependencies]
dev = ["pytest>=8.0", "pytest-asyncio>=0.24", "httpx"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

**步骤 2：创建配置模块（双层配置）**

```python
# agent-service/app/config.py
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # 双层 LLM 配置：AGENT_* 优先，否则回退到 Docmost 的 AI_* 配置
    ai_driver: str = "openai"
    ai_completion_model: str = "gpt-4"
    openai_api_key: str = ""
    openai_api_url: str = "https://api.openai.com/v1"
    gemini_api_key: str = ""

    agent_llm_provider: str = ""
    agent_llm_model: str = ""
    agent_llm_api_key: str = ""
    agent_llm_api_url: str = ""

    # 工具 API Keys
    tavily_api_key: str = ""
    firecrawl_api_key: str = ""
    firecrawl_api_url: str = "https://api.firecrawl.dev"
    nanobana_api_key: str = ""

    # 内部通信
    agent_internal_secret: str = ""
    docmost_internal_url: str = "http://docmost:3000"

    # 运行配置
    agent_max_iterations: int = 3

    @property
    def llm_provider(self) -> str:
        return self.agent_llm_provider or self.ai_driver

    @property
    def llm_model(self) -> str:
        return self.agent_llm_model or self.ai_completion_model

    @property
    def llm_api_key(self) -> str:
        return self.agent_llm_api_key or self.openai_api_key

    @property
    def llm_api_url(self) -> str:
        return self.agent_llm_api_url or self.openai_api_url

    model_config = {"env_file": ".env", "extra": "ignore"}

settings = Settings()
```

**第 3 步：创建空的 __init__ 和 conftest**

```python
# agent-service/app/__init__.py
# (empty)

# agent-service/tests/__init__.py
# (empty)

# agent-service/tests/conftest.py
import pytest
from app.config import Settings

@pytest.fixture
def test_settings():
    return Settings(
        ai_driver="openai",
        ai_completion_model="gpt-4",
        openai_api_key="test-key",
        agent_internal_secret="test-secret",
        tavily_api_key="test-tavily",
        firecrawl_api_key="test-firecrawl",
        nanobana_api_key="test-nanobana",
    )
```

**第 4 步：承诺**

```bash
git add agent-service/
git commit -m "feat(agent): scaffold Python agent-service project with config"
```

---

### 任务 1.2: FastAPI 入口 + 健康检查 + 认证中间件

**文件：**
- 创建：`agent-service/app/main.py`
- 创建：`agent-service/app/middleware/__init__.py`
- 创建：`agent-service/app/middleware/auth.py`
- 创建：`agent-service/tests/test_main.py`

**步骤 1：创建认证中间件**

```python
# agent-service/app/middleware/__init__.py
# (empty)

# agent-service/app/middleware/auth.py
from fastapi import Request, HTTPException

from app.config import settings

async def verify_internal_secret(request: Request):
    """验证来自 NestJS 网关的内部通信密钥"""
    secret = request.headers.get("X-Internal-Secret", "")
    if secret != settings.agent_internal_secret:
        raise HTTPException(status_code=401, detail="Invalid internal secret")
```

**第 2 步：创建FastAPI入口**

```python
# agent-service/app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Docmost Agent Service", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {"status": "ok", "service": "docmost-agent"}
```

**步骤 3：写测试**

```python
# agent-service/tests/test_main.py
import pytest
from httpx import ASGITransport, AsyncClient
from app.main import app

@pytest.mark.asyncio
async def test_health():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
```

**第 4 步：承诺**

```bash
git add agent-service/
git commit -m "feat(agent): add FastAPI entry point with health check and auth middleware"
```

---

### 任务 1.3: Pydantic 请求/响应 Schema

**文件：**
- 创建：`agent-service/app/schemas/__init__.py`
- 创建：`agent-service/app/schemas/request.py`
- 创建：`agent-service/app/schemas/response.py`

**第 1 步：请求架构**

```python
# agent-service/app/schemas/__init__.py
# (empty)

# agent-service/app/schemas/request.py
from pydantic import BaseModel

class FileInfo(BaseModel):
    filename: str
    mimetype: str
    content_b64: str

class PageContext(BaseModel):
    page_id: str | None = None
    page_title: str | None = None
    page_content: str | None = None
    selected_text: str | None = None
    selection_range: dict | None = None

class AgentRunRequest(BaseModel):
    user_message: str
    files: list[FileInfo] = []
    page_context: PageContext = PageContext()
    template_id: str | None = None
    conversation_history: list[dict] = []
    workspace_id: str = ""
    config: dict = {}

class AgentStopRequest(BaseModel):
    task_id: str
```

**步骤 2：响应/SSE 事件架构**

```python
# agent-service/app/schemas/response.py
from pydantic import BaseModel
from typing import Literal

class StepStartEvent(BaseModel):
    type: Literal["step_start"] = "step_start"
    step: str
    description: str

class StepDoneEvent(BaseModel):
    type: Literal["step_done"] = "step_done"
    step: str
    result_summary: str

class ContentEvent(BaseModel):
    type: Literal["content"] = "content"
    chunk: str

class ImageEvent(BaseModel):
    type: Literal["image"] = "image"
    url: str
    alt: str

class ToolCallEvent(BaseModel):
    type: Literal["tool_call"] = "tool_call"
    tool: str
    args: dict = {}

class ErrorEvent(BaseModel):
    type: Literal["error"] = "error"
    message: str

class DoneEvent(BaseModel):
    type: Literal["done"] = "done"
    final_content: str
    insert_mode: str = "create"

SSEEvent = StepStartEvent | StepDoneEvent | ContentEvent | ImageEvent | ToolCallEvent | ErrorEvent | DoneEvent
```

**第 3 步：承诺**

```bash
git add agent-service/app/schemas/
git commit -m "feat(agent): add Pydantic request/response schemas for agent API"
```

---

## 阶段 2: Agent 工具实现

### 任务 2.1: 工具注册表 + Tavily 搜索工具

**文件：**
- 创建：`agent-service/app/tools/__init__.py`
- 创建：`agent-service/app/tools/registry.py`
- 创建：`agent-service/app/tools/tavily_search.py`
- 创建：`agent-service/tests/test_tools/__init__.py`
- 创建：`agent-service/tests/test_tools/test_tavily.py`

**步骤 1：工具注册表**

```python
# agent-service/app/tools/__init__.py
# (empty)

# agent-service/app/tools/registry.py
from langchain_core.tools import BaseTool

_registry: dict[str, BaseTool] = {}

def register_tool(tool: BaseTool):
    _registry[tool.name] = tool
    return tool

def get_all_tools() -> list[BaseTool]:
    return list(_registry.values())

def get_tool(name: str) -> BaseTool | None:
    return _registry.get(name)

def get_tool_names() -> list[str]:
    return list(_registry.keys())
```

**第 2 步：Tavilly 搜索工具**

```python
# agent-service/app/tools/tavily_search.py
from langchain_core.tools import tool
from tavily import TavilyClient

from app.config import settings
from app.tools.registry import register_tool

@register_tool
@tool
def tavily_search(query: str, max_results: int = 5) -> str:
    """搜索网络获取最新信息。返回搜索结果的标题、摘要和链接。"""
    client = TavilyClient(api_key=settings.tavily_api_key)
    results = client.search(query=query, max_results=max_results)
    output_parts = []
    for r in results.get("results", []):
        output_parts.append(f"**{r['title']}**\n{r['content']}\nURL: {r['url']}\n")
    return "\n---\n".join(output_parts) if output_parts else "未找到相关结果。"
```

**第 3 步：承诺**

```bash
git add agent-service/app/tools/ agent-service/tests/test_tools/
git commit -m "feat(agent): add tool registry and tavily_search tool"
```

---

### 任务 2.2: Firecrawl 爬取工具

**文件：**
- 创建：`agent-service/app/tools/firecrawl_scrape.py`

**步骤 1：实现**

```python
# agent-service/app/tools/firecrawl_scrape.py
from langchain_core.tools import tool
from firecrawl import FirecrawlApp

from app.config import settings
from app.tools.registry import register_tool

@register_tool
@tool
def firecrawl_scrape(url: str) -> str:
    """爬取指定 URL 的网页内容，返回结构化 Markdown。"""
    client = FirecrawlApp(api_key=settings.firecrawl_api_key, api_url=settings.firecrawl_api_url)
    result = client.scrape_url(url, params={"formats": ["markdown"]})
    return result.get("markdown", "无法提取页面内容。")
```

**第 2 步：承诺**

```bash
git add agent-service/app/tools/firecrawl_scrape.py
git commit -m "feat(agent): add firecrawl_scrape tool"
```

---

### 任务 2.3: Docling 文档解析工具

**文件：**
- 创建：`agent-service/app/tools/docling_parser.py`

**步骤 1：实现**

```python
# agent-service/app/tools/docling_parser.py
import base64
import tempfile
from pathlib import Path

from langchain_core.tools import tool

from app.tools.registry import register_tool

@register_tool
@tool
def docling_parser(file_content_b64: str, filename: str, mimetype: str) -> str:
    """解析文档文件，返回 Markdown 格式文本。
    支持: PDF, Word(.docx), Excel(.xlsx), TXT, HTML, Markdown, Image(OCR)。
    """
    from docling.document_converter import DocumentConverter

    file_bytes = base64.b64decode(file_content_b64)

    with tempfile.NamedTemporaryFile(suffix=Path(filename).suffix, delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    try:
        converter = DocumentConverter()
        result = converter.convert(tmp_path)
        md = result.document.export_to_markdown()
        return f"[Document: {filename}]\n\n{md}"
    finally:
        Path(tmp_path).unlink(missing_ok=True)
```

**第 2 步：承诺**

```bash
git add agent-service/app/tools/docling_parser.py
git commit -m "feat(agent): add docling_parser tool for multi-format document parsing"
```

---

### 任务 2.4: 图片生成 + 图片标注 + 图片理解工具

**文件：**
- 创建：`agent-service/app/tools/nanobana_imggen.py`
- 创建：`agent-service/app/tools/image_annotate.py`
- 创建：`agent-service/app/tools/vlm_understand.py`

**步骤 1：图片生成**

```python
# agent-service/app/tools/nanobana_imggen.py
import httpx
from langchain_core.tools import tool

from app.config import settings
from app.tools.registry import register_tool

@register_tool
@tool
def nanobana_imggen(prompt: str, style: str = "default") -> str:
    """根据文字描述生成图片。返回图片的 base64 数据。"""
    resp = httpx.post(
        "https://api.nanobana.com/v2/generate",
        headers={"Authorization": f"Bearer {settings.nanobana_api_key}"},
        json={"prompt": prompt, "style": style},
        timeout=60.0,
    )
    resp.raise_for_status()
    data = resp.json()
    return data.get("image_b64", "")
```

**步骤 2：图片标注**

```python
# agent-service/app/tools/image_annotate.py
import base64
import io

from langchain_core.tools import tool
from PIL import Image, ImageDraw, ImageFont

from app.tools.registry import register_tool

@register_tool
@tool
def image_annotate(image_b64: str, annotations: list[dict]) -> str:
    """对图片进行标注（添加箭头、文字、框选、高亮），返回标注后图片的 base64。

    annotations 格式示例:
    [
      {"type": "box", "params": {"x": 10, "y": 10, "w": 100, "h": 50, "color": "red"}},
      {"type": "text", "params": {"x": 10, "y": 70, "text": "注释", "color": "red", "size": 20}},
      {"type": "arrow", "params": {"x1": 50, "y1": 50, "x2": 150, "y2": 150, "color": "red"}},
      {"type": "highlight", "params": {"x": 10, "y": 10, "w": 100, "h": 50, "color": "yellow", "alpha": 80}}
    ]
    """
    img_bytes = base64.b64decode(image_b64)
    img = Image.open(io.BytesIO(img_bytes)).convert("RGBA")
    draw = ImageDraw.Draw(img)

    for ann in annotations:
        t = ann.get("type", "")
        p = ann.get("params", {})
        color = p.get("color", "red")

        if t == "box":
            draw.rectangle([p["x"], p["y"], p["x"] + p["w"], p["y"] + p["h"]], outline=color, width=2)
        elif t == "text":
            try:
                font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", p.get("size", 16))
            except (OSError, IOError):
                font = ImageFont.load_default()
            draw.text((p["x"], p["y"]), p["text"], fill=color, font=font)
        elif t == "arrow":
            draw.line([(p["x1"], p["y1"]), (p["x2"], p["y2"])], fill=color, width=2)
            # Simple arrowhead
            draw.polygon([(p["x2"], p["y2"]), (p["x2"] - 8, p["y2"] - 8), (p["x2"] + 8, p["y2"] - 8)], fill=color)
        elif t == "highlight":
            overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
            overlay_draw = ImageDraw.Draw(overlay)
            alpha = p.get("alpha", 80)
            # Parse named color to RGB tuple for highlight
            from PIL import ImageColor
            rgb = ImageColor.getrgb(color)
            overlay_draw.rectangle([p["x"], p["y"], p["x"] + p["w"], p["y"] + p["h"]], fill=(*rgb, alpha))
            img = Image.alpha_composite(img, overlay)
            draw = ImageDraw.Draw(img)

    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()
```

**步骤 3：图像理解 (VLM)**

```python
# agent-service/app/tools/vlm_understand.py
import base64

from langchain_core.tools import tool
from langchain_core.messages import HumanMessage

from app.config import settings
from app.tools.registry import register_tool

def _get_vlm():
    """获取 VLM 模型实例"""
    provider = settings.llm_provider
    model = settings.llm_model  # VLM 复用主模型（通常支持多模态）

    if provider in ("openai", "openai-compatible"):
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(
            model=model,
            api_key=settings.llm_api_key,
            base_url=settings.llm_api_url if provider == "openai-compatible" else None,
        )
    elif provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(model=model, google_api_key=settings.gemini_api_key)
    else:
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(model=model, api_key=settings.llm_api_key)

@register_tool
@tool
def vlm_understand(image_b64: str, question: str = "描述这张图片的内容") -> str:
    """使用视觉语言模型理解图片内容。返回图片的文字描述。"""
    llm = _get_vlm()
    message = HumanMessage(content=[
        {"type": "text", "text": question},
        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_b64}"}},
    ])
    response = llm.invoke([message])
    return response.content
```

**第 4 步：承诺**

```bash
git add agent-service/app/tools/nanobana_imggen.py agent-service/app/tools/image_annotate.py agent-service/app/tools/vlm_understand.py
git commit -m "feat(agent): add image tools (generation, annotation, VLM understanding)"
```

---

### 任务 2.5: Docmost API 交互工具 (page_read + rag + upload)

**文件：**
- 创建：`agent-service/app/tools/docmost_api.py`

**第 1 步：实现三个Docmost API工具**

```python
# agent-service/app/tools/docmost_api.py
import base64
import httpx
from langchain_core.tools import tool

from app.config import settings
from app.tools.registry import register_tool

def _docmost_post(path: str, json_body: dict, headers: dict | None = None) -> dict:
    """调用 Docmost 内部 API"""
    url = f"{settings.docmost_internal_url}/api{path}"
    h = {"X-Internal-Secret": settings.agent_internal_secret, **(headers or {})}
    resp = httpx.post(url, json=json_body, headers=h, timeout=30.0)
    resp.raise_for_status()
    return resp.json().get("data", resp.json())

@register_tool
@tool
def docmost_page_read(page_id: str) -> str:
    """读取 Docmost 系统中指定页面的 Markdown 内容。"""
    data = _docmost_post("/pages/details", {"pageId": page_id})
    title = data.get("title", "")
    content = data.get("content", "")
    return f"# {title}\n\n{content}" if content else f"页面 {page_id} 内容为空。"

@register_tool
@tool
def docmost_rag(query: str, space_id: str | None = None, top_k: int = 5) -> str:
    """在 Docmost 知识库中进行语义搜索，返回相关页面片段。"""
    body: dict = {"query": query, "limit": top_k}
    if space_id:
        body["spaceId"] = space_id
    data = _docmost_post("/ai/answers", body)
    # data 可能是流式的，这里简化处理
    if isinstance(data, list):
        parts = [f"**{item.get('title', '')}**\n{item.get('content', '')}" for item in data]
        return "\n---\n".join(parts) if parts else "未找到相关内容。"
    return str(data)

@register_tool
@tool
def docmost_upload(file_content_b64: str, filename: str, page_id: str) -> str:
    """上传文件/图片到 Docmost 存储，返回可在文档中引用的 URL。"""
    file_bytes = base64.b64decode(file_content_b64)
    url = f"{settings.docmost_internal_url}/api/attachments/upload-image"
    files = {"file": (filename, file_bytes, "image/png")}
    data = {"pageId": page_id}
    h = {"X-Internal-Secret": settings.agent_internal_secret}
    resp = httpx.post(url, files=files, data=data, headers=h, timeout=30.0)
    resp.raise_for_status()
    result = resp.json().get("data", resp.json())
    return result.get("url", result.get("filePath", "上传失败"))
```

**第 2 步：承诺**

```bash
git add agent-service/app/tools/docmost_api.py
git commit -m "feat(agent): add Docmost API tools (page_read, rag, upload)"
```

---

## 阶段 3: LangGraph Agent 核心

### 任务 3.1: Agent 状态定义

**文件：**
- 创建：`agent-service/app/agent/__init__.py`
- 创建：`agent-service/app/agent/state.py`

**步骤 1：实现**

```python
# agent-service/app/agent/__init__.py
# (empty)

# agent-service/app/agent/state.py
from typing import TypedDict, Literal, Annotated
from langgraph.graph.message import add_messages

class PlanStep(TypedDict):
    step_id: int
    action: str           # "search" | "parse" | "crawl" | "generate" | "image" | "annotate" | "review"
    description: str
    tool: str | None
    args: dict | None
    status: str           # "pending" | "running" | "done" | "skipped"

class AgentState(TypedDict):
    # 用户输入
    user_message: str
    conversation_history: list[dict]
    uploaded_files: list[dict]
    template_id: str | None

    # 文档上下文
    page_id: str | None
    page_title: str | None
    page_content: str | None
    selected_text: str | None
    selection_range: dict | None
    insert_mode: str  # "create" | "append" | "replace"

    # Agent 工作状态
    plan: list[PlanStep]
    current_step: int
    research_results: list[dict]
    parsed_files: list[dict]
    generated_images: list[dict]

    # 输出
    draft_content: str
    final_content: str
    step_events: list[dict]

    # 控制
    needs_revision: bool
    revision_feedback: str
    iteration_count: int
    max_iterations: int
```

**第 2 步：承诺**

```bash
git add agent-service/app/agent/
git commit -m "feat(agent): define AgentState for LangGraph"
```

---

### 任务 3.2: LLM 工厂函数

**文件：**
- 创建：`agent-service/app/agent/llm.py`

**步骤 1：实现**

```python
# agent-service/app/agent/llm.py
from langchain_core.language_models import BaseChatModel
from app.config import settings

def get_chat_model() -> BaseChatModel:
    """根据配置返回 LLM 实例"""
    provider = settings.llm_provider
    model = settings.llm_model

    if provider in ("openai", "openai-compatible"):
        from langchain_openai import ChatOpenAI
        kwargs = {"model": model, "api_key": settings.llm_api_key, "streaming": True}
        if provider == "openai-compatible":
            kwargs["base_url"] = settings.llm_api_url
        return ChatOpenAI(**kwargs)
    elif provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(
            model=model, google_api_key=settings.gemini_api_key, streaming=True
        )
    else:
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(model=model, api_key=settings.llm_api_key, streaming=True)
```

**第 2 步：承诺**

```bash
git add agent-service/app/agent/llm.py
git commit -m "feat(agent): add LLM factory with dual-layer config"
```

---

### 任务 3.3: Planner 节点

**文件：**
- 创建：`agent-service/app/agent/nodes/__init__.py`
- 创建：`agent-service/app/agent/nodes/planner.py`

**步骤 1：实现**

```python
# agent-service/app/agent/nodes/__init__.py
# (empty)

# agent-service/app/agent/nodes/planner.py
import json
from langchain_core.messages import SystemMessage, HumanMessage
from app.agent.llm import get_chat_model
from app.agent.state import AgentState
from app.tools.registry import get_tool_names

PLANNER_SYSTEM_PROMPT = """你是一个智能文档助手的规划器。你的任务是分析用户的请求，并制定一个多步骤执行计划。

可用工具: {tools}

根据用户的请求和上下文，输出一个 JSON 数组格式的执行计划。每个步骤包含:
- step_id: 步骤编号（从 1 开始）
- action: 动作类型（search/parse/crawl/generate/image/annotate/review）
- description: 步骤描述（中文）
- tool: 要使用的工具名（从可用工具中选择，或 null）
- args: 工具参数提示（dict 或 null）

规则:
1. 如果用户上传了文件，必须包含 parse 步骤
2. 如果需要外部知识，包含 search 步骤
3. 如果用户提供了 URL，包含 crawl 步骤
4. 最后一步必须是 generate（生成文档内容）
5. 如果需要图片，在 generate 之后加 image 步骤
6. 计划应精简，不超过 8 个步骤

仅输出 JSON 数组，不要输出其他内容。"""

async def planner_node(state: AgentState) -> dict:
    """分析用户意图，制定执行计划"""
    llm = get_chat_model()
    tools = get_tool_names()

    context_parts = []
    if state.get("page_title"):
        context_parts.append(f"当前页面标题: {state['page_title']}")
    if state.get("selected_text"):
        context_parts.append(f"用户选中的文本: {state['selected_text'][:500]}")
    if state.get("uploaded_files"):
        file_names = [f["filename"] for f in state["uploaded_files"]]
        context_parts.append(f"上传的文件: {', '.join(file_names)}")
    if state.get("revision_feedback"):
        context_parts.append(f"上次修订反馈: {state['revision_feedback']}")

    context = "\n".join(context_parts) if context_parts else "无额外上下文"

    user_prompt = f"""用户请求: {state['user_message']}

上下文信息:
{context}

请制定执行计划。"""

    messages = [
        SystemMessage(content=PLANNER_SYSTEM_PROMPT.format(tools=", ".join(tools))),
        HumanMessage(content=user_prompt),
    ]

    response = await llm.ainvoke(messages)
    try:
        plan = json.loads(response.content)
    except json.JSONDecodeError:
        # 降级：简单生成计划
        plan = [
            {"step_id": 1, "action": "generate", "description": "生成文档内容", "tool": None, "args": None}
        ]

    # 设置所有步骤状态为 pending
    for step in plan:
        step["status"] = "pending"

    step_events = [{"type": "step_start", "step": "plan", "description": "正在分析需求并制定计划..."}]
    step_events.append({"type": "step_done", "step": "plan", "result_summary": f"制定了 {len(plan)} 步执行计划"})

    return {
        "plan": plan,
        "current_step": 0,
        "step_events": state.get("step_events", []) + step_events,
        "iteration_count": state.get("iteration_count", 0) + 1,
    }
```

**第 2 步：承诺**

```bash
git add agent-service/app/agent/nodes/
git commit -m "feat(agent): add planner node with structured plan output"
```

---

### 任务 3.4: Researcher 节点

**文件：**
- 创建：`agent-service/app/agent/nodes/researcher.py`

**步骤 1：实现**

```python
# agent-service/app/agent/nodes/researcher.py
from app.agent.state import AgentState
from app.tools.registry import get_tool

RESEARCH_ACTIONS = {"search", "parse", "crawl"}

async def researcher_node(state: AgentState) -> dict:
    """执行计划中的调研步骤：文件解析、网络搜索、网页爬取"""
    plan = state.get("plan", [])
    research_results = list(state.get("research_results", []))
    parsed_files = list(state.get("parsed_files", []))
    step_events = list(state.get("step_events", []))

    for step in plan:
        if step["action"] not in RESEARCH_ACTIONS:
            continue
        if step["status"] == "done":
            continue

        step["status"] = "running"
        step_events.append({
            "type": "step_start",
            "step": step["action"],
            "description": step["description"],
        })

        tool_name = step.get("tool")
        tool_fn = get_tool(tool_name) if tool_name else None
        result_summary = "跳过（无匹配工具）"

        try:
            if step["action"] == "parse" and tool_fn:
                # 解析上传的文件
                for f in state.get("uploaded_files", []):
                    result = await tool_fn.ainvoke({
                        "file_content_b64": f["content_b64"],
                        "filename": f["filename"],
                        "mimetype": f["mimetype"],
                    })
                    parsed_files.append({"filename": f["filename"], "content": result})
                result_summary = f"解析了 {len(state.get('uploaded_files', []))} 个文件"

            elif step["action"] == "search" and tool_fn:
                args = step.get("args", {}) or {}
                query = args.get("query", state["user_message"])
                result = await tool_fn.ainvoke({"query": query, "max_results": 5})
                research_results.append({"source": "search", "query": query, "content": result})
                result_summary = "搜索完成"

            elif step["action"] == "crawl" and tool_fn:
                args = step.get("args", {}) or {}
                url = args.get("url", "")
                if url:
                    result = await tool_fn.ainvoke({"url": url})
                    research_results.append({"source": "crawl", "url": url, "content": result})
                    result_summary = f"爬取了 {url}"

            step["status"] = "done"
        except Exception as e:
            step["status"] = "skipped"
            result_summary = f"失败: {str(e)[:100]}"
            step_events.append({"type": "error", "message": f"工具 {tool_name} 调用失败: {str(e)[:200]}"})

        step_events.append({
            "type": "step_done",
            "step": step["action"],
            "result_summary": result_summary,
        })

    return {
        "plan": plan,
        "research_results": research_results,
        "parsed_files": parsed_files,
        "step_events": step_events,
    }
```

**第 2 步：承诺**

```bash
git add agent-service/app/agent/nodes/researcher.py
git commit -m "feat(agent): add researcher node (file parsing, search, crawl)"
```

---

### 任务 3.5: Executor 节点

**文件：**
- 创建：`agent-service/app/agent/nodes/executor.py`

**步骤 1：实现**

```python
# agent-service/app/agent/nodes/executor.py
from langchain_core.messages import SystemMessage, HumanMessage
from app.agent.llm import get_chat_model
from app.agent.state import AgentState

EXECUTOR_SYSTEM_PROMPT = """你是一个专业的文档写作智能体。根据用户的指令和提供的调研资料，生成高质量的 Markdown 文档。

规则:
1. 输出纯 Markdown 格式
2. 使用清晰的标题层级（## 二级标题, ### 三级标题）
3. 内容详实、有条理、专业
4. 如果有引用来源，在文末标注
5. 如果用户要求修改选中的文本，只输出修改后的文本（不要输出整个文档）
6. 图片位置用占位符标记: ![描述](IMAGE_PLACEHOLDER_N)"""

async def executor_node(state: AgentState) -> dict:
    """综合调研结果，生成文档内容"""
    llm = get_chat_model()
    step_events = list(state.get("step_events", []))

    step_events.append({"type": "step_start", "step": "generate", "description": "正在生成文档内容..."})

    # 构建调研摘要
    research_summary_parts = []
    for item in state.get("parsed_files", []):
        research_summary_parts.append(f"[文件: {item['filename']}]\n{item['content'][:3000]}")
    for item in state.get("research_results", []):
        research_summary_parts.append(f"[来源: {item.get('source', 'unknown')}]\n{item['content'][:2000]}")

    research_summary = "\n\n---\n\n".join(research_summary_parts) if research_summary_parts else "无额外调研资料。"

    # 构建用户消息
    user_parts = [f"用户请求: {state['user_message']}"]

    if state.get("page_content"):
        user_parts.append(f"\n当前页面内容:\n{state['page_content'][:5000]}")
    if state.get("selected_text"):
        user_parts.append(f"\n用户选中的文本（仅修改此部分）:\n{state['selected_text']}")
    if research_summary_parts:
        user_parts.append(f"\n调研资料:\n{research_summary}")
    if state.get("revision_feedback"):
        user_parts.append(f"\n上次修订反馈:\n{state['revision_feedback']}")
        user_parts.append(f"\n上次草稿:\n{state.get('draft_content', '')[:5000]}")

    # 对话历史
    messages = [SystemMessage(content=EXECUTOR_SYSTEM_PROMPT)]
    for msg in state.get("conversation_history", [])[-6:]:
        if msg["role"] == "user":
            messages.append(HumanMessage(content=msg["content"]))
    messages.append(HumanMessage(content="\n".join(user_parts)))

    # 流式生成
    content_chunks = []
    async for chunk in llm.astream(messages):
        text = chunk.content
        if text:
            content_chunks.append(text)
            step_events.append({"type": "content", "chunk": text})

    draft_content = "".join(content_chunks)

    step_events.append({"type": "step_done", "step": "generate", "result_summary": f"生成了 {len(draft_content)} 字符"})

    return {
        "draft_content": draft_content,
        "step_events": step_events,
    }
```

**第 2 步：承诺**

```bash
git add agent-service/app/agent/nodes/executor.py
git commit -m "feat(agent): add executor node with streaming content generation"
```

---

### 任务 3.6: Reviewer 节点

**文件：**
- 创建：`agent-service/app/agent/nodes/reviewer.py`

**步骤 1：实现**

```python
# agent-service/app/agent/nodes/reviewer.py
import json
from langchain_core.messages import SystemMessage, HumanMessage
from app.agent.llm import get_chat_model
from app.agent.state import AgentState

REVIEWER_SYSTEM_PROMPT = """你是一个文档质量审查专家。审查生成的文档是否满足用户需求。

输出 JSON 格式:
{
  "approved": true/false,
  "feedback": "如果不通过，说明具体问题和改进建议（中文）"
}

评审标准:
1. 是否回答了用户的问题/完成了用户的指令
2. 内容是否完整（不是占位符或空洞内容）
3. Markdown 格式是否正确
4. 如果用户要求修改选中文本，是否只修改了选中部分

仅输出 JSON，不要输出其他内容。"""

async def reviewer_node(state: AgentState) -> dict:
    """检查生成内容的质量"""
    llm = get_chat_model()
    step_events = list(state.get("step_events", []))

    step_events.append({"type": "step_start", "step": "review", "description": "正在检查内容质量..."})

    draft = state.get("draft_content", "")

    # 如果已经达到最大迭代次数，直接通过
    if state.get("iteration_count", 0) >= state.get("max_iterations", 3):
        step_events.append({"type": "step_done", "step": "review", "result_summary": "达到最大迭代次数，直接交付"})
        return {
            "final_content": draft,
            "needs_revision": False,
            "step_events": step_events,
        }

    user_prompt = f"""用户原始请求: {state['user_message']}

生成的文档:
{draft[:5000]}

请审查此文档。"""

    messages = [
        SystemMessage(content=REVIEWER_SYSTEM_PROMPT),
        HumanMessage(content=user_prompt),
    ]

    response = await llm.ainvoke(messages)
    try:
        review = json.loads(response.content)
    except json.JSONDecodeError:
        review = {"approved": True, "feedback": ""}

    if review.get("approved", True):
        step_events.append({"type": "step_done", "step": "review", "result_summary": "质量检查通过"})
        return {
            "final_content": draft,
            "needs_revision": False,
            "step_events": step_events,
        }
    else:
        step_events.append({
            "type": "step_done",
            "step": "review",
            "result_summary": f"需要修订: {review.get('feedback', '')[:100]}",
        })
        return {
            "needs_revision": True,
            "revision_feedback": review.get("feedback", "请改进内容质量"),
            "step_events": step_events,
        }
```

**第 2 步：承诺**

```bash
git add agent-service/app/agent/nodes/reviewer.py
git commit -m "feat(agent): add reviewer node with quality assessment"
```

---

### 任务 3.7: LangGraph 图定义与编译

**文件：**
- 创建：`agent-service/app/agent/graph.py`

**步骤 1：实现**

```python
# agent-service/app/agent/graph.py
from langgraph.graph import StateGraph, END

from app.agent.state import AgentState
from app.agent.nodes.planner import planner_node
from app.agent.nodes.researcher import researcher_node
from app.agent.nodes.executor import executor_node
from app.agent.nodes.reviewer import reviewer_node

def should_continue(state: AgentState) -> str:
    """决定 Reviewer 之后是结束还是回到 Planner 修正"""
    if state.get("needs_revision") and state.get("iteration_count", 0) < state.get("max_iterations", 3):
        return "revise"
    return "end"

def build_agent_graph():
    """构建并编译 LangGraph 图"""
    graph = StateGraph(AgentState)

    # 注册节点
    graph.add_node("planner", planner_node)
    graph.add_node("researcher", researcher_node)
    graph.add_node("executor", executor_node)
    graph.add_node("reviewer", reviewer_node)

    # 定义边
    graph.set_entry_point("planner")
    graph.add_edge("planner", "researcher")
    graph.add_edge("researcher", "executor")
    graph.add_edge("executor", "reviewer")
    graph.add_conditional_edges("reviewer", should_continue, {
        "revise": "planner",
        "end": END,
    })

    return graph.compile()

# 预编译的图实例
agent_graph = build_agent_graph()
```

**第 2 步：承诺**

```bash
git add agent-service/app/agent/graph.py
git commit -m "feat(agent): build LangGraph with Plan-Execute-Review loop"
```

---

### 任务 3.8: Agent 运行 API 端点（SSE 流式响应）

**文件：**
- 修改：`agent-service/app/main.py`

**第 1 步：添加代理/运行端点**

在 `agent-service/app/main.py` 中新增：

```python
# agent-service/app/main.py (完整替换)
import asyncio
import json

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse

from app.config import settings
from app.middleware.auth import verify_internal_secret
from app.schemas.request import AgentRunRequest, AgentStopRequest
from app.agent.graph import agent_graph
from app.agent.state import AgentState

# 导入所有工具以触发注册
import app.tools.tavily_search      # noqa: F401
import app.tools.firecrawl_scrape   # noqa: F401
import app.tools.docling_parser     # noqa: F401
import app.tools.nanobana_imggen    # noqa: F401
import app.tools.image_annotate     # noqa: F401
import app.tools.vlm_understand     # noqa: F401
import app.tools.docmost_api        # noqa: F401

from app.tools.registry import get_tool_names

app = FastAPI(title="Docmost Agent Service", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 活跃任务跟踪（用于终止）
_active_tasks: dict[str, asyncio.Event] = {}

@app.get("/health")
async def health():
    return {"status": "ok", "service": "docmost-agent"}

@app.get("/tools")
async def list_tools():
    return {"tools": get_tool_names()}

@app.post("/agent/run", dependencies=[Depends(verify_internal_secret)])
async def run_agent(request: AgentRunRequest):
    """运行 Agent，返回 SSE 事件流"""
    cancel_event = asyncio.Event()
    task_id = f"task-{id(cancel_event)}"
    _active_tasks[task_id] = cancel_event

    initial_state: AgentState = {
        "user_message": request.user_message,
        "conversation_history": request.conversation_history,
        "uploaded_files": [f.model_dump() for f in request.files],
        "template_id": request.template_id,
        "page_id": request.page_context.page_id,
        "page_title": request.page_context.page_title,
        "page_content": request.page_context.page_content,
        "selected_text": request.page_context.selected_text,
        "selection_range": request.page_context.selection_range,
        "insert_mode": request.config.get("insert_mode", "create"),
        "plan": [],
        "current_step": 0,
        "research_results": [],
        "parsed_files": [],
        "generated_images": [],
        "draft_content": "",
        "final_content": "",
        "step_events": [],
        "needs_revision": False,
        "revision_feedback": "",
        "iteration_count": 0,
        "max_iterations": request.config.get("max_iterations", settings.agent_max_iterations),
    }

    async def event_generator():
        last_event_idx = 0
        try:
            async for state_update in agent_graph.astream(initial_state):
                if cancel_event.is_set():
                    yield {"event": "error", "data": json.dumps({"type": "error", "message": "任务已取消"})}
                    break

                # 从 state_update 中提取新的 step_events
                for node_name, node_output in state_update.items():
                    events = node_output.get("step_events", [])
                    new_events = events[last_event_idx:]
                    last_event_idx = len(events)
                    for evt in new_events:
                        yield {"data": json.dumps(evt, ensure_ascii=False)}

            # 获取最终状态
            final_state = agent_graph.get_state(initial_state)
            final_content = ""
            if hasattr(final_state, "values"):
                final_content = final_state.values.get("final_content", "")

            yield {"data": json.dumps({
                "type": "done",
                "final_content": final_content,
                "insert_mode": request.config.get("insert_mode", "create"),
            }, ensure_ascii=False)}

        except Exception as e:
            yield {"data": json.dumps({"type": "error", "message": str(e)[:500]}, ensure_ascii=False)}
        finally:
            _active_tasks.pop(task_id, None)

    return EventSourceResponse(event_generator(), headers={"X-Task-Id": task_id})

@app.post("/agent/stop", dependencies=[Depends(verify_internal_secret)])
async def stop_agent(request: AgentStopRequest):
    """终止正在运行的 Agent 任务"""
    cancel = _active_tasks.get(request.task_id)
    if cancel:
        cancel.set()
        return {"status": "stopping"}
    return {"status": "not_found"}
```

**第 2 步：承诺**

```bash
git add agent-service/app/main.py
git commit -m "feat(agent): add /agent/run SSE endpoint with LangGraph streaming"
```

---

## 阶段 4: NestJS 网关层

### 任务 4.1: 新增环境变量

**文件：**
- 修改：`apps/server/src/integrations/environment/environment.service.ts`

**第一步：添加Agent相关getter方法**

在 `EnvironmentService` 类中添加：

```typescript
getAgentServiceUrl(): string {
  return this.configService.get<string>('AGENT_SERVICE_URL') || 'http://agent-service:8100';
}

getAgentInternalSecret(): string {
  return this.configService.get<string>('AGENT_INTERNAL_SECRET') || '';
}
```

**第 2 步：承诺**

```bash
git add apps/server/src/integrations/environment/environment.service.ts
git commit -m "feat(agent): add agent service config to EnvironmentService"
```

---

### 任务 4.2: 网关 DTO

**文件：**
- 创建：`apps/server/src/ee/ai/agent-gateway/dto/agent-run.dto.ts`
- 创建：`apps/server/src/ee/ai/agent-gateway/dto/agent-stop.dto.ts`

**步骤1：实现DTO**

```typescript
// apps/server/src/ee/ai/agent-gateway/dto/agent-run.dto.ts
import { IsString, IsOptional, IsArray } from 'class-validator';

export class AgentRunDto {
  @IsString()
  prompt: string;

  @IsString()
  pageId: string;

  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsString()
  insertMode?: string;

  @IsOptional()
  @IsString()
  pageTitle?: string;

  @IsOptional()
  @IsArray()
  history?: { role: string; content: string }[];
}

// apps/server/src/ee/ai/agent-gateway/dto/agent-stop.dto.ts
import { IsString } from 'class-validator';

export class AgentStopDto {
  @IsString()
  taskId: string;
}
```

**第 2 步：承诺**

```bash
git add apps/server/src/ee/ai/agent-gateway/
git commit -m "feat(agent): add NestJS gateway DTOs"
```

---

### 任务 4.3: 网关 Service

**文件：**
- 创建：`apps/server/src/ee/ai/agent-gateway/agent-gateway.service.ts`

**步骤 1：实现 SSE 代理服务**

```typescript
// apps/server/src/ee/ai/agent-gateway/agent-gateway.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { EnvironmentService } from '../../../integrations/environment/environment.service';

@Injectable()
export class AgentGatewayService {
  private readonly logger = new Logger(AgentGatewayService.name);

  constructor(private environmentService: EnvironmentService) {}

  async forwardToAgent(path: string, body: Record<string, any>): Promise<Response> {
    const baseUrl = this.environmentService.getAgentServiceUrl();
    const secret = this.environmentService.getAgentInternalSecret();

    const resp = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': secret,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      this.logger.error(`Agent service error: ${resp.status} ${errText}`);
      throw new Error(`Agent service returned ${resp.status}`);
    }

    return resp;
  }

  async stopAgent(taskId: string): Promise<any> {
    const baseUrl = this.environmentService.getAgentServiceUrl();
    const secret = this.environmentService.getAgentInternalSecret();

    const resp = await fetch(`${baseUrl}/agent/stop`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': secret,
      },
      body: JSON.stringify({ task_id: taskId }),
    });

    return resp.json();
  }

  async getTools(): Promise<any> {
    const baseUrl = this.environmentService.getAgentServiceUrl();
    const resp = await fetch(`${baseUrl}/tools`);
    return resp.json();
  }
}
```

**第 2 步：承诺**

```bash
git add apps/server/src/ee/ai/agent-gateway/agent-gateway.service.ts
git commit -m "feat(agent): add AgentGatewayService for proxying to Python service"
```

---

### 任务 4.4: 网关 Controller

**文件：**
- 创建：`apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts`

**步骤 1：实现控制器**

```typescript
// apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts
import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  UseGuards,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../../common/decorators/auth-workspace.decorator';
import { AgentGatewayService } from './agent-gateway.service';
import { AgentStopDto } from './dto/agent-stop.dto';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_FILES = 5;

@Controller('agent')
@UseGuards(JwtAuthGuard)
export class AgentGatewayController {
  private readonly logger = new Logger(AgentGatewayController.name);

  constructor(private agentGatewayService: AgentGatewayService) {}

  @Post('run')
  async runAgent(
    @AuthUser() user: any,
    @AuthWorkspace() workspace: any,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ) {
    // 1. 解析 multipart
    const parts = req.parts();
    const bufferedFiles: { buffer: Buffer; mimetype: string; filename: string }[] = [];
    const fields: Record<string, string> = {};

    for await (const part of parts) {
      if (part.type === 'file') {
        if (bufferedFiles.length >= MAX_FILES) continue;
        const buffer = await part.toBuffer();
        if (buffer.length > MAX_FILE_SIZE) {
          throw new PayloadTooLargeException(`文件 ${part.filename} 超过 20MB 限制`);
        }
        bufferedFiles.push({ buffer, mimetype: part.mimetype, filename: part.filename });
      } else {
        fields[part.fieldname] = part.value as string;
      }
    }

    // 2. 构建请求体
    const files = bufferedFiles.map((f) => ({
      filename: f.filename,
      mimetype: f.mimetype,
      content_b64: f.buffer.toString('base64'),
    }));

    const history = fields.history ? JSON.parse(fields.history) : [];

    const agentBody = {
      user_message: fields.prompt || '',
      files,
      page_context: {
        page_id: fields.pageId || null,
        page_title: fields.pageTitle || null,
        page_content: fields.pageContent || null,
        selected_text: fields.selectedText || null,
        selection_range: fields.selectionRange ? JSON.parse(fields.selectionRange) : null,
      },
      template_id: fields.templateId || null,
      conversation_history: history,
      workspace_id: workspace.id,
      config: {
        insert_mode: fields.insertMode || 'create',
        max_iterations: 3,
      },
    };

    // 3. 转发到 Agent Service 并代理 SSE
    try {
      const agentResp = await this.agentGatewayService.forwardToAgent('/agent/run', agentBody);

      res.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      const reader = agentResp.body?.getReader();
      if (!reader) {
        res.raw.write(`data: ${JSON.stringify({ type: 'error', message: 'Agent 无响应' })}\n\n`);
        res.raw.end();
        return;
      }

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        res.raw.write(chunk);
      }

      res.raw.end();
    } catch (error) {
      this.logger.error('Agent run failed', error);
      if (!res.raw.headersSent) {
        res.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
      }
      res.raw.write(`data: ${JSON.stringify({ type: 'error', message: error?.message || 'Agent 服务不可用' })}\n\n`);
      res.raw.end();
    }
  }

  @Post('stop')
  async stopAgent(@Body() dto: AgentStopDto) {
    return this.agentGatewayService.stopAgent(dto.taskId);
  }

  @Post('tools')
  async getTools() {
    return this.agentGatewayService.getTools();
  }
}
```

**第 2 步：承诺**

```bash
git add apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts
git commit -m "feat(agent): add AgentGatewayController with SSE proxy"
```

---

### 任务 4.5: 网关 Module + 注册到 EeModule

**文件：**
- 创建：`apps/server/src/ee/ai/agent-gateway/agent-gateway.module.ts`
- 修改：`apps/server/src/ee/ee.module.ts`

**第 1 步：创建模块**

```typescript
// apps/server/src/ee/ai/agent-gateway/agent-gateway.module.ts
import { Module } from '@nestjs/common';
import { AgentGatewayController } from './agent-gateway.controller';
import { AgentGatewayService } from './agent-gateway.service';

@Module({
  controllers: [AgentGatewayController],
  providers: [AgentGatewayService],
})
export class AgentGatewayModule {}
```

**第 2 步：在EeModule中导入AgentGatewayModule**

在 `apps/server/src/ee/ee.module.ts` 的 imports 数组中添加 `AgentGatewayModule`。

**第 3 步：承诺**

```bash
git add apps/server/src/ee/ai/agent-gateway/agent-gateway.module.ts apps/server/src/ee/ee.module.ts
git commit -m "feat(agent): register AgentGatewayModule in EeModule"
```

---

## 阶段 5: 前端集成

### 任务 5.1: Agent 类型定义和 Atom

**文件：**
- 创建：`apps/client/src/ee/ai/types/agent.types.ts`
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-creator-atoms.ts`

**步骤 1：类型定义**

```typescript
// apps/client/src/ee/ai/types/agent.types.ts
export interface AgentStepInfo {
  step: string;
  description: string;
  status: 'running' | 'done' | 'error' | 'pending';
  resultSummary?: string;
}

export interface AgentSSEEvent {
  type: 'step_start' | 'step_done' | 'content' | 'image' | 'tool_call' | 'error' | 'done';
  [key: string]: any;
}
```

**步骤 2：在 ai-creator-atoms.ts 中添加原子**

在现有 atom 文件末尾添加：

```typescript
// 新增 Agent 模式相关 atom
export const agentModeAtom = atomWithStorage('aiAgentMode', false);
export const agentStepsAtom = atom<Record<string, AgentStepInfo[]>>({});
```

需要导入: `import { AgentStepInfo } from '../../types/agent.types';`

**第 3 步：承诺**

```bash
git add apps/client/src/ee/ai/types/agent.types.ts apps/client/src/ee/ai/components/ai-creator/ai-creator-atoms.ts
git commit -m "feat(agent): add agent types and Jotai atoms"
```

---

### 任务 5.2: Agent Service (前端 API 调用)

**文件：**
- 创建：`apps/client/src/ee/ai/services/agent-service.ts`

**步骤 1：实现 SSE 流式调用**

```typescript
// apps/client/src/ee/ai/services/agent-service.ts
import { AgentSSEEvent } from '../types/agent.types';

interface AgentGenerateParams {
  files: File[];
  prompt: string;
  pageId: string;
  templateId?: string;
  insertMode?: string;
  pageTitle?: string;
  pageContent?: string;
  selectedText?: string;
  selectionRange?: { from: number; to: number } | null;
  history?: { role: string; content: string }[];
}

export function agentGenerate(
  params: AgentGenerateParams,
  onEvent: (event: AgentSSEEvent) => void,
  onError: (error: string) => void,
  onComplete: () => void,
): AbortController {
  const controller = new AbortController();

  const formData = new FormData();
  formData.append('prompt', params.prompt);
  formData.append('pageId', params.pageId);
  if (params.templateId) formData.append('templateId', params.templateId);
  if (params.insertMode) formData.append('insertMode', params.insertMode);
  if (params.pageTitle) formData.append('pageTitle', params.pageTitle);
  if (params.pageContent) formData.append('pageContent', params.pageContent);
  if (params.selectedText) formData.append('selectedText', params.selectedText);
  if (params.selectionRange) formData.append('selectionRange', JSON.stringify(params.selectionRange));
  if (params.history) formData.append('history', JSON.stringify(params.history));
  for (const file of params.files) {
    formData.append('files', file);
  }

  fetch('/api/agent/run', {
    method: 'POST',
    body: formData,
    signal: controller.signal,
  })
    .then(async (resp) => {
      if (!resp.ok) {
        onError(`Agent 请求失败: ${resp.status}`);
        return;
      }
      const reader = resp.body?.getReader();
      if (!reader) {
        onError('无法读取响应流');
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') continue;
            try {
              const event: AgentSSEEvent = JSON.parse(data);
              onEvent(event);
            } catch {
              // 忽略解析错误
            }
          }
        }
      }

      onComplete();
    })
    .catch((err) => {
      if (err.name !== 'AbortError') {
        onError(err.message || 'Agent 请求失败');
      }
    });

  return controller;
}
```

**第 2 步：承诺**

```bash
git add apps/client/src/ee/ai/services/agent-service.ts
git commit -m "feat(agent): add frontend agent SSE service"
```

---

### 任务 5.3: Agent 步骤进度组件

**文件：**
- 创建：`apps/client/src/ee/ai/components/ai-creator/ai-creator-agent-steps.tsx`
- 创建：`apps/client/src/ee/ai/components/ai-creator/ai-creator-agent-steps.module.css`

**步骤 1：组件实现**

```tsx
// apps/client/src/ee/ai/components/ai-creator/ai-creator-agent-steps.tsx
import { AgentStepInfo } from '../../types/agent.types';
import classes from './ai-creator-agent-steps.module.css';

interface Props {
  steps: AgentStepInfo[];
}

const STATUS_ICONS: Record<string, string> = {
  done: '✅',
  running: '🔄',
  error: '❌',
  pending: '⏳',
};

export function AiCreatorAgentSteps({ steps }: Props) {
  if (steps.length === 0) return null;

  return (
    <div className={classes.stepsContainer}>
      <div className={classes.stepsHeader}>执行步骤</div>
      {steps.map((step, idx) => (
        <div key={idx} className={classes.stepItem} data-status={step.status}>
          <span className={classes.stepIcon}>{STATUS_ICONS[step.status] || '⏳'}</span>
          <span className={classes.stepText}>
            {step.description}
            {step.resultSummary && step.status === 'done' && (
              <span className={classes.stepSummary}> — {step.resultSummary}</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
```

**步骤 2：样式**

```css
/* apps/client/src/ee/ai/components/ai-creator/ai-creator-agent-steps.module.css */
.stepsContainer {
  background: var(--mantine-color-gray-0);
  border: 1px solid var(--mantine-color-gray-2);
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 8px;
  font-size: 13px;
}

:global([data-mantine-color-scheme="dark"]) .stepsContainer {
  background: var(--mantine-color-dark-6);
  border-color: var(--mantine-color-dark-4);
}

.stepsHeader {
  font-weight: 600;
  font-size: 12px;
  color: var(--mantine-color-gray-6);
  margin-bottom: 4px;
}

.stepItem {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 0;
  line-height: 1.4;
}

.stepItem[data-status="running"] {
  color: var(--mantine-color-blue-6);
}

.stepItem[data-status="error"] {
  color: var(--mantine-color-red-6);
}

.stepIcon {
  flex-shrink: 0;
  width: 18px;
  text-align: center;
}

.stepText {
  flex: 1;
  min-width: 0;
}

.stepSummary {
  color: var(--mantine-color-gray-5);
  font-size: 12px;
}
```

**第 3 步：承诺**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator-agent-steps.tsx apps/client/src/ee/ai/components/ai-creator/ai-creator-agent-steps.module.css
git commit -m "feat(agent): add agent steps progress component"
```

---

### 任务 5.4: 修改 AI Creator Input（添加深度模式开关）

**文件：**
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-creator-input.tsx`

**第 1 步：在输入工具栏左侧添加区域深度模式开关**

在已有的模板选择按钮和文件上传按钮旁边，添加一个 Agent 模式切换按钮。具体位置：在 `inputToolbarLeft` 的 `div` 内，模板按钮之后添加：

```tsx
// 导入新增
import { IconBrain } from '@tabler/icons-react';
import { agentModeAtom } from './ai-creator-atoms';

// 在组件内获取 atom
const [agentMode, setAgentMode] = useAtom(agentModeAtom);

// 在 inputToolbarLeft 中模板按钮后添加按钮:
<Tooltip label={agentMode ? '深度模式（已开启）' : '深度模式'}>
  <ActionIcon
    variant={agentMode ? 'filled' : 'subtle'}
    color={agentMode ? 'indigo' : 'gray'}
    size="sm"
    onClick={() => setAgentMode(!agentMode)}
  >
    <IconBrain size={16} />
  </ActionIcon>
</Tooltip>
```

**第 2 步：在handleSubmit中根据agentMode路由到不同的流程**

在 `handleSubmit` 函数内，当 `agentMode` 为 true 时，调用 `agentGenerate` 而非 `creatorGenerate`。具体逻辑在 任务 5.5 的 use-agent hook 中封装。

**第 3 步：承诺**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator-input.tsx
git commit -m "feat(agent): add deep mode toggle button to AI creator input"
```

---

### 任务 5.5: Agent Hook + 修改 Message Item 渲染步骤

**文件：**
- 创建：`apps/client/src/ee/ai/hooks/use-agent.ts`
- 修改：`apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.tsx`

**第 1 步：使用代理挂钩**

```typescript
// apps/client/src/ee/ai/hooks/use-agent.ts
import { useCallback, useRef } from 'react';
import { useAtom } from 'jotai';
import { agentStepsAtom } from '../components/ai-creator/ai-creator-atoms';
import { agentGenerate } from '../services/agent-service';
import { AgentSSEEvent, AgentStepInfo } from '../types/agent.types';

export function useAgent(pageId: string) {
  const [allSteps, setAllSteps] = useAtom(agentStepsAtom);
  const abortRef = useRef<AbortController | null>(null);

  const steps = allSteps[pageId] || [];

  const run = useCallback(
    (params: Parameters<typeof agentGenerate>[0], callbacks: {
      onContent: (chunk: string) => void;
      onDone: (finalContent: string, insertMode: string) => void;
      onError: (msg: string) => void;
    }) => {
      // 清空步骤
      setAllSteps((prev) => ({ ...prev, [pageId]: [] }));

      const updateStep = (step: string, update: Partial<AgentStepInfo>) => {
        setAllSteps((prev) => {
          const current = [...(prev[pageId] || [])];
          const idx = current.findIndex((s) => s.step === step && s.status !== 'done');
          if (idx >= 0) {
            current[idx] = { ...current[idx], ...update };
          } else {
            current.push({ step, description: '', status: 'pending', ...update } as AgentStepInfo);
          }
          return { ...prev, [pageId]: current };
        });
      };

      const controller = agentGenerate(
        params,
        (event: AgentSSEEvent) => {
          switch (event.type) {
            case 'step_start':
              updateStep(event.step, { description: event.description, status: 'running' });
              break;
            case 'step_done':
              updateStep(event.step, { status: 'done', resultSummary: event.result_summary });
              break;
            case 'content':
              callbacks.onContent(event.chunk);
              break;
            case 'image':
              callbacks.onContent(`\n![${event.alt}](${event.url})\n`);
              break;
            case 'error':
              callbacks.onError(event.message);
              break;
            case 'done':
              callbacks.onDone(event.final_content, event.insert_mode);
              break;
          }
        },
        callbacks.onError,
        () => {},
      );

      abortRef.current = controller;
    },
    [pageId, setAllSteps],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  return { steps, run, stop };
}
```

**第 2 步：修改message-item渲染步骤**

在 `ai-creator-message-item.tsx` 中，当消息的 role 为 'assistant' 时，在内容上方渲染 `AiCreatorAgentSteps` 组件（仅在 agentMode 活跃且有步骤时显示）。

在 AI 消息气泡内容区域的最前面添加：

```tsx
import { AiCreatorAgentSteps } from './ai-creator-agent-steps';
import { agentStepsAtom, agentModeAtom } from './ai-creator-atoms';

// 在组件内:
const [agentMode] = useAtom(agentModeAtom);
const [allSteps] = useAtom(agentStepsAtom);
const steps = allSteps[pageId] || [];

// 在 AI 气泡内容 div 中, renderedHtml 之前:
{message.role === 'assistant' && agentMode && steps.length > 0 && isLastMessage && (
  <AiCreatorAgentSteps steps={steps} />
)}
```

**第 3 步：承诺**

```bash
git add apps/client/src/ee/ai/hooks/use-agent.ts apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.tsx
git commit -m "feat(agent): add useAgent hook and render steps in message item"
```

---

## 阶段 6: Docker 部署

### 任务 6.1: Agent Service Dockerfile

**文件：**
- 创建：`agent-service/Dockerfile`
- 创建：`agent-service/.dockerignore`

**步骤 1：Dockerfile**

```dockerfile
# agent-service/Dockerfile
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    libtesseract-dev \
    libgl1-mesa-glx \
    libglib2.0-0 \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml .
RUN pip install --no-cache-dir .

COPY app/ ./app/

EXPOSE 8100
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8100", "--workers", "1"]
```

**步骤2：.dockerignore**

```
# agent-service/.dockerignore
__pycache__
*.pyc
.pytest_cache
tests/
.env
.git
```

**第 3 步：承诺**

```bash
git add agent-service/Dockerfile agent-service/.dockerignore
git commit -m "feat(agent): add Dockerfile for agent-service"
```

---

### 任务 6.2: 更新 docker-compose.yml

**文件：**
- 修改：`docker-compose.yml`

**第 1 步：在services中添加agent-service**

```yaml
  agent-service:
    build:
      context: ./agent-service
      dockerfile: Dockerfile
    restart: unless-stopped
    depends_on:
      - db
      - redis
    environment:
      - AI_DRIVER=${AI_DRIVER}
      - AI_COMPLETION_MODEL=${AI_COMPLETION_MODEL}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - OPENAI_API_URL=${OPENAI_API_URL:-}
      - GEMINI_API_KEY=${GEMINI_API_KEY:-}
      - AGENT_LLM_PROVIDER=${AGENT_LLM_PROVIDER:-}
      - AGENT_LLM_MODEL=${AGENT_LLM_MODEL:-}
      - AGENT_LLM_API_KEY=${AGENT_LLM_API_KEY:-}
      - AGENT_LLM_API_URL=${AGENT_LLM_API_URL:-}
      - TAVILY_API_KEY=${TAVILY_API_KEY}
      - FIRECRAWL_API_KEY=${FIRECRAWL_API_KEY}
      - FIRECRAWL_API_URL=${FIRECRAWL_API_URL:-https://api.firecrawl.dev}
      - NANOBANA_API_KEY=${NANOBANA_API_KEY}
      - AGENT_INTERNAL_SECRET=${AGENT_INTERNAL_SECRET}
      - DOCMOST_INTERNAL_URL=http://docmost:3000
      - AGENT_MAX_ITERATIONS=${AGENT_MAX_ITERATIONS:-3}
    volumes:
      - docmost_data:/app/data/storage
    networks:
      - docmost-network
```

**第 2 步：在docmost服务的环境中添加**

```yaml
      - AGENT_SERVICE_URL=http://agent-service:8100
      - AGENT_INTERNAL_SECRET=${AGENT_INTERNAL_SECRET}
```

**第 3 步：承诺**

```bash
git add docker-compose.yml
git commit -m "feat(agent): add agent-service to docker-compose"
```

---

### 任务 6.3: 更新 .env.example

**文件：**
- 修改：`.env.example`

**步骤 1：添加 Agent 相关环境变量**

```bash
# === AI Agent Service ===
AGENT_SERVICE_URL=http://agent-service:8100
AGENT_INTERNAL_SECRET=your-internal-secret-here

# Agent LLM 覆盖配置（可选，默认复用上方 AI 配置）
# AGENT_LLM_PROVIDER=
# AGENT_LLM_MODEL=
# AGENT_LLM_API_KEY=
# AGENT_LLM_API_URL=

# Agent 工具 API Keys
TAVILY_API_KEY=your-tavily-key
FIRECRAWL_API_KEY=your-firecrawl-key
# FIRECRAWL_API_URL=https://api.firecrawl.dev
NANOBANA_API_KEY=your-nanobana-key

# Agent 运行配置
# AGENT_MAX_ITERATIONS=3
```

**第 2 步：承诺**

```bash
git add .env.example
git commit -m "docs: add agent service env vars to .env.example"
```

---

## 执行顺序汇总

| 阶段 | 任务 | 描述 | 估计文件数 |
|-------|------|------|-----------|
| 1 | 1.1-1.3 | Python项目搭建骨架+配置+架构 | 10 |
| 2 | 2.1-2.5 | 9 个工具实现 | 8 |
| 3 | 3.1-3.8 | LangGraph Agent核心（状态/节点/图/API） | 9 |
| 4 | 4.1-4.5 | NestJS 网关层 | 7 |
| 5 | 5.1-5.5 | 前端集成 | 7 |
| 6 | 6.1-6.3 | Docker部署 | 4 |

**总计**：6 个阶段，21 个任务，~45 个文件
