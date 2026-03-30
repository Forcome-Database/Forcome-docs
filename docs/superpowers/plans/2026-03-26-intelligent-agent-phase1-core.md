# Phase 1: Intelligent Agent Core 实施计划 v2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用单一 PydanticAI 工具调用 Agent 取代 engine.py 的 1266 行手动编排，实现"理解→工具调用→创作"流程。

**Architecture:** 模块级 Agent 单例 + 4 个可扩展工具 + TipTap Skill 注入 + event_stream_handler → SSE + 后验证兜底

**Tech Stack:** PydanticAI v1.72.0+, FastAPI, Python 3.11+, asyncio

**Spec:** `docs/superpowers/specs/2026-03-26-intelligent-agent-redesign.md` v2

**v3 修正项（本次补全）：** pydantic-ai 升级至 v1.72.0、动态 max_tokens（model_limits.py）、llm_factory.py 废弃修复（OpenAIModel→OpenAIChatModel）、Thinking 能力配置、langchain 装饰器清理、`is_task_cancelled` 函数名修正

**v2 修正项：** 单例模式、会话持久化、取消支持、后验证器、Skill 丰富度、thinking 事件、工具错误处理

---

## Task 0: 创建特性分支

- [ ] **Step 1: 创建分支**
```bash
git checkout -b feat/intelligent-agent
```

- [ ] **Step 2: 确认干净状态**
```bash
git status
```
Expected: clean working tree

---

## Task 0.5: 升级 pydantic-ai 依赖

**Files:**
- Modify: `agent-service/pyproject.toml`

**目的**：pydantic-ai v1.72.0 引入 `OpenAIChatModel`（替代废弃的 `OpenAIModel`）、`Thinking` Capability 系统、`OpenAIResponsesModel`。必须先升级才能使用这些特性。

- [ ] **Step 1: 更新 pyproject.toml 版本约束**
```toml
# pyproject.toml — [project] dependencies 中
"pydantic-ai>=1.72.0",   # Thinking Capability + OpenAIChatModel
```

- [ ] **Step 2: 安装并验证版本**
```bash
cd agent-service
pip install -e ".[dev]"
python -c "import pydantic_ai; print(pydantic_ai.__version__)"
```
Expected: 1.72.x 或更高

- [ ] **Step 3: 验证关键导入可用**
```bash
python -c "from pydantic_ai.models.openai import OpenAIChatModel; print('OpenAIChatModel OK')"
python -c "from pydantic_ai.models.openai import OpenAIResponsesModel; print('OpenAIResponsesModel OK')"
```
如有 ImportError 说明版本不足，重新 pip install pydantic-ai 到最新版。

- [ ] **Step 4: 提交**
```bash
git add agent-service/pyproject.toml
git commit -m "chore(deps): upgrade pydantic-ai to >=1.72.0"
```

---

## Task 0.6: 实现 model_limits.py（动态 max_tokens）

**Files:**
- Create: `agent-service/app/agent/model_limits.py`
- Test: `agent-service/tests/agent/test_model_limits.py`

**目的**：不同模型输出 token 上限差异极大（GPT-5.4=131K vs Ollama=8K）。固定值会导致 Ollama 崩溃或强模型能力受限。

- [ ] **Step 1: 写失败测试**
```python
# tests/agent/test_model_limits.py
from app.agent.model_limits import get_max_tokens, PROVIDER_DEFAULTS

def test_ollama_default_is_conservative():
    assert get_max_tokens("ollama", "llama3") == 8192

def test_gpt5_4_is_128k():
    result = get_max_tokens("openai", "gpt-5-4")
    assert result == 131072

def test_gemini_3_1_pro():
    result = get_max_tokens("gemini", "gemini-3.1-pro")
    assert result == 65536

def test_claude_opus():
    result = get_max_tokens("anthropic", "claude-opus-4-6")
    assert result == 131072

def test_unknown_model_falls_back_to_provider_default():
    result = get_max_tokens("openai", "unknown-future-model")
    assert result == PROVIDER_DEFAULTS["openai"]

def test_unknown_everything_falls_back_to_65536():
    result = get_max_tokens("", "")
    assert result == 65536
```

- [ ] **Step 2: 运行测试确认失败**
```bash
cd agent-service && python -m pytest tests/agent/test_model_limits.py -v
```

- [ ] **Step 3: 实现 model_limits.py**

完整代码见 spec v2 第 2.7 节。关键：
- `MODEL_OUTPUT_LIMITS` dict（小写 model name → tokens）
- `PROVIDER_DEFAULTS` dict（provider → 保守默认值）
- `get_max_tokens(provider, model_name) -> int` 先查 model，再回退 provider
- `get_max_tokens_for_current_model() -> int` 从 settings 读取当前配置

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: 提交**
```bash
git add agent-service/app/agent/model_limits.py agent-service/tests/agent/test_model_limits.py
git commit -m "feat(agent): add model_limits.py for dynamic max_tokens per model"
```

---

## Task 0.7: 更新 llm_factory.py

