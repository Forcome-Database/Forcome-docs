# AI Creator 5 阶段智能工作流 — 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将 AI Creator 从单步直出正文改造为 5 阶段智能创作工作流（探索→澄清→方案→大纲→正文），支持 LangGraph interrupt 人工介入、图文融合、精确替换。

**Architecture:** Python Agent Service 使用 LangGraph interrupt + AsyncPostgresSaver 实现 human-in-the-loop 暂停/恢复。NestJS 网关新增 resume 路由代理。前端新增 3 种交互型气泡组件，统一内容交付逻辑，支持流式写入编辑器。

**Tech Stack:** Python 3.12 / LangGraph 0.2+ / langgraph-checkpoint-postgres / FastAPI / NestJS 11 / React 18 / Jotai / TipTap 3

**Design Doc:** `docs/plans/2026-03-04-ai-creator-optimization-design.md`

---

## Phase 1: Python Agent — 状态与模式扩展（P0）

### Task 1: 扩展 AgentState 和请求/响应模式

**Files:**
- Modify: `agent-service/app/agent/state.py` (全文重写)
- Modify: `agent-service/app/schemas/request.py` (新增 resume 请求)
- Modify: `agent-service/app/schemas/response.py` (新增 await_input 事件)

**Step 1: 扩展 AgentState**

```python
# agent-service/app/agent/state.py
from typing import TypedDict
from langgraph.graph import add_messages  # for potential future use


class PlanStep(TypedDict):
    step_id: int
    action: str           # "search" | "parse" | "crawl" | "generate" | "image" | "annotate" | "review"
    description: str
    tool: str | None
    args: dict | None
    status: str           # "pending" | "running" | "done" | "skipped"


class AgentState(TypedDict):
    # === User input ===
    user_message: str
    conversation_history: list[dict]
    uploaded_files: list[dict]
    template_id: str | None

    # === Document context ===
    page_id: str | None
    page_title: str | None
    page_content: str | None
    selected_text: str | None
    selection_range: dict | None
    insert_mode: str  # "create" | "overwrite" | "replace" | "append"

    # === Research results ===
    plan: list[PlanStep]
    current_step: int
    research_results: list[dict]
    parsed_files: list[dict]       # includes image_urls with context mapping
    generated_images: list[dict]

    # === Phase artifacts (NEW) ===
    clarify_questions: list[str]
    user_answers: str
    proposals: list[dict]          # [{title, description}]
    selected_proposal: dict
    outline: str
    confirmed_outline: str

    # === Output ===
    draft_content: str
    final_content: str
    step_events: list[dict]

    # === Control ===
    phase: str                     # "explorer" | "clarifier" | "proposer" | "outliner" | "writer" | "reviewer"
    needs_revision: bool
    revision_feedback: str
    iteration_count: int
    max_iterations: int

    # === Internal ===
    _task_id: str
    _thread_id: str
```

**Step 2: 新增 resume 请求模式**

```python
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
    thread_id: str | None = None  # NEW: for session tracking


class AgentResumeRequest(BaseModel):
    thread_id: str
    resume_value: dict  # user's response to interrupt


class AgentStopRequest(BaseModel):
    task_id: str
```

**Step 3: 新增 await_input 和 session 事件类型**

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


# NEW: interrupt events
class AwaitInputEvent(BaseModel):
    type: Literal["await_input"] = "await_input"
    phase: str  # "clarify" | "propose" | "outline"
    data: dict  # phase-specific payload


class SessionEvent(BaseModel):
    type: Literal["session"] = "session"
    thread_id: str


SSEEvent = (
    StepStartEvent | StepDoneEvent | ContentEvent | ImageEvent
    | ToolCallEvent | ErrorEvent | DoneEvent
    | AwaitInputEvent | SessionEvent
)
```

**Step 4: Commit**

```bash
git add agent-service/app/agent/state.py agent-service/app/schemas/request.py agent-service/app/schemas/response.py
git commit -m "feat(agent): extend AgentState with phase artifacts, add resume request and await_input event"
```

---

### Task 2: 添加 langgraph-checkpoint-postgres 依赖

**Files:**
- Modify: `agent-service/pyproject.toml`

**Step 1: 添加依赖**

在 `pyproject.toml` 的 `dependencies` 列表中添加：

```toml
"langgraph-checkpoint-postgres>=2.0",
"psycopg[binary]>=3.1",
```

`langgraph-checkpoint-postgres` 需要 `psycopg` v3（异步 PostgreSQL 驱动）。

**Step 2: 安装依赖**

Run: `cd agent-service && pip install -e ".[dev]"`

**Step 3: Commit**

```bash
git add agent-service/pyproject.toml
git commit -m "feat(agent): add langgraph-checkpoint-postgres dependency"
```

---

## Phase 2: Python Agent — 新节点实现（P0）

### Task 3: 重构 planner → explorer 节点

**Files:**
- Rename: `agent-service/app/agent/nodes/planner.py` → `agent-service/app/agent/nodes/explorer.py`

**Step 1: 重命名并重构**

Explorer 节点保留原 planner 的调研计划能力，但职责缩小为只负责"探索调研"（搜索/解析/爬取）。不再负责生成内容大纲。

原 `planner.py` 的功能拆分：
- 制定工具调用计划 → 保留在 explorer
- 调研执行 → 保留在 explorer（合并原 researcher 的逻辑）
- 内容大纲 → 移到新的 outliner 节点

```python
# agent-service/app/agent/nodes/explorer.py
"""Explorer node: autonomous research phase.

Analyzes user request, creates a tool-calling plan, and executes
research steps (search, parse, crawl). Merges former planner + researcher.
"""
import json
import base64
import httpx
from langchain_core.messages import SystemMessage, HumanMessage

from app.agent.llm import get_chat_model
from app.agent.state import AgentState
from app.agent.events import emit
from app.config import settings
from app.tools.registry import get_tool, get_tool_names


EXPLORER_SYSTEM_PROMPT = """你是一个文档调研助手。分析用户请求，制定调研计划并执行。

可用工具: {tools}

输出 JSON 数组格式的调研计划（仅包含调研步骤，不包含生成步骤）。
每个步骤: {{"step_id": N, "action": "search|parse|crawl", "description": "...", "tool": "tool_name", "args": {{...}} }}

规则:
- 有上传文件 → 必须包含 parse 步骤
- 需要外部知识 → 包含 search 步骤
- 用户提供 URL → 包含 crawl 步骤
- 简单请求（如"写会议纪要"）→ 返回空数组 []
- 计划不超过 5 步
"""

RESEARCH_ACTIONS = {"search", "parse", "crawl"}