**Files:**
- Modify: `agent-service/app/orchestrator/llm_factory.py`
- Test: `agent-service/tests/test_llm_factory.py`（如存在则更新）

**目的**：`OpenAIModel` 在 pydantic-ai v1.72.0 中已废弃，需替换为 `OpenAIChatModel`；补充 `openai-responses` provider（支持 Responses API + native WebSearch）。

- [ ] **Step 1: 修复废弃 OpenAIModel**
```python
# 旧代码（已废弃）
from pydantic_ai.models.openai import OpenAIModel
return OpenAIModel(settings.openai_model, ...)

# 修改为
from pydantic_ai.models.openai import OpenAIChatModel
return OpenAIChatModel(settings.openai_model, ...)
```

- [ ] **Step 2: 添加 openai-responses provider 分支**
```python
elif provider == "openai-responses":
    from pydantic_ai.models.openai import OpenAIResponsesModel
    return OpenAIResponsesModel(
        settings.openai_model,
        base_url=getattr(settings, "openai_base_url", None),
        api_key=settings.openai_api_key,
    )
```

注意：`OpenAIResponsesModel` 仅兼容官方 OpenAI Responses API，不兼容第三方 openai-compatible API。

- [ ] **Step 3: 验证所有 4 个 provider 可用**
```bash
cd agent-service
python -c "
from app.orchestrator.llm_factory import create_pydantic_ai_model
import os; os.environ['AI_PROVIDER'] = 'openai'
m = create_pydantic_ai_model()
print(type(m).__name__)
"
```

- [ ] **Step 4: 提交**
```bash
git add agent-service/app/orchestrator/llm_factory.py
git commit -m "fix(llm_factory): OpenAIModel→OpenAIChatModel, add openai-responses provider"
```

---

## Task 1: AgentDeps 依赖注入容器

**Files:**
- Create: `agent-service/app/agent/__init__.py`
- Create: `agent-service/app/agent/deps.py`
- Create: `agent-service/tests/agent/__init__.py`
- Test: `agent-service/tests/agent/test_deps.py`

- [ ] **Step 1: 创建包目录和 __init__.py**
```bash
mkdir -p agent-service/app/agent agent-service/tests/agent
touch agent-service/app/agent/__init__.py agent-service/tests/agent/__init__.py
```

- [ ] **Step 2: 写失败测试**
```python
# tests/agent/test_deps.py
from app.agent.deps import AgentDeps

def test_deps_creation():
    deps = AgentDeps(
        thread_id="thread-001", page_id="page-001",
        workspace_id="ws-001", user_id="user-001",
        docmost_base_url="http://localhost:3000", internal_secret="secret",
    )
    assert deps.thread_id == "thread-001"
    assert deps.uploaded_image_urls == {}
    assert deps.files == []

def test_deps_isolation():
    """Two deps instances must NOT share state."""
    d1 = AgentDeps(thread_id="t1", page_id=None, workspace_id="w", user_id="u",
                   docmost_base_url="http://x", internal_secret="s")
    d2 = AgentDeps(thread_id="t2", page_id=None, workspace_id="w", user_id="u",
                   docmost_base_url="http://x", internal_secret="s")
    d1.uploaded_image_urls["img"] = "http://url"
    assert "img" not in d2.uploaded_image_urls  # 隔离验证
```

- [ ] **Step 3: 运行测试确认失败**
```bash
cd agent-service && python -m pytest tests/agent/test_deps.py -v
```
Expected: FAIL (ImportError)

- [ ] **Step 4: 实现 deps.py**

完整代码见 spec v2 第 2.2 节。关键点：
- `@dataclass`，不用 Pydantic（避免与 PydanticAI 内部冲突）
- `files: list[dict] = field(default_factory=list)` — 每个 dict 含 `content_b64/filename/mimetype`
- `uploaded_image_urls: dict[str, str] = field(default_factory=dict)` — 工具运行时填充
- `session_store: Any = None` — 注入 ConversationStore 实例

- [ ] **Step 5: 运行测试确认通过**
```bash
cd agent-service && python -m pytest tests/agent/test_deps.py -v
```
Expected: 2 passed

- [ ] **Step 6: 提交**
```bash
git add agent-service/app/agent/ agent-service/tests/agent/
git commit -m "feat(agent): add AgentDeps dependency container with isolation"
```

---

## Task 2: TipTap 创作 Skill

**Files:**
- Create: `agent-service/app/agent/skill.py`
- Test: `agent-service/tests/agent/test_skill.py`