async def _upload_image_to_docmost(b64_data: str, filename: str, page_id: str) -> str:
    """Upload a base64 image to Docmost storage, return the file URL."""
    try:
        img_bytes = base64.b64decode(b64_data)
        url = f"{settings.docmost_internal_url}/api/files/upload"
        files = {"file": (filename, img_bytes, "image/png")}
        data = {"pageId": page_id}
        headers = {"X-Internal-Secret": settings.agent_internal_secret}

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(url, files=files, data=data, headers=headers)

        if resp.status_code == 200:
            result = resp.json()
            file_data = result.get("data", result)
            file_path = file_data.get("filePath", "")
            file_name = file_data.get("fileName", filename)
            if file_path:
                return f"/api/files/{file_path}/{file_name}"
        return ""
    except Exception:
        return ""


async def explorer_node(state: AgentState) -> dict:
    """Explore and research: plan tools, execute search/parse/crawl."""
    tid = state.get("_task_id", "")
    llm = get_chat_model()

    # --- Phase 1: Create research plan ---
    await emit(tid, {"type": "step_start", "step": "explore", "description": "正在分析需求并制定调研计划..."})

    context_parts = [f"用户请求: {state['user_message']}"]
    if state.get("page_title"):
        context_parts.append(f"当前页面标题: {state['page_title']}")
    if state.get("selected_text"):
        context_parts.append(f"用户选中的文本: {state['selected_text'][:500]}")
    if state.get("uploaded_files"):
        file_names = [f["filename"] for f in state["uploaded_files"]]
        context_parts.append(f"上传的文件: {', '.join(file_names)}")

    messages = [
        SystemMessage(content=EXPLORER_SYSTEM_PROMPT.format(tools=", ".join(get_tool_names()))),
        HumanMessage(content="\n".join(context_parts)),
    ]
    response = await llm.ainvoke(messages)

    try:
        plan = json.loads(response.content)
    except json.JSONDecodeError:
        plan = []

    for step in plan:
        step["status"] = "pending"

    await emit(tid, {"type": "step_done", "step": "explore", "result_summary": f"制定了 {len(plan)} 步调研计划"})

    # --- Phase 2: Execute research steps ---
    research_results = []
    parsed_files = []
    generated_images = list(state.get("generated_images", []))
    page_id = state.get("page_id", "")

    for step in plan:
        if step["action"] not in RESEARCH_ACTIONS:
            continue

        step["status"] = "running"
        await emit(tid, {"type": "step_start", "step": step["action"], "description": step["description"]})

        tool_name = step.get("tool")
        tool_fn = get_tool(tool_name) if tool_name else None

        try:
            if step["action"] == "parse" and tool_fn:
                for f in state.get("uploaded_files", []):
                    raw_result = await tool_fn.ainvoke({
                        "file_content_b64": f["content_b64"],
                        "filename": f["filename"],
                        "mimetype": f["mimetype"],
                    })

                    try:
                        parsed = json.loads(raw_result)
                        text_content = parsed.get("text", raw_result)
                        images = parsed.get("images", [])
                    except (json.JSONDecodeError, TypeError):
                        text_content = raw_result
                        images = []

                    image_urls = []
                    if images and page_id:
                        await emit(tid, {"type": "step_start", "step": "upload_images", "description": f"正在上传 {len(images)} 张提取的图片..."})
                        for img in images:
                            img_filename = f"doc-img-{img['index']}.png"
                            url = await _upload_image_to_docmost(img["b64"], img_filename, page_id)
                            if url:
                                image_urls.append({
                                    "index": img["index"],
                                    "url": url,
                                    "desc": img.get("desc", ""),
                                    "context": img.get("context", ""),       # NEW: position context
                                    "page_ref": img.get("page_ref", ""),     # NEW: source page ref
                                    "surrounding_text": img.get("surrounding_text", ""),  # NEW
                                })
                                await emit(tid, {"type": "image", "url": url, "alt": img.get("desc", "")})
                        await emit(tid, {"type": "step_done", "step": "upload_images", "result_summary": f"上传了 {len(image_urls)} 张图片"})

                    parsed_files.append({
                        "filename": f["filename"],
                        "content": text_content,
                        "image_urls": image_urls,
                    })
                    generated_images.extend(image_urls)

            elif step["action"] == "search" and tool_fn:
                args = step.get("args", {}) or {}
                query = args.get("query", state["user_message"])
                result = await tool_fn.ainvoke({"query": query, "max_results": 5})
                research_results.append({"source": "search", "query": query, "content": result})

            elif step["action"] == "crawl" and tool_fn:
                args = step.get("args", {}) or {}
                url = args.get("url", "")
                if url:
                    result = await tool_fn.ainvoke({"url": url})
                    research_results.append({"source": "crawl", "url": url, "content": result})

            step["status"] = "done"
            await emit(tid, {"type": "step_done", "step": step["action"], "result_summary": "完成"})

        except Exception as e:
            step["status"] = "skipped"
            await emit(tid, {"type": "step_done", "step": step["action"], "result_summary": f"跳过: {str(e)[:100]}"})

    return {
        "plan": plan,
        "research_results": research_results,
        "parsed_files": parsed_files,
        "generated_images": generated_images,
        "phase": "clarifier",
    }
```

**Step 2: 删除原 researcher.py（逻辑已合并到 explorer）**

```bash
# researcher.py 的逻辑已完全合并到 explorer.py，可以删除
rm agent-service/app/agent/nodes/researcher.py
```

**Step 3: Commit**

```bash
git add agent-service/app/agent/nodes/explorer.py
git rm agent-service/app/agent/nodes/planner.py agent-service/app/agent/nodes/researcher.py
git commit -m "feat(agent): create explorer node (merges planner + researcher), add image context mapping"
```

---

### Task 4: 创建 clarifier 节点

**Files:**
- Create: `agent-service/app/agent/nodes/clarifier.py`

**Step 1: 实现 clarifier 节点**

```python
# agent-service/app/agent/nodes/clarifier.py
"""Clarifier node: ask user clarifying questions before proceeding.

Uses interrupt() to pause the graph and wait for user input.
Can be skipped if the LLM determines the request is clear enough.
"""
import json
from langchain_core.messages import SystemMessage, HumanMessage
from langgraph.types import interrupt

from app.agent.llm import get_chat_model
from app.agent.state import AgentState
from app.agent.events import emit


CLARIFIER_SYSTEM_PROMPT = """你是一个需求分析助手。基于用户请求和调研结果，判断是否需要向用户提出澄清问题。

如果用户需求已经足够明确（有清晰的主题、范围和目标），返回:
{{"needs_clarify": false}}

如果需要澄清，返回:
{{"needs_clarify": true, "questions": ["问题1", "问题2", ...]}}

规则:
- 最多提 3 个问题
- 问题要具体、有选项感（如"你希望重点分析方案A还是方案B？"）
- 不要问显而易见的问题
- 如果用户提供了模板（如"技术文档"），说明意图已较明确
"""


async def clarifier_node(state: AgentState) -> dict:
    """Analyze if clarification is needed; interrupt if so."""
    tid = state.get("_task_id", "")
    llm = get_chat_model()

    await emit(tid, {"type": "step_start", "step": "clarify", "description": "正在分析是否需要进一步了解需求..."})

    # Build context for LLM decision
    context_parts = [f"用户请求: {state['user_message']}"]
    if state.get("template_id"):
        context_parts.append(f"选择的模板: {state['template_id']}")
    if state.get("research_results"):
        summaries = [r.get("content", "")[:200] for r in state["research_results"][:3]]
        context_parts.append(f"调研结果摘要: {'; '.join(summaries)}")
    if state.get("parsed_files"):
        file_names = [f["filename"] for f in state["parsed_files"]]
        context_parts.append(f"已解析的文件: {', '.join(file_names)}")

    messages = [
        SystemMessage(content=CLARIFIER_SYSTEM_PROMPT),
        HumanMessage(content="\n".join(context_parts)),
    ]
    response = await llm.ainvoke(messages)

    try:
        result = json.loads(response.content)
    except json.JSONDecodeError:
        result = {"needs_clarify": False}

    if not result.get("needs_clarify", False):
        await emit(tid, {"type": "step_done", "step": "clarify", "result_summary": "需求已明确，跳过澄清"})
        return {"phase": "proposer"}

    questions = result.get("questions", [])

    # Emit await_input event before interrupt
    await emit(tid, {
        "type": "await_input",
        "phase": "clarify",
        "data": {"questions": questions},
    })
    await emit(tid, {"type": "step_done", "step": "clarify", "result_summary": f"提出了 {len(questions)} 个澄清问题"})

    # Interrupt: graph pauses here, waits for user resume
    user_response = interrupt({
        "type": "clarify",
        "questions": questions,
    })

    return {
        "clarify_questions": questions,
        "user_answers": user_response.get("answers", "") if isinstance(user_response, dict) else str(user_response),
        "phase": "proposer",
    }
```

**Step 2: Commit**

```bash
git add agent-service/app/agent/nodes/clarifier.py
git commit -m "feat(agent): add clarifier node with LangGraph interrupt for human-in-the-loop"
```

---

### Task 5: 创建 proposer 节点

**Files:**
- Create: `agent-service/app/agent/nodes/proposer.py`

**Step 1: 实现 proposer 节点**

```python
# agent-service/app/agent/nodes/proposer.py
"""Proposer node: suggest 2-3 writing approaches for user to choose.

Uses interrupt() to pause and wait for user's choice.
Can be skipped for simple/template-driven requests.
"""
import json
from langchain_core.messages import SystemMessage, HumanMessage
from langgraph.types import interrupt

from app.agent.llm import get_chat_model
from app.agent.state import AgentState
from app.agent.events import emit


PROPOSER_SYSTEM_PROMPT = """你是一个写作方案规划师。基于用户需求和调研结果，提出 2-3 个写作方向/结构方案。

如果请求很简单或已选模板，不需要提方案，返回:
{{"needs_proposal": false}}

如果需要提方案，返回:
{{"needs_proposal": true, "proposals": [
  {{"title": "方案名称", "description": "简要描述该方案的侧重点和结构特色，50字以内"}},
  ...
]}}

规则:
- 每个方案的侧重点要有明显差异
- 描述要简洁有对比性
- 最多 3 个方案
"""


async def proposer_node(state: AgentState) -> dict:
    """Propose writing approaches; interrupt for user choice."""
    tid = state.get("_task_id", "")
    llm = get_chat_model()

    await emit(tid, {"type": "step_start", "step": "propose", "description": "正在构思写作方案..."})

    context_parts = [f"用户请求: {state['user_message']}"]
    if state.get("user_answers"):
        context_parts.append(f"用户补充说明: {state['user_answers']}")
    if state.get("template_id"):
        context_parts.append(f"选择的模板: {state['template_id']}")
    if state.get("research_results"):
        for r in state["research_results"][:3]:
            context_parts.append(f"调研[{r.get('source', '')}]: {r.get('content', '')[:300]}")

    messages = [
        SystemMessage(content=PROPOSER_SYSTEM_PROMPT),
        HumanMessage(content="\n".join(context_parts)),
    ]
    response = await llm.ainvoke(messages)

    try:
        result = json.loads(response.content)
    except json.JSONDecodeError:
        result = {"needs_proposal": False}

    if not result.get("needs_proposal", False):
        await emit(tid, {"type": "step_done", "step": "propose", "result_summary": "请求明确，跳过方案提议"})
        return {"phase": "outliner"}

    proposals = result.get("proposals", [])

    await emit(tid, {
        "type": "await_input",
        "phase": "propose",
        "data": {"proposals": proposals},
    })
    await emit(tid, {"type": "step_done", "step": "propose", "result_summary": f"提出了 {len(proposals)} 个方案"})

    user_choice = interrupt({
        "type": "propose",
        "proposals": proposals,
    })

    selected_idx = user_choice.get("selected_proposal", 0) if isinstance(user_choice, dict) else 0
    selected = proposals[selected_idx] if selected_idx < len(proposals) else proposals[0] if proposals else {}
    feedback = user_choice.get("feedback", "") if isinstance(user_choice, dict) else ""

    return {
        "proposals": proposals,
        "selected_proposal": {**selected, "user_feedback": feedback},
        "phase": "outliner",
    }
```

**Step 2: Commit**

```bash
git add agent-service/app/agent/nodes/proposer.py
git commit -m "feat(agent): add proposer node with interrupt for writing approach selection"
```

---

### Task 6: 创建 outliner 节点

**Files:**
- Create: `agent-service/app/agent/nodes/outliner.py`

**Step 1: 实现 outliner 节点**

```python
# agent-service/app/agent/nodes/outliner.py
"""Outliner node: generate structured outline for user approval.

Always interrupts — outline confirmation is mandatory.
User can: confirm, edit the outline, or request regeneration via chat.
"""
import json
from langchain_core.messages import SystemMessage, HumanMessage
from langgraph.types import interrupt

from app.agent.llm import get_chat_model
from app.agent.state import AgentState
from app.agent.events import emit


OUTLINER_SYSTEM_PROMPT = """你是一个文档大纲设计师。基于用户需求、调研结果和选定的方案，生成结构化的 Markdown 大纲。

输出格式:
```
## 1. 第一章标题
  要点概述（1-2句）

## 2. 第二章标题
  ### 2.1 子节标题
    要点概述
  ### 2.2 子节标题
    要点概述

## 3. 第三章标题
  要点概述
```

规则:
- 使用 ## 和 ### 标题层级
- 每个章节下简要说明要点（不要写正文）
- 如果有图片素材，在相关章节标注"（含图片）"
- 大纲 3-8 个主要章节
- 如果用户选中了文本要修改，大纲仅覆盖修改部分
"""