- [ ] **Step 1: 写失败测试**
```python
# tests/agent/test_skill.py
from app.agent.skill import TIPTAP_CREATION_SKILL

def test_skill_length():
    """Skill must be comprehensive (2000+ tokens ≈ 3000+ characters)."""
    assert len(TIPTAP_CREATION_SKILL) > 3000

def test_skill_callout_syntax():
    assert ":::info" in TIPTAP_CREATION_SKILL
    assert ":::warning" in TIPTAP_CREATION_SKILL
    assert ":::success" in TIPTAP_CREATION_SKILL
    assert ":::danger" in TIPTAP_CREATION_SKILL

def test_skill_image_rules():
    assert "MUST" in TIPTAP_CREATION_SKILL
    assert "NEVER" in TIPTAP_CREATION_SKILL
    assert "![" in TIPTAP_CREATION_SKILL

def test_skill_heading_rules():
    assert "H1" in TIPTAP_CREATION_SKILL or "# Title" in TIPTAP_CREATION_SKILL

def test_skill_forbidden_patterns():
    assert "综上所述" in TIPTAP_CREATION_SKILL
    assert "赋能" in TIPTAP_CREATION_SKILL

def test_skill_workflow_protocol():
    """Must include the think→tools→generate workflow."""
    assert "UNDERSTAND" in TIPTAP_CREATION_SKILL or "CALL TOOLS" in TIPTAP_CREATION_SKILL

def test_skill_table_section():
    assert "Table" in TIPTAP_CREATION_SKILL or "table" in TIPTAP_CREATION_SKILL

def test_skill_details_section():
    """Must document collapsible sections."""
    assert "<details>" in TIPTAP_CREATION_SKILL or "details" in TIPTAP_CREATION_SKILL
```

- [ ] **Step 2: 运行测试确认失败**
```bash
cd agent-service && python -m pytest tests/agent/test_skill.py -v
```

- [ ] **Step 3: 实现 skill.py**

完整 Skill 文本见 spec v2 第 2.5 节（2000+ tokens）。关键覆盖：
- 工作流协议（理解→工具→生成→验证）
- Callout 4 种类型 + 使用场景
- 图片规则（必须使用工具返回 URL、紧跟相关文本、不堆积末尾）
- 表格使用场景
- 步骤教程格式
- 代码块、数学公式、任务列表、折叠面板
- 标题层级规则
- 内容质量规则（保留/增强/禁止项）

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: 提交**
```bash
git add agent-service/app/agent/skill.py agent-service/tests/agent/test_skill.py
git commit -m "feat(agent): add TipTap creation skill (2000+ tokens system prompt)"
```

---

## Task 3: SSE 事件桥接器

**Files:**
- Create: `agent-service/app/agent/event_bridge.py`
- Test: `agent-service/tests/agent/test_event_bridge.py`

- [ ] **Step 1: 写失败测试**
```python
# tests/agent/test_event_bridge.py
from app.agent.event_bridge import map_pydantic_event_to_sse

def test_tool_call_mapping():
    from pydantic_ai.messages import FunctionToolCallEvent, ToolCallPart
    part = ToolCallPart(tool_name="extract_document_tool", args={}, tool_call_id="c1")
    event = FunctionToolCallEvent(part=part)
    sse = map_pydantic_event_to_sse(event)
    assert sse["type"] == "tool_call"
    assert sse["tool"] == "extract_document_tool"
    assert "提取" in sse["description"]

def test_tool_result_mapping():
    from pydantic_ai.messages import FunctionToolResultEvent, ToolReturnPart
    part = ToolReturnPart(tool_name="extract_document_tool", content="done", tool_call_id="c1")
    event = FunctionToolResultEvent(result=part, content=None)
    sse = map_pydantic_event_to_sse(event)
    assert sse["type"] == "tool_result"

def test_text_delta_mapping():
    from pydantic_ai.messages import PartDeltaEvent, TextPartDelta
    event = PartDeltaEvent(index=0, delta=TextPartDelta(content_delta="Hello"))
    sse = map_pydantic_event_to_sse(event)
    assert sse["type"] == "content"
    assert sse["chunk"] == "Hello"

def test_non_text_delta_skipped():
    from pydantic_ai.messages import PartDeltaEvent, ToolCallPartDelta
    event = PartDeltaEvent(index=0, delta=ToolCallPartDelta(args_delta="{}"))
    sse = map_pydantic_event_to_sse(event)
    assert sse is None

def test_final_result_returns_none():
    """FinalResultEvent 在内容流完成前触发，不映射为 done（E-01 修正）。
    done 事件由 runner.py 在 async for 循环结束后发出。
    """
    from pydantic_ai.messages import FinalResultEvent
    event = FinalResultEvent(tool_name=None, tool_call_id=None)
    sse = map_pydantic_event_to_sse(event)
    assert sse is None  # 不在此处发 done
```

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现 event_bridge.py**

完整代码见 spec v2 第 3.1 节。关键点：
- `map_pydantic_event_to_sse()` 是纯函数（无副作用，易测试）
- TOOL_DESCRIPTIONS dict 提供中文描述
- `PartStartEvent` 中检查 `thinking` part_kind
- 非文本 delta（工具参数）返回 None 跳过

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: 提交**
```bash
git add agent-service/app/agent/event_bridge.py agent-service/tests/agent/test_event_bridge.py
git commit -m "feat(agent): add SSE event bridge with tool/content/thinking mapping"
```