async def outliner_node(state: AgentState) -> dict:
    """Generate outline and always interrupt for user confirmation."""
    tid = state.get("_task_id", "")
    llm = get_chat_model()

    await emit(tid, {"type": "step_start", "step": "outline", "description": "正在生成文档大纲..."})

    context_parts = [f"用户请求: {state['user_message']}"]
    if state.get("user_answers"):
        context_parts.append(f"用户补充: {state['user_answers']}")
    if state.get("selected_proposal"):
        prop = state["selected_proposal"]
        context_parts.append(f"选定方案: {prop.get('title', '')} — {prop.get('description', '')}")
        if prop.get("user_feedback"):
            context_parts.append(f"用户对方案的补充: {prop['user_feedback']}")
    if state.get("selected_text"):
        context_parts.append(f"用户选中的文本（仅修改此部分）:\n{state['selected_text'][:1000]}")
    if state.get("parsed_files"):
        for f in state["parsed_files"]:
            context_parts.append(f"文件 [{f['filename']}]: {f['content'][:500]}")
            if f.get("image_urls"):
                img_notes = [f"  图片: {img['desc']} (位置: {img.get('context', '未知')})" for img in f["image_urls"]]
                context_parts.append("\n".join(img_notes))
    if state.get("research_results"):
        for r in state["research_results"][:3]:
            context_parts.append(f"调研[{r.get('source', '')}]: {r.get('content', '')[:300]}")

    messages = [
        SystemMessage(content=OUTLINER_SYSTEM_PROMPT),
        HumanMessage(content="\n".join(context_parts)),
    ]
    response = await llm.ainvoke(messages)
    outline = response.content

    await emit(tid, {
        "type": "await_input",
        "phase": "outline",
        "data": {"outline": outline},
    })
    await emit(tid, {"type": "step_done", "step": "outline", "result_summary": "大纲已生成，等待确认"})

    # Always interrupt: outline confirmation is mandatory
    user_decision = interrupt({
        "type": "outline",
        "outline": outline,
    })

    action = user_decision.get("action", "confirm") if isinstance(user_decision, dict) else "confirm"

    if action == "regenerate":
        # User wants a new outline — the graph will re-enter outliner via conditional edge
        feedback = user_decision.get("feedback", "")
        return {
            "outline": outline,
            "confirmed_outline": "",
            "revision_feedback": feedback,
            "phase": "outliner",  # loop back
        }

    confirmed = user_decision.get("confirmed_outline", outline) if isinstance(user_decision, dict) else outline

    return {
        "outline": outline,
        "confirmed_outline": confirmed,
        "phase": "writer",
    }
```

**Step 2: Commit**

```bash
git add agent-service/app/agent/nodes/outliner.py
git commit -m "feat(agent): add outliner node with mandatory interrupt for outline approval"
```

---

### Task 7: 重构 executor → writer 节点（含图片上下文映射）

**Files:**
- Rename: `agent-service/app/agent/nodes/executor.py` → `agent-service/app/agent/nodes/writer.py`

**Step 1: 重构 writer 节点**

关键改进：
- 基于 `confirmed_outline` 生成正文（而非自由发挥）
- 图片上下文映射：每张图片带原始位置、上下文、描述
- 保留流式输出和空图片兜底

```python
# agent-service/app/agent/nodes/writer.py
"""Writer node: generate document content based on confirmed outline.

Streams content via SSE. Uses image context mapping for accurate placement.
"""
import re
from langchain_core.messages import SystemMessage, HumanMessage

from app.agent.llm import get_chat_model
from app.agent.state import AgentState
from app.agent.events import emit


WRITER_SYSTEM_PROMPT = """你是一个专业的文档撰写者。基于确认的大纲和调研素材，生成完整的 Markdown 文档。

输出规则:
1. 严格按照大纲结构组织内容
2. 使用 ## 和 ### 标题层级
3. 内容详实、有条理、专业
4. 如果有来源，在文末标注参考链接
5. 如果用户要求修改选中文本，只输出修改后的文本片段

图片插入规则:
{image_instructions}
"""


def _build_image_instructions(images: list[dict]) -> str:
    """Build structured image context mapping for the prompt."""
    if not images:
        return "无可用图片。"

    lines = ["以下图片已上传，请在对应位置插入 ![描述](URL)：\n"]
    for i, img in enumerate(images):
        lines.append(f"图 {i+1}: ![{img.get('desc', f'图片{i+1}')}]({img['url']})")
        if img.get("context"):
            lines.append(f"  原始位置: {img['context']}")
        if img.get("page_ref"):
            lines.append(f"  来源: {img['page_ref']}")
        if img.get("surrounding_text"):
            lines.append(f"  上下文: \"{img['surrounding_text'][:100]}\"")
        lines.append("")

    lines.append("插入规则:")
    lines.append("1. 必须在对应章节位置插入图片引用")
    lines.append("2. 每张图片引用恰好使用一次")
    lines.append("3. 图片前后应有解释性文字")
    lines.append("4. 无对应位置的图片放在最相关段落之后")
    return "\n".join(lines)


def _strip_empty_images(md: str) -> str:
    """Remove markdown images that have no real URL."""
    md = re.sub(r'!\[([^\]]*)\]\(\s*\)', r'> *\1*', md)
    md = re.sub(r'!\[([^\]]*)\]\(IMAGE_PLACEHOLDER[^)]*\)', r'> *\1*', md)
    md = re.sub(r'!\[([^\]]*)\]\((?!https?://|/api/)[^)]*\)', r'> *\1*', md)
    md = re.sub(r'!\[([^\]]*)\](?!\()', r'> *\1*', md)
    return md