**⚠️ 里程碑**：Task 3 完成后 SSE 协议稳定，Phase 2 前端编码可以开始。

---

## Task 4: 后验证器

**Files:**
- Create: `agent-service/app/agent/validator.py`
- Test: `agent-service/tests/agent/test_validator.py`

- [ ] **Step 1: 写失败测试**
```python
# tests/agent/test_validator.py
from app.agent.validator import validate_agent_output

def test_pass_when_all_images_present():
    output = "# Doc\n![img](http://example.com/a.jpg)\n![img](http://example.com/b.jpg)"
    urls = {"a": "http://example.com/a.jpg", "b": "http://example.com/b.jpg"}
    result = validate_agent_output(output, urls)
    assert result.passed

def test_fail_when_image_missing():
    output = "# Doc\n![img](http://example.com/a.jpg)"
    urls = {"a": "http://example.com/a.jpg", "b": "http://example.com/b.jpg"}
    result = validate_agent_output(output, urls)
    assert not result.passed
    assert any("b.jpg" in issue for issue in result.issues)

def test_fail_when_output_too_short():
    result = validate_agent_output("short", {})
    assert not result.passed

def test_detect_ocr_noise():
    output = "# Doc\n" + "x" * 200 + "\n自 日志\n设置"
    result = validate_agent_output(output, {})
    assert any("OCR" in i for i in result.issues)

def test_detect_multiple_h1():
    output = "# Title 1\ncontent\n# Title 2\nmore"
    result = validate_agent_output(output, {})
    assert any("H1" in i for i in result.issues)

def test_pass_with_no_images():
    output = "# Doc\n" + "This is a document with enough content. " * 10
    result = validate_agent_output(output, {})
    assert result.passed
```

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现 validator.py**

完整代码见 spec v2 第 2.6 节。

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: 提交**
```bash
git add agent-service/app/agent/validator.py agent-service/tests/agent/test_validator.py
git commit -m "feat(agent): add post-validation for image completeness and content quality"
```

---

## Task 5: Agent 工具 — extract_document

**Files:**
- Create: `agent-service/app/agent/tools/__init__.py`
- Create: `agent-service/app/agent/tools/extract_document.py`
- Test: `agent-service/tests/agent/tools/__init__.py`
- Test: `agent-service/tests/agent/tools/test_extract_document.py`

- [ ] **Step 1: 创建包目录**
```bash
mkdir -p agent-service/app/agent/tools agent-service/tests/agent/tools
touch agent-service/app/agent/tools/__init__.py agent-service/tests/agent/tools/__init__.py
```

- [ ] **Step 2: 写失败测试**
```python
# tests/agent/tools/test_extract_document.py
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from app.agent.tools.extract_document import extract_document_impl
from app.agent.deps import AgentDeps

@pytest.fixture
def deps_with_file():
    return AgentDeps(
        thread_id="t1", page_id="page-1", workspace_id="ws-1",
        user_id="u1", docmost_base_url="http://localhost:3000",
        internal_secret="secret",
        files=[{"content_b64": "dGVzdA==", "filename": "test.pdf", "mimetype": "application/pdf"}],
    )

@pytest.fixture
def deps_no_files():
    return AgentDeps(
        thread_id="t", page_id=None, workspace_id="w", user_id="u",
        docmost_base_url="http://localhost:3000", internal_secret="s",
    )

@pytest.mark.asyncio
async def test_returns_content(deps_with_file):
    mock_am = MagicMock()
    mock_am.source_markdown = "# Test\nContent here"
    mock_am.items = []
    with patch("app.agent.tools.extract_document.parse_document", return_value=mock_am):
        result = await extract_document_impl(deps_with_file)
    assert "[Document Content]" in result
    assert "Test" in result

@pytest.mark.asyncio
async def test_no_files_returns_message(deps_no_files):
    result = await extract_document_impl(deps_no_files)
    assert "[No Files]" in result

@pytest.mark.asyncio
async def test_uploads_images_and_tracks_urls(deps_with_file):
    mock_am = MagicMock()
    mock_am.source_markdown = "content"
    img_item = MagicMock()
    img_item.type = "image"
    img_item.content = "http://docmost/files/img.jpg"
    img_item.source_ref = "page1_img1.jpg"
    img_item.id = "img-1"
    mock_am.items = [img_item]
    with patch("app.agent.tools.extract_document.parse_document", return_value=mock_am), \
         patch("app.agent.tools.extract_document.upgrade_source_image_assets", new_callable=AsyncMock, return_value=[img_item]):
        result = await extract_document_impl(deps_with_file)
    assert "http://docmost/files/img.jpg" in result
    assert deps_with_file.uploaded_image_urls.get("page1_img1.jpg") == "http://docmost/files/img.jpg"

@pytest.mark.asyncio
async def test_handles_parse_error(deps_with_file):
    with patch("app.agent.tools.extract_document.parse_document", side_effect=RuntimeError("parse failed")):
        result = await extract_document_impl(deps_with_file)
    assert "[Error]" in result
```