async def writer_node(state: AgentState) -> dict:
    """Generate document content based on confirmed outline + research."""
    tid = state.get("_task_id", "")
    llm = get_chat_model()

    await emit(tid, {"type": "step_start", "step": "generate", "description": "正在生成文档内容..."})

    # Build image instructions
    image_urls = state.get("generated_images", [])
    image_instructions = _build_image_instructions(image_urls)

    system_prompt = WRITER_SYSTEM_PROMPT.format(image_instructions=image_instructions)

    # Build user message
    user_parts = []

    # Confirmed outline (primary structure guide)
    confirmed_outline = state.get("confirmed_outline", "")
    if confirmed_outline:
        user_parts.append(f"请严格按照以下大纲生成完整正文:\n\n{confirmed_outline}")
    else:
        user_parts.append(f"用户请求: {state['user_message']}")

    # Page context for modifications
    if state.get("page_content"):
        user_parts.append(f"\n当前页面内容:\n{state['page_content'][:5000]}")
    if state.get("selected_text"):
        user_parts.append(f"\n用户选中的文本（仅修改此部分）:\n{state['selected_text']}")

    # Research materials
    research_parts = []
    for item in state.get("parsed_files", []):
        research_parts.append(f"[文件: {item['filename']}]\n{item['content'][:3000]}")
    for item in state.get("research_results", []):
        research_parts.append(f"[来源: {item.get('source', 'unknown')}]\n{item['content'][:2000]}")
    if research_parts:
        user_parts.append(f"\n调研资料:\n{'---'.join(research_parts)}")

    # Revision feedback
    if state.get("revision_feedback"):
        user_parts.append(f"\n修订反馈:\n{state['revision_feedback']}")
        user_parts.append(f"\n上次草稿:\n{state.get('draft_content', '')[:5000]}")

    # Build messages
    messages = [SystemMessage(content=system_prompt)]
    for msg in state.get("conversation_history", [])[-6:]:
        if msg["role"] == "user":
            messages.append(HumanMessage(content=msg["content"]))
    messages.append(HumanMessage(content="\n".join(user_parts)))

    # Stream generation
    content_chunks = []
    async for chunk in llm.astream(messages):
        text = chunk.content
        if text:
            content_chunks.append(text)
            await emit(tid, {"type": "content", "chunk": text})

    draft_content = "".join(content_chunks)
    draft_content = _strip_empty_images(draft_content)

    await emit(tid, {"type": "step_done", "step": "generate", "result_summary": f"生成了 {len(draft_content)} 字符"})

    return {"draft_content": draft_content}
```

**Step 2: 删除原文件并提交**

```bash
git add agent-service/app/agent/nodes/writer.py
git rm agent-service/app/agent/nodes/executor.py
git commit -m "feat(agent): create writer node with outline-driven generation and image context mapping"
```

---

### Task 8: 更新 reviewer 节点

**Files:**
- Modify: `agent-service/app/agent/nodes/reviewer.py`

**Step 1: 修改 reviewer，修订只回 writer**

```python
# agent-service/app/agent/nodes/reviewer.py
"""Reviewer node: quality check and iteration control.

On revision, loops back to Writer only (not Explorer/Outliner).
"""
import json
from langchain_core.messages import SystemMessage, HumanMessage

from app.agent.llm import get_chat_model
from app.agent.state import AgentState
from app.agent.events import emit


REVIEWER_SYSTEM_PROMPT = """你是文档质量审查员。检查生成的文档是否满足用户需求。

评审标准:
1. 是否回答了用户问题/完成了用户指令
2. 是否严格遵循了大纲结构
3. 内容是否完整（非占位符或空洞内容）
4. 图片引用是否正确（有 URL 且在合理位置）
5. Markdown 格式是否正确

返回 JSON:
{{"approved": true/false, "feedback": "如果不通过，说明具体问题和改进建议"}}
"""


async def reviewer_node(state: AgentState) -> dict:
    """Review draft quality. Revision loops back to Writer only."""
    tid = state.get("_task_id", "")
    llm = get_chat_model()

    await emit(tid, {"type": "step_start", "step": "review", "description": "正在检查内容质量..."})

    # Skip review if max iterations reached
    if state.get("iteration_count", 0) >= state.get("max_iterations", 3):
        await emit(tid, {"type": "step_done", "step": "review", "result_summary": "达到最大迭代次数，直接交付"})
        return {
            "final_content": state.get("draft_content", ""),
            "needs_revision": False,
        }

    draft = state.get("draft_content", "")
    user_prompt = f"""用户原始请求: {state['user_message']}

确认的大纲:
{state.get('confirmed_outline', '(无大纲)')}

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
        await emit(tid, {"type": "step_done", "step": "review", "result_summary": "质量检查通过"})
        return {
            "final_content": draft,
            "needs_revision": False,
        }

    await emit(tid, {"type": "step_done", "step": "review", "result_summary": f"需要修订: {review.get('feedback', '')[:100]}"})
    return {
        "needs_revision": True,
        "revision_feedback": review.get("feedback", "请改进内容质量"),
        "iteration_count": state.get("iteration_count", 0) + 1,
    }
```

**Step 2: Commit**

```bash
git add agent-service/app/agent/nodes/reviewer.py
git commit -m "feat(agent): update reviewer to only loop back to writer, add outline-based review"
```

---

### Task 9: 重建 LangGraph 图（interrupt + Checkpointer）

**Files:**
- Rewrite: `agent-service/app/agent/graph.py`

**Step 1: 重建图**

```python
# agent-service/app/agent/graph.py
"""LangGraph agent graph with interrupt-based human-in-the-loop.

Topology:
  Explorer → Clarifier → (interrupt) → Proposer → (interrupt)
  → Outliner → (interrupt) → Writer → Reviewer → (loop or END)

Uses AsyncPostgresSaver for state persistence across interrupts.
"""
from langgraph.graph import StateGraph, END

from app.agent.state import AgentState
from app.agent.nodes.explorer import explorer_node
from app.agent.nodes.clarifier import clarifier_node
from app.agent.nodes.proposer import proposer_node
from app.agent.nodes.outliner import outliner_node
from app.agent.nodes.writer import writer_node
from app.agent.nodes.reviewer import reviewer_node


def should_continue(state: AgentState) -> str:
    """After Reviewer: revise (back to Writer) or end."""
    if state.get("needs_revision") and state.get("iteration_count", 0) < state.get("max_iterations", 3):
        return "revise"
    return "end"


def should_regenerate_outline(state: AgentState) -> str:
    """After Outliner: if user requested regeneration, loop back."""
    if state.get("phase") == "outliner" and not state.get("confirmed_outline"):
        return "regenerate"
    return "continue"


def build_agent_graph():
    """Build and return the uncompiled graph builder.

    Compilation with checkpointer happens in main.py where DB pool is available.
    """
    graph = StateGraph(AgentState)

    # Add all 6 nodes
    graph.add_node("explorer", explorer_node)
    graph.add_node("clarifier", clarifier_node)
    graph.add_node("proposer", proposer_node)
    graph.add_node("outliner", outliner_node)
    graph.add_node("writer", writer_node)
    graph.add_node("reviewer", reviewer_node)

    # Entry point
    graph.set_entry_point("explorer")

    # Linear flow with interrupt points
    graph.add_edge("explorer", "clarifier")      # → may interrupt
    graph.add_edge("clarifier", "proposer")       # → may interrupt
    graph.add_edge("proposer", "outliner")        # → always interrupts

    # Outliner can loop back if user requests regeneration
    graph.add_conditional_edges("outliner", should_regenerate_outline, {
        "regenerate": "outliner",
        "continue": "writer",
    })

    graph.add_edge("writer", "reviewer")

    # Reviewer can loop back to Writer for revision
    graph.add_conditional_edges("reviewer", should_continue, {
        "revise": "writer",
        "end": END,
    })

    return graph


# Graph builder (not compiled yet — compiled in main.py with checkpointer)
agent_graph_builder = build_agent_graph()
```

**Step 2: Commit**

```bash
git add agent-service/app/agent/graph.py
git commit -m "feat(agent): rebuild LangGraph with 6 nodes, interrupt points, and conditional edges"
```

---

### Task 10: 重构 main.py（Checkpointer + resume 端点）

**Files:**
- Rewrite: `agent-service/app/main.py`

**Step 1: 重构 main.py**

```python
# agent-service/app/main.py
"""FastAPI entry point with LangGraph Checkpointer and resume support."""
import asyncio
import json
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from langgraph.types import Command
from psycopg_pool import AsyncConnectionPool
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from sse_starlette.sse import EventSourceResponse

from app.config import settings
from app.middleware.auth import verify_internal_secret
from app.schemas.request import AgentRunRequest, AgentResumeRequest, AgentStopRequest
from app.agent.graph import agent_graph_builder
from app.agent.state import AgentState
from app.agent.events import create_queue, remove_queue, emit, emit_done

# Import tools to trigger registration
import app.tools.tavily_search       # noqa: F401
import app.tools.firecrawl_scrape    # noqa: F401
import app.tools.docling_parser      # noqa: F401
import app.tools.nanobana_imggen     # noqa: F401
import app.tools.image_annotate      # noqa: F401
import app.tools.vlm_understand      # noqa: F401
import app.tools.docmost_api         # noqa: F401

# Global state
_active_tasks: dict[str, asyncio.Event] = {}
_task_counter = 0
_checkpointer: AsyncPostgresSaver | None = None
_compiled_graph = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize checkpointer on startup, cleanup on shutdown."""
    global _checkpointer, _compiled_graph

    # Create connection pool for checkpointer
    db_url = settings.database_url
    pool = AsyncConnectionPool(conninfo=db_url, open=False)
    await pool.open()

    _checkpointer = AsyncPostgresSaver(pool)
    await _checkpointer.setup()  # Creates checkpoint tables if not exist

    _compiled_graph = agent_graph_builder.compile(checkpointer=_checkpointer)

    yield

    await pool.close()