- [ ] **Step 3: 运行测试确认失败**

- [ ] **Step 4: 实现 extract_document.py**

完整代码见 spec v2 第 2.4 节。关键点：
- `extract_document_impl(deps)` 是可测试的核心逻辑（不需要 RunContext）
- `extract_document_tool(ctx)` 是 PydanticAI 工具包装
- 异步并行解析多文件：`asyncio.gather(*tasks)`
- 图片上传后 URL 写入 `deps.uploaded_image_urls`（供后验证使用）
- 所有异常 catch 并返回 `[Error]` 字符串

- [ ] **Step 5: 运行测试确认通过**

- [ ] **Step 6: 提交**
```bash
git add agent-service/app/agent/tools/ agent-service/tests/agent/tools/
git commit -m "feat(agent): add extract_document tool with image upload"
```

---

## Task 6: Agent 工具 — scrape_url, search_web, read_page

**Files:**
- Create: `agent-service/app/agent/tools/scrape_url.py`
- Create: `agent-service/app/agent/tools/search_web.py`
- Create: `agent-service/app/agent/tools/read_page.py`
- Modify: `agent-service/app/agent/tools/__init__.py`
- Test: `agent-service/tests/agent/tools/test_scrape_url.py`
- Test: `agent-service/tests/agent/tools/test_search_web.py`
- Test: `agent-service/tests/agent/tools/test_read_page.py`

- [ ] **Step 1: 写 scrape_url 测试**
```python
# tests/agent/tools/test_scrape_url.py
import pytest
from unittest.mock import AsyncMock, patch
from app.agent.tools.scrape_url import scrape_url_impl

@pytest.mark.asyncio
async def test_returns_content():
    # firecrawl_scrape 是 sync 函数，返回 str（不是 dict）
    # 使用 MagicMock（非 AsyncMock），通过 asyncio.to_thread patch
    with patch("app.agent.tools.scrape_url.firecrawl_scrape", return_value="Page content about Python") as m:
        result = await scrape_url_impl("https://example.com")
    assert "Page content" in result
    assert "[Web Content" in result

@pytest.mark.asyncio
async def test_invalid_url():
    result = await scrape_url_impl("not-a-url")
    assert "[Error]" in result

@pytest.mark.asyncio
async def test_empty_content():
    with patch("app.agent.tools.scrape_url.firecrawl_scrape", return_value="") as m:
        result = await scrape_url_impl("https://example.com")
    assert "[Error]" in result

@pytest.mark.asyncio
async def test_truncates_long_content():
    with patch("app.agent.tools.scrape_url.firecrawl_scrape", return_value="x" * 20000) as m:
        result = await scrape_url_impl("https://example.com")
    assert "[Truncated" in result
    assert len(result) < 10000
```

- [ ] **Step 2: 写 search_web 和 read_page 测试**（类似结构，见 spec v2）

- [ ] **Step 3: 运行所有测试确认失败**

- [ ] **Step 4: 实现三个工具**

完整代码见 spec v2 第 2.4 节。每个工具遵循模式：
- `xxx_impl()` 可测试核心逻辑
- `xxx_tool(ctx)` PydanticAI 工具包装
- try/except 返回 `[Error]` 字符串
- `asyncio.wait_for()` 超时保护

- [ ] **Step 5: 更新 __init__.py**
```python
# app/agent/tools/__init__.py
from app.agent.tools.extract_document import extract_document_tool
from app.agent.tools.scrape_url import scrape_url_tool
from app.agent.tools.search_web import search_web_tool
from app.agent.tools.read_page import read_page_tool

ALL_TOOLS = [extract_document_tool, scrape_url_tool, search_web_tool, read_page_tool]
```

- [ ] **Step 6: 运行测试确认通过**
```bash
cd agent-service && python -m pytest tests/agent/tools/ -v
```

- [ ] **Step 7: 提交**
```bash
git add agent-service/app/agent/tools/ agent-service/tests/agent/tools/
git commit -m "feat(agent): add scrape_url, search_web, read_page tools"
```

---

## Task 7: 核心 Agent 定义

**Files:**
- Create: `agent-service/app/agent/agent.py`
- Test: `agent-service/tests/agent/test_agent.py`

- [ ] **Step 1: 写测试**
```python
# tests/agent/test_agent.py
from app.agent.agent import get_agent, reset_agent, create_agent
from app.agent.deps import AgentDeps

def test_create_agent():
    agent = create_agent()
    assert agent is not None

def test_singleton_returns_same_instance():
    reset_agent()
    a1 = get_agent()
    a2 = get_agent()
    assert a1 is a2

def test_reset_clears_singleton():
    reset_agent()
    a1 = get_agent()
    reset_agent()
    a2 = get_agent()
    assert a1 is not a2

def test_agent_has_system_prompt():
    agent = create_agent()
    assert len(agent._system_prompts) > 0

def test_agent_has_model_settings():
    agent = create_agent()
    assert agent.model_settings is not None
    # max_tokens 是动态值（由 model_limits.py 决定），不硬编码 65536
    max_tok = agent.model_settings.get("max_tokens") if isinstance(agent.model_settings, dict) else getattr(agent.model_settings, "max_tokens", None)
    assert max_tok is not None and max_tok > 0
```

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现 agent.py**