app = FastAPI(title="Docmost Agent Service", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/tools")
async def list_tools():
    from app.tools.registry import get_tool_names
    return {"tools": get_tool_names()}


async def _run_graph_and_stream(
    initial_input,
    config: dict,
    task_id: str,
    cancel_event: asyncio.Event,
    is_resume: bool = False,
):
    """Run the graph (or resume it) and stream SSE events."""
    queue = create_queue(task_id)

    async def run_graph():
        try:
            if is_resume:
                result = await _compiled_graph.ainvoke(
                    initial_input,  # Command(resume=value)
                    config,
                )
            else:
                result = await _compiled_graph.ainvoke(initial_input, config)

            # Check if graph completed (not interrupted)
            final_content = ""
            if isinstance(result, dict):
                final_content = result.get("final_content", result.get("draft_content", ""))

            if final_content:
                await emit(task_id, {
                    "type": "done",
                    "final_content": final_content,
                    "insert_mode": initial_input.get("insert_mode", "create") if isinstance(initial_input, dict) else "create",
                })
        except Exception as e:
            # Check if this is an interrupt (GraphInterrupt)
            err_name = type(e).__name__
            if "GraphInterrupt" in err_name or "interrupt" in str(e).lower():
                # Graph was interrupted — await_input already emitted by the node
                pass
            else:
                await emit(task_id, {"type": "error", "message": str(e)[:500]})
        finally:
            await emit_done(task_id)
            _active_tasks.pop(task_id, None)

    asyncio.create_task(run_graph())

    async def event_generator():
        try:
            while True:
                if cancel_event.is_set():
                    yield {"data": json.dumps({"type": "error", "message": "任务已取消"}, ensure_ascii=False)}
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=1.0)
                except asyncio.TimeoutError:
                    continue
                if event is None:
                    break
                yield {"data": json.dumps(event, ensure_ascii=False)}
        finally:
            remove_queue(task_id)

    return EventSourceResponse(event_generator(), headers={"X-Task-Id": task_id})


@app.post("/agent/run", dependencies=[Depends(verify_internal_secret)])
async def run_agent(request: AgentRunRequest):
    """Start a new agent run. Returns SSE event stream."""
    global _task_counter
    _task_counter += 1
    task_id = f"task-{_task_counter}"

    cancel_event = asyncio.Event()
    _active_tasks[task_id] = cancel_event

    thread_id = request.thread_id or str(uuid4())
    config = {"configurable": {"thread_id": thread_id}}

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
        "clarify_questions": [],
        "user_answers": "",
        "proposals": [],
        "selected_proposal": {},
        "outline": "",
        "confirmed_outline": "",
        "draft_content": "",
        "final_content": "",
        "step_events": [],
        "phase": "explorer",
        "needs_revision": False,
        "revision_feedback": "",
        "iteration_count": 0,
        "max_iterations": request.config.get("max_iterations", settings.agent_max_iterations),
        "_task_id": task_id,
        "_thread_id": thread_id,
    }

    # Emit session event with thread_id (prepend to queue)
    queue = create_queue(task_id)
    await queue.put({"type": "session", "thread_id": thread_id})
    remove_queue(task_id)  # will be re-created in _run_graph_and_stream

    return await _run_graph_and_stream(initial_state, config, task_id, cancel_event)


@app.post("/agent/resume", dependencies=[Depends(verify_internal_secret)])
async def resume_agent(request: AgentResumeRequest):
    """Resume an interrupted agent run with user's response."""
    global _task_counter
    _task_counter += 1
    task_id = f"task-{_task_counter}"

    cancel_event = asyncio.Event()
    _active_tasks[task_id] = cancel_event

    config = {"configurable": {"thread_id": request.thread_id}}

    return await _run_graph_and_stream(
        Command(resume=request.resume_value),
        config,
        task_id,
        cancel_event,
        is_resume=True,
    )


@app.post("/agent/stop", dependencies=[Depends(verify_internal_secret)])
async def stop_agent(request: AgentStopRequest):
    """Cancel a running agent task."""
    cancel_event = _active_tasks.get(request.task_id)
    if cancel_event:
        cancel_event.set()
        return {"status": "stopped", "task_id": request.task_id}
    return {"status": "not_found", "task_id": request.task_id}
```

**Step 2: 在 config.py 中添加 database_url**

在 `agent-service/app/config.py` 的 `Settings` 类中添加：

```python
# Database URL for checkpointer (reuse Docmost's PostgreSQL)
database_url: str = ""  # e.g. "postgresql://user:pass@localhost:5432/docmost"
```

**Step 3: Commit**

```bash
git add agent-service/app/main.py agent-service/app/config.py
git commit -m "feat(agent): rebuild main.py with Checkpointer, resume endpoint, and session management"
```

---

## Phase 3: NestJS 网关适配（P0）

### Task 11: 更新 Agent 网关（新增 resume 路由）

**Files:**
- Modify: `apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts`
- Modify: `apps/server/src/ee/ai/agent-gateway/dto/agent-run.dto.ts`
- Create: `apps/server/src/ee/ai/agent-gateway/dto/agent-resume.dto.ts`

**Step 1: 新增 AgentResumeDto**

```typescript
// apps/server/src/ee/ai/agent-gateway/dto/agent-resume.dto.ts
import { IsString, IsObject } from 'class-validator';

export class AgentResumeDto {
  @IsString()
  threadId: string;

  @IsObject()
  resumeValue: Record<string, any>;
}
```

**Step 2: 修改 AgentRunDto — 添加 threadId**

在 `agent-run.dto.ts` 中添加可选的 `threadId` 字段：

```typescript
@IsOptional()
@IsString()
threadId?: string;
```

**Step 3: 在 controller 中添加 resume 路由**

在 `agent-gateway.controller.ts` 中添加新的 `@Post('resume')` 端点，复用 http.request SSE 代理模式，将请求转发到 Python 的 `/agent/resume`。

关键代码结构与现有 `runAgent` 一致（使用 `http.request` 而非 `fetch`），只是：
- 路径改为 `/agent/resume`
- Body 为 JSON（不是 multipart），包含 `thread_id` 和 `resume_value`

**Step 4: Commit**

```bash
git add apps/server/src/ee/ai/agent-gateway/
git commit -m "feat(gateway): add /agent/resume route and AgentResumeDto"
```

---

## Phase 4: 前端 — 类型、状态、服务层（P0）

### Task 12: 扩展前端类型和 Atom

**Files:**
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-creator.types.ts`
- Modify: `apps/client/src/ee/ai/types/agent.types.ts`
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-creator-atoms.ts`

**Step 1: 扩展消息类型**

在 `ai-creator.types.ts` 中，将 `AiCreatorMessage.role` 扩展为支持新类型：

```typescript
export interface AiCreatorMessage {
  id: string;
  role: 'user' | 'assistant' | 'clarify' | 'propose' | 'outline';
  content: string;
  timestamp: number;
  selectionContext?: string;
  selectionRange?: { from: number; to: number };
  // NEW: phase-specific data
  questions?: string[];                        // for clarify
  proposals?: { title: string; description: string }[];  // for propose
  outline?: string;                            // for outline
  threadId?: string;                           // session tracking
}
```

**Step 2: 扩展 AgentSSEEvent**

在 `agent.types.ts` 中添加新事件类型：

```typescript
export interface AgentSSEEvent {
  type: 'step_start' | 'step_done' | 'content' | 'image' | 'tool_call'
        | 'error' | 'done' | 'await_input' | 'session';  // NEW types
  [key: string]: any;
}
```

**Step 3: 新增 threadId atom**

在 `ai-creator-atoms.ts` 中添加：

```typescript
// Thread ID for agent session (per page)
export const agentThreadIdAtom = atom<Record<string, string>>({});
```

**Step 4: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator.types.ts \
        apps/client/src/ee/ai/types/agent.types.ts \
        apps/client/src/ee/ai/components/ai-creator/ai-creator-atoms.ts
git commit -m "feat(frontend): extend message types with clarify/propose/outline, add threadId atom"
```

---

### Task 13: 新增 resumeAgent API 和更新 useAgent hook

**Files:**
- Modify: `apps/client/src/ee/ai/services/agent-service.ts`
- Modify: `apps/client/src/ee/ai/hooks/use-agent.ts`

**Step 1: 添加 resumeAgent 函数**

在 `agent-service.ts` 中新增：

```typescript
export function resumeAgent(
  threadId: string,
  resumeValue: Record<string, any>,
  onEvent: (event: AgentSSEEvent) => void,
  onError: (error: string) => void,
  onComplete: () => void,
): AbortController {
  const controller = new AbortController();

  fetch('/api/agent/resume', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threadId, resumeValue }),
    signal: controller.signal,
  })
    .then(async (resp) => {
      // Same SSE parsing logic as agentGenerate
      // ... (reuse the reader/decoder/line-parsing pattern)
    })
    .catch((err) => {
      if (err.name !== 'AbortError') onError(err.message);
    });

  return controller;
}
```

**Step 2: 更新 useAgent hook**

在 `use-agent.ts` 中：
- 处理 `await_input` 事件：将其转化为对应类型的消息添加到面板
- 处理 `session` 事件：存储 `thread_id`
- 新增 `resume` 方法：调用 `resumeAgent`

```typescript
case 'await_input':
  callbacks.onAwaitInput(event.phase, event.data);
  break;
case 'session':
  callbacks.onSession(event.thread_id);
  break;
```

**Step 3: Commit**

```bash
git add apps/client/src/ee/ai/services/agent-service.ts \
        apps/client/src/ee/ai/hooks/use-agent.ts
git commit -m "feat(frontend): add resumeAgent API and await_input handling in useAgent hook"
```

---

## Phase 5: 前端 — 交互型气泡组件（P0）

### Task 14: 创建大纲气泡组件

**Files:**
- Create: `apps/client/src/ee/ai/components/ai-creator/ai-creator-outline-bubble.tsx`

**Step 1: 实现大纲气泡**

包含：
- 默认只读 Markdown 渲染（复用 `renderBubbleHtml`）
- 「编辑大纲」按钮 → 切换 textarea 模式
- 「确认生成」按钮 → 调用 `resumeAgent({action: "confirm", confirmed_outline})`
- 「重新规划」按钮 → 调用 `resumeAgent({action: "regenerate"})`
- 用户也可通过输入框对话反馈

**Step 2: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator-outline-bubble.tsx
git commit -m "feat(frontend): add outline bubble component with edit/confirm/regenerate"
```

---

### Task 15: 创建澄清问题和方案选择气泡

**Files:**
- Create: `apps/client/src/ee/ai/components/ai-creator/ai-creator-clarify-bubble.tsx`
- Create: `apps/client/src/ee/ai/components/ai-creator/ai-creator-propose-bubble.tsx`

**Step 1: 澄清问题气泡**

显示问题列表 + textarea 输入框 + 提交按钮。提交后调用 `resumeAgent({answers: "用户回答"})`。

**Step 2: 方案选择气泡**

显示方案卡片列表（带标题和描述）+ 选择按钮 + 可选反馈输入。选择后调用 `resumeAgent({selected_proposal: index, feedback: "..."})`。

**Step 3: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator-clarify-bubble.tsx \
        apps/client/src/ee/ai/components/ai-creator/ai-creator-propose-bubble.tsx
git commit -m "feat(frontend): add clarify and propose bubble components"
```

---

### Task 16: 更新消息渲染分发