完整代码见 spec v2 第 2.1 节。关键：
- `_agent` 模块级变量（单例）
- `get_agent()` 懒初始化，调用 `create_agent()`
- `create_agent(model=None, extra_tools=None)` 工厂函数
- `reset_agent()` 用于测试
- `max_tokens = get_max_tokens_for_current_model()` 动态值（来自 Task 0.6 的 model_limits.py）
- Thinking 配置：`try: from pydantic_ai.models.settings import ThinkingConfig; model_settings_kwargs["thinking"] = ThinkingConfig(type="enabled", budget_tokens=8000)` — ImportError 静默忽略
- `end_strategy='early'`

- [ ] **Step 4: 运行测试确认通过**

注意：测试中 `test_agent_has_model_settings` 需调整为检查 `max_tokens > 0` 而非 `== 65536`，因为 max_tokens 是动态值。

- [ ] **Step 5: 提交**
```bash
git add agent-service/app/agent/agent.py agent-service/tests/agent/test_agent.py
git commit -m "feat(agent): add core Agent singleton with dynamic max_tokens and Thinking capability"
```

---

## Task 8: Agent Runner

**Files:**
- Create: `agent-service/app/agent/runner.py`
- Test: `agent-service/tests/agent/test_runner.py`

- [ ] **Step 1: 写测试**
```python
# tests/agent/test_runner.py
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from app.agent.runner import run_agent
from app.agent.deps import AgentDeps

@pytest.fixture
def deps():
    return AgentDeps(
        thread_id="t1", page_id="p1", workspace_id="ws1", user_id="u1",
        docmost_base_url="http://localhost:3000", internal_secret="secret",
    )

@pytest.mark.asyncio
async def test_yields_content_and_done(deps):
    """Runner should yield content and done events."""
    from pydantic_ai.messages import PartDeltaEvent, TextPartDelta, FinalResultEvent

    async def mock_stream(*args, **kwargs):
        yield PartDeltaEvent(index=0, delta=TextPartDelta(content_delta="Hello"))
        yield FinalResultEvent(tool_name=None, tool_call_id=None)

    with patch("app.agent.runner.get_agent") as mock_get:
        mock_agent = MagicMock()
        mock_agent.run_stream_events = mock_stream
        mock_get.return_value = mock_agent

        events = []
        async for e in run_agent("test", deps):
            events.append(e)

    types = [e["type"] for e in events]
    assert "content" in types
    assert "done" in types

@pytest.mark.asyncio
async def test_yields_error_on_exception(deps):
    async def mock_stream(*args, **kwargs):
        raise RuntimeError("LLM error")
        yield  # make it async generator

    with patch("app.agent.runner.get_agent") as mock_get:
        mock_agent = MagicMock()
        mock_agent.run_stream_events = mock_stream
        mock_get.return_value = mock_agent

        events = []
        async for e in run_agent("test", deps):
            events.append(e)

    assert any(e["type"] == "error" for e in events)

@pytest.mark.asyncio
async def test_validation_warning_on_missing_image(deps):
    """Should yield warning when image URL missing from output."""
    deps.uploaded_image_urls = {"img1": "http://example.com/missing.jpg"}

    from pydantic_ai.messages import PartDeltaEvent, TextPartDelta, FinalResultEvent
    async def mock_stream(*args, **kwargs):
        yield PartDeltaEvent(index=0, delta=TextPartDelta(content_delta="No images here"))
        yield FinalResultEvent(tool_name=None, tool_call_id=None)

    with patch("app.agent.runner.get_agent") as mock_get:
        mock_agent = MagicMock()
        mock_agent.run_stream_events = mock_stream
        mock_get.return_value = mock_agent

        events = []
        async for e in run_agent("test", deps):
            events.append(e)

    assert any(e.get("type") == "warning" for e in events)
```

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 实现 runner.py**

完整代码见 spec v2 第 4 节。关键点：
- 加载对话历史（如有 session_store）
- multimodal_parts 合并到 prompt
- `agent.run_stream_events()` 流式执行
- 每个事件间检查 `is_task_cancelled(None, deps.thread_id)`（**注意**：实际函数签名是两个参数，不是 `is_cancelled(thread_id)`）
- 收集 final_output 用于后验证（优先用 `AgentRunResultEvent.result.output`）
- `FinalResultEvent` → 返回 None（不发 done），`done` 在循环结束后发出（E-01 修正）
- 后验证不通过时 yield `warning` 事件
- 保存对话历史

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: 提交**
```bash
git add agent-service/app/agent/runner.py agent-service/tests/agent/test_runner.py
git commit -m "feat(agent): add runner with session persistence, cancellation, post-validation"
```

---

## Task 9: FastAPI v2 端点