**Files:**
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.tsx`

**Step 1: 在消息渲染中分发新气泡类型**

在 `AiCreatorMessageItem` 组件中，根据 `message.role` 分发到对应气泡：

```typescript
if (message.role === 'clarify') {
  return <AiCreatorClarifyBubble message={message} onResume={handleResume} />;
}
if (message.role === 'propose') {
  return <AiCreatorProposeBubble message={message} onResume={handleResume} />;
}
if (message.role === 'outline') {
  return <AiCreatorOutlineBubble message={message} onResume={handleResume} />;
}
```

**Step 2: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.tsx
git commit -m "feat(frontend): dispatch clarify/propose/outline message types to new bubble components"
```

---

## Phase 6: 前端 — insertMode 重构与图片验证（P0）

### Task 17: 重构 insertMode 逻辑

**Files:**
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-creator-input.tsx`

**Step 1: 替换 shouldAppend 逻辑**

找到 `ai-creator-input.tsx` 中的 `shouldAppend`（约第 240 行）和 `insertMode`（约第 271 行），替换为：

```typescript
function isContinueIntent(text: string): boolean {
  const keywords = ['续写', '接着写', '继续写', '追加', '下一章', '下一节', 'continue', 'append'];
  return keywords.some(k => text.toLowerCase().includes(k));
}

// Replace the old shouldAppend logic:
const insertMode = selection
  ? 'replace'
  : !pageHasContent
    ? 'create'
    : isContinueIntent(userPrompt)
      ? 'append'
      : 'overwrite';
```

**Step 2: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator-input.tsx
git commit -m "fix(frontend): refactor insertMode — default to overwrite, append only on explicit continue intent"
```

---

### Task 18: 验证图片转换管线

**Files:**
- Test manually: `markdownToHtml` with image syntax

**Step 1: 验证 markdownToHtml 图片处理**

在浏览器控制台或测试文件中验证：

```typescript
import { markdownToHtml } from '@docmost/editor-ext';

const md = '段落文字\n\n![系统架构图](/api/files/xxx/doc-img-0.png)\n\n更多文字';
const html = markdownToHtml(md);
console.log(html);
// 期望: 包含 <img src="/api/files/xxx/doc-img-0.png" alt="系统架构图">
```

**Step 2: 如果图片不正确，添加预处理**

在 `ai-creator-message-item.tsx` 的 `renderEditorHtml` 中，在 `markdownToHtml` 之前预处理图片：

```typescript
function preprocessImages(md: string): string {
  return md.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    '<img src="$2" alt="$1" />'
  );
}
```

**Step 3: Commit（如有修改）**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.tsx
git commit -m "fix(frontend): ensure markdownToHtml correctly converts image syntax to TipTap image nodes"
```

---

## Phase 7: 前端 — 流式写入编辑器（P1）

### Task 19: 实现流式写入编辑器 + 锁定/解锁

**Files:**
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx`
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-creator-input.tsx`
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-creator.module.css`

**Step 1: 在 panel 中添加编辑器快照和锁定逻辑**

```typescript
// ai-creator-panel.tsx — 新增状态
const [editorSnapshot, setEditorSnapshot] = useState<any>(null);
const [isEditorLocked, setIsEditorLocked] = useState(false);

// 锁定编辑器
function lockEditor() {
  if (!editor) return;
  setEditorSnapshot(editor.getJSON());
  editor.setEditable(false);
  setIsEditorLocked(true);
}

// 解锁编辑器
function unlockEditor() {
  if (!editor) return;
  editor.setEditable(true);
  setIsEditorLocked(false);
}

// 回滚编辑器
function rollbackEditor() {
  if (!editor || !editorSnapshot) return;
  editor.commands.setContent(editorSnapshot);
  unlockEditor();
  setEditorSnapshot(null);
}
```

**Step 2: 在 input 中累积段落后批量插入**

```typescript
// 累积 Markdown 到完整段落后插入编辑器
let mdBuffer = '';

function flushToEditor(md: string) {
  const html = markdownToHtml(md);
  editor.chain().focus('end').insertContent(html).run();
}

// onChunk 回调中：
mdBuffer += chunk;
const paragraphs = mdBuffer.split('\n\n');
if (paragraphs.length > 1) {
  // 有完整段落，插入前面的段落
  const toInsert = paragraphs.slice(0, -1).join('\n\n');
  flushToEditor(toInsert);
  mdBuffer = paragraphs[paragraphs.length - 1]; // 保留不完整部分
}
```

**Step 3: 添加锁定样式**

在 `ai-creator.module.css` 中添加编辑器锁定视觉反馈样式。

**Step 4: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx \
        apps/client/src/ee/ai/components/ai-creator/ai-creator-input.tsx \
        apps/client/src/ee/ai/components/ai-creator/ai-creator.module.css
git commit -m "feat(frontend): implement streaming content into editor with lock/unlock/rollback"
```

---

## Phase 8: NestJS 普通模式大纲支持（P1）

### Task 20: 普通模式两阶段 SSE（大纲→正文）

**Files:**
- Modify: `apps/server/src/ee/ai/ai.controller.ts`

**Step 1: 修改 creatorGenerate 端点**

在 `ai.controller.ts` 的 `creatorGenerate` 中：
- 第一次 SSE 流：system prompt 指示"仅输出结构化大纲"
- 返回特殊 SSE 事件 `{type: "await_input", phase: "outline", data: {outline: "..."}}`
- 用户确认后，前端发第二次请求携带 `confirmedOutline`
- 第二次 SSE 流：基于大纲生成正文

**Step 2: Commit**

```bash
git add apps/server/src/ee/ai/ai.controller.ts
git commit -m "feat(server): add two-phase SSE for normal mode outline support"
```

---

## 验收检查清单

### P0 验收

- [ ] Agent 模式 5 阶段完整流程（从 `POST /agent/run` 到 `done` 事件）
- [ ] Explorer 自动调研（搜索/解析/爬取）
- [ ] Clarifier 智能跳过或 interrupt + 前端澄清气泡
- [ ] Proposer 智能跳过或 interrupt + 前端方案气泡
- [ ] Outliner 必经 interrupt + 前端大纲气泡（查看/编辑/确认/重新规划）
- [ ] Writer 基于确认的大纲 + 调研素材生成正文
- [ ] Reviewer 质量审查 + 最多 3 次修订循环（仅回 Writer）
- [ ] `POST /agent/resume` 正确恢复图执行
- [ ] Checkpointer 持久化状态（PostgreSQL）
- [ ] insertMode 默认 overwrite，仅"续写"时 append
- [ ] 选中文本精确替换（复用 SelectionSnapshot）
- [ ] 图片上下文映射使 LLM 准确放置图片
- [ ] PDF/Word 提取图片正确嵌入为 TipTap image 节点
- [ ] 全部 9 个工具可用

### P1 验收

- [ ] 流式内容实时写入编辑器 + 面板同步
- [ ] 编辑器锁定 + 标记样式
- [ ] 取消时自动回滚编辑器
- [ ] 普通模式两阶段大纲流程