**Files:**
- Modify: `agent-service/app/main.py`
- Test: `agent-service/tests/agent/test_api.py`

- [ ] **Step 1: 写 API 测试**
```python
# tests/agent/test_api.py
import pytest
from httpx import AsyncClient, ASGITransport
from unittest.mock import patch, AsyncMock
from app.main import app

@pytest.mark.asyncio
async def test_v2_run_returns_sse():
    async def mock_run(*args, **kwargs):
        yield {"type": "content", "chunk": "Hello"}
        yield {"type": "done"}

    with patch("app.main.run_agent", side_effect=mock_run):
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post("/agent/v2/run", json={
                "prompt": "test",
                "workspace_id": "ws1",
                "user_id": "u1",
            }, headers={"X-Internal-Secret": "test"})
        assert response.status_code == 200
        assert "text/event-stream" in response.headers.get("content-type", "")
```

- [ ] **Step 2: 运行测试确认失败**

- [ ] **Step 3: 在 main.py 中添加 `/agent/v2/run` 端点**

```python
# 在 main.py 中添加（保留旧端点不变）
import json, uuid, base64
from app.agent.runner import run_agent
from app.agent.deps import AgentDeps
from pydantic_ai.messages import BinaryContent

@app.post("/agent/v2/run")
async def run_agent_v2(request: dict):
    """Intelligent agent endpoint — single ReAct agent with tool calling."""
    thread_id = request.get("thread_id") or str(uuid.uuid4())
    user_message = request.get("prompt", "")
    page_id = request.get("page_id")
    workspace_id = request.get("workspace_id", "")
    user_id = request.get("user_id", "")
    files = request.get("files", [])

    deps = AgentDeps(
        thread_id=thread_id,
        page_id=page_id,
        workspace_id=workspace_id,
        user_id=user_id,
        docmost_base_url=settings.docmost_internal_url,
        internal_secret=settings.internal_api_secret,
        files=files,
    )

    # 构建多模态输入
    multimodal_parts = []
    for f in files:
        try:
            data = base64.b64decode(f["content_b64"])
            multimodal_parts.append(BinaryContent(data=data, media_type=f["mimetype"]))
        except Exception:
            pass  # 解码失败的文件跳过多模态，仍通过 extract_document 工具处理

    async def event_generator():
        yield {"data": json.dumps({"type": "session", "thread_id": thread_id})}
        async for event in run_agent(user_message, deps, multimodal_parts=multimodal_parts):
            yield {"data": json.dumps(event, ensure_ascii=False)}

    from sse_starlette.sse import EventSourceResponse
    return EventSourceResponse(event_generator())
```

- [ ] **Step 4: 运行测试确认通过**

- [ ] **Step 5: 提交**
```bash
git add agent-service/app/main.py agent-service/tests/agent/test_api.py
git commit -m "feat(agent): add /agent/v2/run FastAPI endpoint with SSE streaming"
```

---

## Task 10: NestJS Gateway v2 代理端点

**Files:**
- Modify: `apps/server/src/ee/ai/agent-gateway/agent-gateway.service.ts`
- Modify: `apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts`

- [ ] **Step 1: 在 Service 中添加 v2 代理方法**

在 `agent-gateway.service.ts` 中添加 `proxyAgentV2Run` 方法，发送 JSON 到 `/agent/v2/run`，返回 SSE 流。复用现有的 `http.request` SSE 代理模式。

关键差异（vs 旧方法）：
- 请求格式简化为 JSON（不是 multipart）
- 不需要 `buildLegacyRunPayload` 的复杂字段映射
- 文件以 `content_b64` 数组传递

- [ ] **Step 2: 在 Controller 中添加 v2 端点**

```typescript
@Post('agent/v2/run')
async agentV2Run(@Req() req, @AuthUser() user, @AuthWorkspace() workspace) {
  // 1. 解析请求（支持 multipart 文件上传 → 转 base64）
  // 2. 并发限制检查（复用现有 acquireTaskSlot）
  // 3. Redis 注册 session owner
  // 4. 代理到 Python /agent/v2/run
  // 5. 流式返回 SSE
}
```

- [ ] **Step 3: 提交**
```bash
git add apps/server/src/ee/ai/agent-gateway/
git commit -m "feat(gateway): add /api/agent/v2/run proxy endpoint"
```

---

## Task 11: 端到端冒烟测试

**Files:**
- Create: `agent-service/tests/agent/test_e2e_smoke.py`

- [ ] **Step 1: 写 E2E 测试**
```python
# tests/agent/test_e2e_smoke.py
"""需要运行中的 LLM。跳过: pytest -m "not e2e" """
import pytest

pytestmark = pytest.mark.e2e

@pytest.mark.asyncio
async def test_text_only_request():
    """纯文本指令，Agent 应直接生成内容不调工具。"""
    from app.agent.agent import create_agent, reset_agent
    from app.agent.runner import run_agent
    from app.agent.deps import AgentDeps

    reset_agent()
    deps = AgentDeps(
        thread_id="e2e-1", page_id=None, workspace_id="ws",
        user_id="u", docmost_base_url="http://localhost:3000",
        internal_secret="test",
    )
    events = []
    async for e in run_agent("写一段关于 Python 的简短介绍", deps):
        events.append(e)

    content = "".join(e.get("chunk", "") for e in events if e.get("type") == "content")
    assert len(content) > 50
    assert any(e["type"] == "done" for e in events)
    # 不应有 tool_call（纯文本请求）
    tool_calls = [e for e in events if e.get("type") == "tool_call"]
    assert len(tool_calls) == 0
```

- [ ] **Step 2: 运行冒烟测试**
```bash
cd agent-service && python -m pytest tests/agent/test_e2e_smoke.py -v -m e2e
```

- [ ] **Step 3: 提交**
```bash
git add agent-service/tests/agent/test_e2e_smoke.py
git commit -m "test(agent): add end-to-end smoke test"
```

---

## Task 12: 清理 + 文档

**Files:**
- Create: `agent-service/app/agent/README.md`
- 清理: `agent-service/app/orchestrator/engine.py` 中的 print debug

- [ ] **Step 1: 写 Agent 模块 README**

```markdown
# Docmost Intelligent Agent

PydanticAI tool-calling agent，取代多层级编排系统。

## 文件说明
- `agent.py` — Agent 单例定义（model + tools + skill）
- `deps.py` — 运行时依赖容器（每请求独立）
- `skill.py` — TipTap 创作规则（system_prompt）
- `event_bridge.py` — PydanticAI 事件 → SSE 事件
- `runner.py` — 执行引擎（会话管理 + 取消 + 后验证）
- `validator.py` — 输出后验证器
- `tools/` — 可扩展工具集

## 新增工具
1. 在 `tools/` 下创建 `my_tool.py`
2. 实现 `async def my_tool_tool(ctx: RunContext[AgentDeps], ...) -> str`
3. 在 `tools/__init__.py` 的 ALL_TOOLS 中注册
4. 写测试
```

- [ ] **Step 2: 清理 engine.py debug 日志**（转为 logger.debug 或删除）

- [ ] **Step 3: 清理 langchain 装饰器**

当前 `agent-service/app/tools/tavily_search.py` 使用了 `@register_tool @tool` 装饰器（来自 langchain_core）。新 Agent 通过 `asyncio.to_thread(tavily_search, query)` 直接调用此函数，但 langchain `@tool` 装饰器会将函数包装为 langchain Tool 对象，调用语义可能不同。

检查并修复：
```python
# 检查装饰器是否影响直接调用
from app.tools.tavily_search import tavily_search
result = tavily_search("test query")  # 直接调用
print(type(result))  # 应为 str，不是 ToolMessage
```

如调用行为正常（返回 str）则保留装饰器不影响使用，但标注为废弃。
如调用返回非 str，需拆分为：
```python
def _tavily_search_impl(query: str, max_results: int = 5) -> str:
    """实际逻辑，不含 langchain 装饰器"""
    client = TavilyClient(api_key=settings.tavily_api_key)
    ...

# 保持原装饰器版本用于兼容
@register_tool
@tool
def tavily_search(query: str, max_results: int = 5) -> str:
    return _tavily_search_impl(query, max_results)
```

并更新 `search_web_tool` 中调用 `_tavily_search_impl` 而非 `tavily_search`。

- [ ] **Step 4: 提交**
```bash
git add -A
git commit -m "docs(agent): add README, clean debug logs, fix langchain decorator compatibility"
```

---

## Phase 1 完成标志

- [ ] pydantic-ai >= 1.72.0 安装（Task 0.5）
- [ ] `model_limits.py` 实现并测试通过（Task 0.6）
- [ ] `llm_factory.py` 已更新（OpenAIChatModel + openai-responses provider，Task 0.7）
- [ ] `/agent/v2/run` 端点接收文本 + 文件
- [ ] Agent 自主决定工具调用（有文件 → extract_document，有 URL → scrape_url）
- [ ] 工具执行过程 SSE 实时推送（tool_call + tool_result + thinking + content + done）
- [ ] 输出符合 TipTap Markdown 语法（callout/table/image/heading）
- [ ] 后验证检查图片完整性（warning 事件而非阻断）
- [ ] `ModelSettings` 使用动态 `max_tokens`（不再硬编码 65536）
- [ ] Thinking 能力配置在 agent.py 中（ThinkingConfig，静默兼容旧版本）
- [ ] `is_task_cancelled(None, thread_id)` 正确调用（不是 `is_cancelled(thread_id)`）
- [ ] `FinalResultEvent` → None，`done` 在循环结束后发出（E-01 修正）
- [ ] 旧端点 `/agent/run` 保持不变
- [ ] 单元测试覆盖所有模块（model_limits/deps/skill/event_bridge/validator/tools/runner）
- [ ] E2E 冒烟测试通过
- [ ] langchain 装饰器兼容性验证完成（Task 12）
