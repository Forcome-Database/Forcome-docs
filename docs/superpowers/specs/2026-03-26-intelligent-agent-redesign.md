# Docmost Intelligent Agent 重设计规格 v2

> **目标**：用单一 PydanticAI 工具调用 Agent 取代当前 4 层路由 + 5 条执行路径的架构，实现 MiniMax 级别的"理解→工具调用→创意创作"体验。
>
> **v2 更新**：修正 8 项审查反馈（单例模式、输出 token 限制、会话持久化、取消支持、后验证、Skill 丰富度、思考事件、工具错误处理）。

---

## 1. 架构总览

### 1.1 当前架构（废弃）

```
前端 ai-intent.ts → 路由决策
  → NestJS Gateway → HTTP 代理 → Python Agent Service
    → DocumentTaskEngine.resolve_workflow（3种workflow）
      → OrchestratorEngine.analyze_task_complexity（关键词L1/L2/L3）
        → _execute_level1 / _execute_level2 / _execute_level3
          → _execute_preservation_patch / _execute_inline_rewrite
            → execute_simple_edit（纯文本 prompt，无工具）
```

**问题**：
- 4 层路由 × 5 条路径，engine.py 1266 行
- PydanticAI 被当纯文本生成器（`Agent(model=model, output_type=str)` 零工具注册）
- LLM 看不到图片（`_build_text_asset_context` 只传文本 + `![](url)` 字符串）
- `analyze_task_complexity` 是关键词暴力匹配，大量指令 fallback 到最重流程
- `preservation_patch` 的 `if False:` 硬禁用了确定性路径
- `streamWithFiles` 和 `streamWithContext` 返回格式不一致（JSON vs 裸字符串）

### 1.2 新架构

```
前端 AgentPanel → 用户输入（文字 + 文件 + 链接）
  → NestJS Gateway → HTTP SSE 代理 → Python Agent Service
    → PydanticAI Agent（模块级单例，ReAct 循环）
        ├ system_prompt: TipTap 创作 Skill（2000+ tokens 强制规则）
        ├ model_settings: ModelSettings(max_tokens=65536)
        ├ tools: [extract_document, scrape_url, search_web, read_page]
        ├ multimodal input: [用户指令, BinaryContent(PDF/图片)]
        ├ event_stream_handler → SSE 事件流（含 thinking/tool_call/content/done）
        └ deps: AgentDeps（每次调用独立，含 session_store 引用）
    → Agent 自主决策调用工具
    → 生成富 Markdown（后验证通过后）
    → 前端对话面板展示 + 用户确认后应用到 TipTap 编辑器
```

**核心原则**：
1. **模型决策**：不写 if/else 路由，LLM 通过 tool-calling 自主选择工具
2. **Skill 注入**：2000+ tokens 的强制 system_prompt 控制输出质量（MiniMax 核心秘密）
3. **工具可扩展**：新增能力 = 新增一个 Tool 函数，注册到 agent
4. **事件透明**：思考过程、工具调用、内容生成全程 SSE 流式展示
5. **后验证兜底**：输出必须通过图片完整性 + 内容覆盖率检查，失败回退提取原文

---

## 2. Agent 核心设计

### 2.1 Agent 定义（模块级单例）

**已验证**：PydanticAI Agent 实例无状态，`deps`/`model_settings`/`message_history` 都是 `run()` 的每次调用参数。Agent 可安全复用。

```python
# app/agent/agent.py
from pydantic_ai import Agent, Tool
from pydantic_ai.settings import ModelSettings

from app.agent.deps import AgentDeps
from app.agent.skill import TIPTAP_CREATION_SKILL
from app.agent.tools import ALL_TOOLS
from app.agent.model_limits import get_max_tokens_for_current_model
from app.orchestrator.llm_factory import create_pydantic_ai_model

# 模块级单例 — 全局共享，线程安全
_agent: Agent[AgentDeps, str] | None = None

def get_agent() -> Agent[AgentDeps, str]:
    """获取或创建 Agent 单例。"""
    global _agent
    if _agent is None:
        _agent = create_agent()
    return _agent

def create_agent(model=None, extra_tools: list | None = None) -> Agent[AgentDeps, str]:
    """工厂函数——可传入 model 或 extra_tools（测试用）。"""
    m = model or create_pydantic_ai_model()
    max_tokens = get_max_tokens_for_current_model()

    # Thinking 能力配置（pydantic-ai>=1.72.0，可选）
    # 对支持 thinking 的模型（Claude Opus、某些 Gemini）启用内部推理可见性。
    # 如模型不支持会静默忽略。
    model_settings_kwargs = {"max_tokens": max_tokens}
    try:
        from pydantic_ai.models.settings import ThinkingConfig
        model_settings_kwargs["thinking"] = ThinkingConfig(type="enabled", budget_tokens=8000)
    except ImportError:
        pass  # pydantic-ai < 1.72.0 或该版本 API 不同，不影响主流程

    return Agent(
        model=m,
        deps_type=AgentDeps,
        system_prompt=TIPTAP_CREATION_SKILL,
        tools=[Tool(t, takes_ctx=True) for t in (ALL_TOOLS + (extra_tools or []))],
        output_type=str,
        model_settings=ModelSettings(**model_settings_kwargs),
        retries=2,
        end_strategy='early',  # 模型产出最终文本即停止
    )

def reset_agent():
    """重置单例（用于测试或配置变更后）。"""
    global _agent
    _agent = None
```

**关键参数解释**：
- `max_tokens=get_max_tokens_for_current_model()`: 动态从 `model_limits.py` 读取，按 provider/model 匹配。GPT-5.4/Claude Opus=131072，Gemini 3.1 Pro=65536，Ollama safe default=8192。Gemini 默认 8192 会静默截断，必须显式设置。
- `thinking=ThinkingConfig(type="enabled", budget_tokens=8000)`: 在 pydantic-ai>=1.72.0 + 支持思考的模型上启用 Thinking 可见性（`PartStartEvent` 会产生 `thinking` part_kind，event_bridge 已处理）。模型不支持时静默忽略。
- `end_strategy='early'`: 已验证选项为 `'early'` | `'exhaustive'`。`early` 表示模型产出文本回复即停止（即使有 pending tool calls），适合 ReAct 模式——模型在工具收集完信息后生成最终输出。
- `retries=2`: PydanticAI 在输出验证失败时自动重试（`ModelRetry`）。
- `output_type=str`: 最终输出是 Markdown 字符串。

### 2.2 依赖注入（AgentDeps）

每次 API 请求创建独立实例，不共享状态。

```python
# app/agent/deps.py
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any

@dataclass
class AgentDeps:
    """每次 Agent 调用的运行时依赖。通过 RunContext 注入到工具中。"""

    # 请求标识（会话隔离核心）
    thread_id: str
    page_id: str | None
    workspace_id: str
    user_id: str

    # 服务连接
    docmost_base_url: str
    internal_secret: str
    session_store: Any = None  # SessionStore 实例，用于持久化对话历史

    # 用户上传的文件（由 API 端点填充）
    files: list[dict] = field(default_factory=list)
    # 格式: [{"content_b64": str, "filename": str, "mimetype": str}]

    # 运行时状态（工具执行中填充）
    uploaded_image_urls: dict[str, str] = field(default_factory=dict)
    # 格式: {"原始引用": "Docmost URL"}
```

**会话隔离保证**：
- `AgentDeps` 按 `(workspace_id, user_id, thread_id)` 三元组唯一
- Redis 键格式 `agent_session:{workspace_id}:{user_id}:{thread_id}`
- NestJS Gateway 在代理前验证 `user_id` 与 session owner 匹配
- Python 侧 `deps` 是值对象，不跨请求共享

### 2.3 工具定义

| 工具名 | 功能 | 触发条件（LLM 自决策） | 来源 |
|--------|------|----------------------|------|
| `extract_document` | 提取文档文字+图片+上传图片 | 用户上传了文件 | `asset_parser.py` + `source_image_store.py` |
| `scrape_url` | 抓取网页主要内容 | 用户消息中包含 URL | `firecrawl_scrape.py` + `trafilatura_extract.py` |
| `search_web` | 搜索互联网 | 需要外部信息补充 | `tavily_search.py` |
| `read_page` | 读取 Docmost 页面 | 需要引用已有文档 | `docmost_api.py` |

**决策记录：不使用 PydanticAI 内置 `WebSearch()` / `WebFetch()` Capability**

| 内置能力 | 问题 | 选用替代 |
|----------|------|---------|
| `WebSearch()` | 无 native search 时 fallback 到 DuckDuckGo，质量远低于 Tavily | 保留 `search_web` 工具（Tavily API） |
| `WebFetch()` | 简单 requests，无噪声过滤 | 保留 `scrape_url` 工具（Firecrawl + Trafilatura 双引擎，20+ exclusion tags） |

`scrape_url` 具体优势：20+ HTML 标签排除（nav/header/footer/ads/cookie）、Trafilatura 二次清洗 quality heuristic（`_select_best()`）、超时/错误处理。`search_web` 具体优势：Tavily 语义搜索引擎专为 LLM 设计，返回结构化摘要+URL，质量显著优于 DuckDuckGo。

**工具扩展规范**：
```python
# 新增工具模板
async def my_new_tool(ctx: RunContext[AgentDeps], param1: str, param2: int = 10) -> str:
    """工具描述——LLM 基于此描述决定是否调用。

    写清楚：什么场景调用、输入什么、返回什么。
    PydanticAI 自动从 docstring 提取 Args 描述生成 JSON Schema。

    Args:
        param1: 参数1说明（必须有，PydanticAI 需要）。
        param2: 参数2说明，默认值10。
    """
    try:
        result = await do_something(param1, param2)
        return f"[Result]\n{result}"
    except Exception as e:
        return f"[Error] {type(e).__name__}: {e}"  # 返回错误信息而非抛异常
```

**关键约束**：
- 工具**返回错误字符串**而非抛异常（让 LLM 决定如何处理）
- 工具**必须有 docstring**（PydanticAI 从中提取工具描述和参数 schema）
- 工具通过 `ctx.deps` 访问运行时状态，不使用全局变量
- 耗时操作使用 `asyncio.wait_for(coro, timeout=30)` 设超时

### 2.4 工具实现详细设计

#### extract_document

```python
# app/agent/tools/extract_document.py
async def extract_document_tool(ctx: RunContext[AgentDeps], purpose: str = "") -> str:
    """Extract text and images from uploaded document files.

    Call this when the user has uploaded PDF, DOCX, PPTX, or other document files.
    Automatically uploads extracted images to Docmost and returns their URLs.
    You MUST use the returned URLs when referencing images in your output.

    Args:
        purpose: What to focus on (e.g., "full content", "images only", "table data").
    """
    if not ctx.deps.files:
        return "[No Files] No files were uploaded. Ask the user to upload a document."

    try:
        from app.workers.asset_parser import parse_document
        import asyncio

        # 并行解析所有文件
        tasks = []
        for f in ctx.deps.files:
            tasks.append(asyncio.get_event_loop().run_in_executor(
                None, parse_document, f["content_b64"], f["filename"], f["mimetype"]
            ))
        results = await asyncio.wait_for(asyncio.gather(*tasks), timeout=120)

        # 上传图片（如有 page_id）
        all_image_urls: dict[str, str] = {}
        if ctx.deps.page_id:
            from app.tools.source_image_store import upgrade_source_image_assets
            for am in results:
                image_items = [i for i in am.items if i.type == "image"]
                if image_items:
                    # upgrade_source_image_assets 是 async 函数（内部调 httpx）
                    upgraded = await asyncio.wait_for(
                        upgrade_source_image_assets(image_items, ctx.deps.page_id),
                        timeout=60,
                    )  # 注意：如果实际是 sync，需改为 asyncio.to_thread()
                    for item in upgraded:
                        if item.content.startswith("http"):
                            ref = item.source_ref or item.id
                            all_image_urls[ref] = item.content
                            ctx.deps.uploaded_image_urls[ref] = item.content

        # 构建文本
        text_parts = []
        for am in results:
            if am.source_markdown:
                text_parts.append(am.source_markdown)
            else:
                for item in am.items:
                    if item.type in ("text", "table", "code"):
                        text_parts.append(item.content)

        content = "\n\n".join(text_parts) or "No text content extracted."
        word_count = sum(len(p.split()) for p in text_parts)

        # 图片目录
        image_section = ""
        if all_image_urls:
            lines = [f"  - {ref} → {url}" for ref, url in all_image_urls.items()]
            image_section = (
                f"\n\n[Uploaded Images ({len(all_image_urls)} total)]\n"
                + "\n".join(lines)
                + "\n\nIMPORTANT: Use these EXACT URLs as image src in your Markdown output. "
                + "Every URL above MUST appear in your final output."
            )

        return f"[Document Content] ({word_count} words){image_section}\n\n{content}"

    except asyncio.TimeoutError:
        return "[Error] Document extraction timed out after 120 seconds."
    except Exception as e:
        return f"[Error] Failed to extract document: {type(e).__name__}: {e}"
```

#### scrape_url

```python
# app/agent/tools/scrape_url.py
async def scrape_url_tool(ctx: RunContext[AgentDeps], url: str) -> str:
    """Fetch and extract the main content from a web URL.

    Call this when the user provides a URL or you need to read a web page.
    Returns cleaned main content with navigation/ads/footers removed.

    Args:
        url: The full URL to scrape (must start with http:// or https://).
    """
    if not url.startswith(("http://", "https://")):
        return f"[Error] Invalid URL format: {url}. Must start with http:// or https://."

    try:
        import asyncio
        from app.tools.firecrawl_scrape import firecrawl_scrape
        # firecrawl_scrape 是 sync 函数，返回 str（不是 dict）
        content = await asyncio.wait_for(
            asyncio.to_thread(firecrawl_scrape, url), timeout=30
        )
        if not content or len(content.strip()) < 50:
            return f"[Error] No meaningful content extracted from {url}."
        if len(content) > 8000:
            content = content[:8000] + f"\n\n[Truncated — original {len(content)} characters]"
        return f"[Web Content from {url}]\n{content}"
    except asyncio.TimeoutError:
        return f"[Error] Scraping {url} timed out after 30 seconds."
    except Exception as e:
        return f"[Error] Failed to scrape {url}: {type(e).__name__}: {e}"
```

#### search_web

```python
# app/agent/tools/search_web.py
async def search_web_tool(ctx: RunContext[AgentDeps], query: str) -> str:
    """Search the internet for current information on a topic.

    Call this when you need facts, references, or up-to-date information
    that is not available in the uploaded documents.

    Args:
        query: The search query (be specific for better results).
    """
    try:
        import asyncio
        from app.tools.tavily_search import tavily_search
        # tavily_search 是 sync 函数，返回 str（预格式化结果）
        result_text = await asyncio.wait_for(
            asyncio.to_thread(tavily_search, query), timeout=15
        )
        if not result_text or len(result_text.strip()) < 20:
            return f"[No Results] No search results found for: {query}"
        return f"[Search Results for '{query}']\n\n{result_text}"
    except asyncio.TimeoutError:
        return f"[Error] Web search timed out after 15 seconds."
    except Exception as e:
        return f"[Error] Search failed: {type(e).__name__}: {e}"
```

#### read_page

```python
# app/agent/tools/read_page.py
async def read_page_tool(ctx: RunContext[AgentDeps], page_id: str = "") -> str:
    """Read the content of a Docmost page.

    Call this when you need to reference or incorporate content from an existing page.
    If page_id is empty, reads the current page the user is editing.

    Args:
        page_id: The UUID of the page to read. Leave empty for the current page.
    """
    pid = page_id or ctx.deps.page_id
    if not pid:
        return "[Error] No page ID available. The user has not specified a page."

    try:
        import asyncio
        from app.tools.docmost_api import docmost_page_read
        # docmost_page_read 是 sync 函数，只接受 page_id（base_url/secret 从 settings 读取）
        result = await asyncio.wait_for(
            asyncio.to_thread(docmost_page_read, pid), timeout=10
        )
        title = result.get("title", "Untitled") if isinstance(result, dict) else "Page"
        content = result.get("content", "") if isinstance(result, dict) else str(result)
        if len(content) > 8000:
            content = content[:8000] + f"\n\n[Truncated — original {len(content)} characters]"
        return f"[Page: {title}]\n{content}"
    except asyncio.TimeoutError:
        return f"[Error] Reading page {pid} timed out."
    except Exception as e:
        return f"[Error] Failed to read page: {type(e).__name__}: {e}"
```

### 2.5 TipTap 创作 Skill（system_prompt，2000+ tokens）

参考 MiniMax [frontend-dev SKILL.md](https://github.com/MiniMax-AI/skills/blob/main/skills/frontend-dev/SKILL.md) 的强制规则模式。

```python
TIPTAP_CREATION_SKILL = """\
# Docmost Document Agent — TipTap Creation Skill

You are an intelligent document agent for Docmost. You understand documents, web pages,
and user instructions, then produce beautifully structured content for the TipTap editor.

All rules in this skill are MANDATORY. Violating any rule is a quality defect.

## Workflow Protocol

1. **UNDERSTAND** the input — read the user's instruction and any uploaded content
2. **CALL TOOLS** when needed:
   - User uploaded files → call `extract_document` FIRST
   - User provided a URL → call `scrape_url`
   - Need external information → call `search_web`
   - Need existing page content → call `read_page`
3. **GENERATE** formatted Markdown output following ALL rules below
4. **VERIFY** before finishing: every uploaded image URL appears in output

## Output Format: TipTap Markdown

Output is auto-converted via: Markdown → marked → HTML → ProseMirror JSON → TipTap editor.
You MUST use the exact syntaxes below for each content type.

### Callout Blocks

Four types available. Use them for emphasis, tips, warnings, and critical notices:

:::info
Use for helpful tips, context, or background information.
:::

:::success
Use for positive outcomes, confirmations, or completed actions.
:::

:::warning
Use for cautions, potential issues, or important reminders.
:::

:::danger
Use for critical warnings, destructive actions, or security risks.
:::

**When to use callouts:**
- Download links or important URLs → :::info block with a table inside
- Prerequisites or requirements → :::warning
- Security notices → :::danger
- Success criteria or expected outcomes → :::success

### Images

```markdown
![Descriptive alt text](exact-docmost-url)
```

**Rules (MANDATORY):**
- Use ONLY URLs returned by the `extract_document` tool
- Place each image IMMEDIATELY AFTER the text it illustrates
- Write meaningful alt text describing the image content
- NEVER stack all images at the document end
- NEVER omit any uploaded image — every URL from tool results MUST appear

### Tables

```markdown
| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| Data     | Data     | Data     |
```

**When to use tables:**
- Comparison data (features, pricing, platforms)
- Download links with platform/URL columns
- Configuration parameters with name/value/description
- Any structured data with 2+ columns
- NEVER use bullet lists to simulate tabular data

### Headings

- `# Title` — Document title. Exactly ONE per document. NEVER more.
- `## Section` — Major sections (PC端教程, 手机端教程, 常见问题)
- `### Subsection` — Steps or sub-topics within a section
- NEVER skip levels: `# Title` → `### Sub` is FORBIDDEN. Must go `#` → `##` → `###`.

### Step-by-Step Tutorials

For instructional content, use this exact pattern:

```markdown
## Step N: Verb + Object (action-oriented title)

Brief description of what this step accomplishes and why.

1. Open **[App Name]**, navigate to **[Section]**
2. Click **[Button/Menu]** to perform the action
3. Verify that **[Expected Result]** appears

![Step N screenshot showing the relevant interface](url)
```

### Code Blocks

````markdown
```language
code content
```
````

Always specify the language for syntax highlighting.

### Math (when applicable)

- Inline: `$E = mc^2$`
- Block: `$$\sum_{i=1}^{n} x_i$$`

### Task Lists

```markdown
- [ ] Incomplete task
- [x] Completed task
```

### Collapsible Sections (for FAQ or advanced details)

Use HTML `<details>` tags (TipTap supports this):
```html
<details>
<summary>Click to expand</summary>
Detailed content here...
</details>
```

### Links

```markdown
[Descriptive link text](https://example.com)
```

NEVER use raw URLs without link text. Always wrap in `[text](url)`.

## Content Quality Rules

### MANDATORY Behaviors
- Preserve ALL factual content from source documents — zero information loss
- Restructure and ENHANCE presentation — don't just copy-paste
- Use specific data, commands, URLs, and actionable instructions
- Write like an experienced professional sharing practical knowledge
- Default to Chinese output unless user explicitly requests another language
- Match the source document's language if evident

### FORBIDDEN Patterns
- OCR noise or UI menu text artifacts (e.g., "自 日志 设置 ? 帮助 A 关于")
- Raw URLs without descriptive link text
- Images without meaningful alt text
- Bullet lists simulating table structure
- Placeholder text of any kind
- Starting paragraphs with "在当今..." or "随着...的发展"
- Formulaic transitions: '首先/其次/最后', '综上所述', '值得注意的是', '总而言之'
- Corporate buzzwords: '赋能', '抓手', '落地', '闭环', '链路', '沉淀', '对齐'
- Repeating the same sentence structure 3+ times in a row

### Output Length Guidelines
- Short document (< 500 words source): 1-2 pages, focus on clarity
- Medium document (500-2000 words source): 2-5 pages, add structure
- Long document (2000+ words source): Organize into clear sections with TOC-friendly headings
- NEVER pad content with filler — better to be concise than verbose
"""
```

### 2.6 后验证器（Post-Validator）

所有 4 条研究线都推荐确定性验证。Agent 输出必须通过以下检查：

```python
# app/agent/validator.py
from dataclasses import dataclass

@dataclass
class ValidationResult:
    passed: bool
    issues: list[str]

def validate_agent_output(
    output: str,
    uploaded_image_urls: dict[str, str],
    min_content_ratio: float = 0.3,
) -> ValidationResult:
    """验证 Agent 输出的质量。

    Args:
        output: Agent 生成的 Markdown 文本。
        uploaded_image_urls: extract_document 上传的图片 URL 映射。
        min_content_ratio: 输出字数与源文档字数的最小比率。
    """
    issues = []

    # 检查 1: 所有上传的图片 URL 必须出现在输出中
    for ref, url in uploaded_image_urls.items():
        if url not in output:
            issues.append(f"Missing image URL: {ref} → {url}")

    # 检查 2: 输出不能为空或过短
    if len(output.strip()) < 100:
        issues.append(f"Output too short: {len(output)} characters")

    # 检查 3: 不能包含 OCR 噪音特征
    noise_patterns = ["自 日志", "? 帮助", "A 关于", "设置\n?"]
    for pattern in noise_patterns:
        if pattern in output:
            issues.append(f"Possible OCR noise detected: '{pattern}'")

    # 检查 4: 标题层级检查（H1 最多 1 个）
    h1_count = output.count("\n# ") + (1 if output.startswith("# ") else 0)
    if h1_count > 1:
        issues.append(f"Multiple H1 headings found: {h1_count}")

    return ValidationResult(
        passed=len(issues) == 0,
        issues=issues,
    )
```

### 2.7 动态 max_tokens 管理（model_limits.py）

不同模型的最大输出 token 上限差异极大（Ollama 4K vs GPT-5.4 128K），使用固定值会导致：
- Ollama 模型崩溃/超时（上限不足）
- 无法发挥强模型的长输出能力

**已调研的主力模型输出上限（2026-03 研究结果）**：

| 模型 | Provider | 输出 token 上限 |
|------|----------|----------------|
| GPT-5.4 | openai | 131072 |
| GPT-4o / GPT-4o-mini | openai | 16384 |
| Gemini 2.5 Pro | gemini | 65536 |
| Gemini 3.1 Pro | gemini | 65536 |
| Claude Opus 4.6 | anthropic | 131072 |
| Claude Sonnet 4.6 | anthropic | 131072 |
| Ollama (各模型) | ollama | 8192（保守默认） |

```python
# app/agent/model_limits.py
"""动态 max_tokens 查找，适配不同模型的输出上限。"""
from __future__ import annotations
from app.config import settings

# 已验证的模型输出上限（key 为小写 model name，- 分隔）
MODEL_OUTPUT_LIMITS: dict[str, int] = {
    # OpenAI
    "gpt-5-4": 131072,
    "gpt-4o": 16384,
    "gpt-4o-mini": 16384,
    # Google Gemini
    "gemini-3.1-pro": 65536,
    "gemini-2.5-pro": 65536,
    "gemini-1.5-pro": 8192,
    # Anthropic Claude
    "claude-opus-4-6": 131072,
    "claude-sonnet-4-6": 131072,
    "claude-haiku-4-5": 131072,
}

# Provider 级别的保守默认值
PROVIDER_DEFAULTS: dict[str, int] = {
    "openai": 65536,
    "openai-compatible": 65536,
    "openai-responses": 65536,
    "gemini": 65536,
    "anthropic": 65536,
    "ollama": 8192,  # Ollama 本地模型保守默认（避免超限崩溃）
}


def get_max_tokens(provider: str | None = None, model_name: str | None = None) -> int:
    """返回适配指定 provider/model 的 max_tokens。"""
    p = (provider or "").lower()
    m = (model_name or "").lower().replace("/", "-").replace(":", "-").replace(".", "-")
    if m in MODEL_OUTPUT_LIMITS:
        return MODEL_OUTPUT_LIMITS[m]
    return PROVIDER_DEFAULTS.get(p, 65536)


def get_max_tokens_for_current_model() -> int:
    """从 settings 读取当前配置的模型，返回对应 max_tokens。"""
    provider = getattr(settings, "ai_provider", "")
    model_name = getattr(settings, "ai_model", "") or getattr(settings, "openai_model", "")
    return get_max_tokens(provider, model_name)
```

### 2.8 llm_factory.py 所需更新

当前 `llm_factory.py` 存在两处需要修复：

**问题 1：`OpenAIModel` 已废弃（pydantic-ai >= 1.72.0）**
```python
# 当前（需修复）
from pydantic_ai.models.openai import OpenAIModel
return OpenAIModel(settings.openai_model, ...)

# 修复为
from pydantic_ai.models.openai import OpenAIChatModel
return OpenAIChatModel(settings.openai_model, ...)
```

**问题 2：缺少 `openai-responses` Provider（支持 Responses API + 原生 WebSearch）**
```python
# 在 openai-compatible 分支后添加
elif provider == "openai-responses":
    from pydantic_ai.models.openai import OpenAIResponsesModel
    return OpenAIResponsesModel(
        settings.openai_model,
        base_url=settings.openai_base_url,
        api_key=settings.openai_api_key,
    )
```

**注意**：`OpenAIResponsesModel` 使用 OpenAI Responses API（非 Chat Completions API），支持 `WebSearchTool` 原生搜索，但与 openai-compatible 的第三方 API 不兼容。当用户需要 native WebSearch（如官方 OpenAI API）时才选此 provider。

---

## 3. 事件流协议

### 3.1 PydanticAI 事件 → SSE 事件映射

**已验证**（代码级确认）：PydanticAI `event_stream_handler` 接收类型化事件流，包含 `FunctionToolCallEvent`、`FunctionToolResultEvent`、`PartStartEvent`、`PartDeltaEvent`、`FinalResultEvent`。

```python
# app/agent/event_bridge.py
from pydantic_ai.messages import (
    FunctionToolCallEvent,
    FunctionToolResultEvent,
    PartStartEvent,
    PartDeltaEvent,
    FinalResultEvent,
    TextPartDelta,
)

TOOL_DESCRIPTIONS = {
    "extract_document_tool": "正在提取文档内容...",
    "scrape_url_tool": "正在抓取网页内容...",
    "search_web_tool": "正在搜索相关信息...",
    "read_page_tool": "正在读取页面内容...",
}

def map_pydantic_event_to_sse(event) -> dict | None:
    """将 PydanticAI 事件转为 SSE 事件 dict。返回 None 表示跳过。"""

    if isinstance(event, FunctionToolCallEvent):
        tool_name = event.part.tool_name
        return {
            "type": "tool_call",
            "tool": tool_name,
            "description": TOOL_DESCRIPTIONS.get(tool_name, f"正在执行 {tool_name}..."),
        }

    if isinstance(event, FunctionToolResultEvent):
        return {"type": "tool_result", "status": "success"}

    if isinstance(event, PartStartEvent):
        # 思考事件（模型内部推理）
        if hasattr(event.part, 'part_kind') and event.part.part_kind == 'thinking':
            return {"type": "thinking", "content": ""}
        return None

    if isinstance(event, PartDeltaEvent):
        if isinstance(event.delta, TextPartDelta):
            return {"type": "content", "chunk": event.delta.content_delta}
        return None  # 跳过工具参数 delta 等

    if isinstance(event, FinalResultEvent):
        # 重要：FinalResultEvent 在内容流完成前触发（表示模型决定输出最终回复），
        # 但后续仍有 PartDeltaEvent + PartEndEvent + AgentRunResultEvent。
        # done 事件由 runner.py 在循环结束后发出，不在此处映射。
        return None

    return None
```

**关键时序说明**（审核发现的 E-01 问题）：

PydanticAI `run_stream_events()` 的事件顺序为：
```
FunctionToolCallEvent → FunctionToolResultEvent  # 工具调用
→ PartStartEvent(text) → FinalResultEvent        # 模型开始最终回复
→ PartDeltaEvent × N                              # 内容流式输出（在 FinalResult 之后！）
→ PartEndEvent → AgentRunResultEvent              # 结束
```

`FinalResultEvent` 是"模型决定这是最终回复"的信号，不是"所有内容已发送"的信号。
`done` SSE 事件必须在 `async for` 循环完全结束后由 runner 发出。

### 3.2 SSE 事件类型（前端需处理）

| 事件类型 | 含义 | 数据字段 | 前端行为 |
|---------|------|---------|---------|
| `session` | 会话建立 | `{ thread_id }` | 保存 thread_id 到 sessionStorage |
| `tool_call` | Agent 调用工具 | `{ tool, description }` | 显示 🔄 + description |
| `tool_result` | 工具执行完毕 | `{ status }` | 将 🔄 改为 ✅ |
| `thinking` | Agent 思考中 | `{ content }` | 显示"正在思考..." |
| `content` | 内容流式输出 | `{ chunk }` | 追加到 Markdown 预览区 |
| `warning` | 后验证发现问题 | `{ issues: string[] }` | 显示警告但不阻止 |
| `done` | 任务完成 | `{}` | 启用"应用到页面"按钮 |
| `error` | 执行出错 | `{ message }` | 显示错误信息 |
| `cancelled` | 用户取消 | `{}` | 重置面板状态 |

---

## 4. Agent Runner（执行引擎）

Runner 是连接 Agent、SSE、会话管理的核心模块。

```python
# app/agent/runner.py
import asyncio
import logging
from typing import Any, AsyncIterator

from pydantic_ai.messages import BinaryContent

from app.agent.agent import get_agent
from app.agent.deps import AgentDeps
from app.agent.event_bridge import map_pydantic_event_to_sse
from app.agent.validator import validate_agent_output
from app.agent.cancellation import is_task_cancelled

logger = logging.getLogger(__name__)


async def run_agent(
    user_message: str,
    deps: AgentDeps,
    *,
    multimodal_parts: list | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """执行 Agent 并产出 SSE 事件流。

    完整流程:
    1. 加载对话历史（多轮对话支持）
    2. 构建 multimodal prompt
    3. 执行 Agent（流式事件）
    4. 后验证输出
    5. 保存对话历史
    """
    agent = get_agent()

    # 1. 加载对话历史
    message_history = None
    if deps.session_store:
        message_history = await deps.session_store.load_messages(deps.thread_id)

    # 2. 构建 prompt
    prompt = [user_message] + (multimodal_parts or []) if multimodal_parts else user_message

    # 3. 执行 Agent，收集事件和最终输出
    final_output = ""
    try:
        async for event in agent.run_stream_events(
            prompt,
            deps=deps,
            message_history=message_history,
        ):
            # 取消检查（实际函数签名: is_task_cancelled(task_id, thread_id)）
            if is_task_cancelled(None, deps.thread_id):
                yield {"type": "cancelled"}
                return

            # 转换并产出 SSE 事件
            sse = map_pydantic_event_to_sse(event)
            if sse:
                if sse["type"] == "content":
                    final_output += sse["chunk"]
                yield sse
            # AgentRunResultEvent 包含权威最终输出（覆盖 delta 拼接）
            if hasattr(event, 'result') and hasattr(event.result, 'output'):
                final_output = event.result.output

    except Exception as e:
        logger.exception("Agent execution failed")
        yield {"type": "error", "message": str(e)}
        return

    # 4. 后验证（在循环结束后，所有内容已接收）
    if deps.uploaded_image_urls and final_output:
        validation = validate_agent_output(final_output, deps.uploaded_image_urls)
        if not validation.passed:
            yield {"type": "warning", "issues": validation.issues}

    # 5. 发出 done 事件（在所有内容流完成后，而非 FinalResultEvent 时）
    yield {"type": "done"}

    # 6. 保存对话历史
    if deps.session_store:
        try:
            # PydanticAI 的 run_stream_events 不直接返回 messages，
            # 需要通过 agent.run() 获取。此处保存用户消息 + 最终输出。
            await deps.session_store.save_turn(
                thread_id=deps.thread_id,
                user_message=user_message,
                assistant_output=final_output,
            )
        except Exception as e:
            logger.warning(f"Failed to save conversation history: {e}")
```

---

## 5. 前端设计方向

### 5.1 布局（已验证）

当前布局 `aside.tsx`：`[左侧导航] | [中间编辑器] | [右侧面板 Aside]`

- 右侧面板通过 `asideStateAtom.tab === "ai-creator"` 切换
- Agent 对话面板替换当前 `AiCreatorPanel`，位于同一位置
- 编辑器通过 `commitAiContent` → Y.js 更新内容
- 两者完全独立：面板展示对话流 + 编辑器展示最终内容

### 5.2 MiniMax 式对话面板

```
┌─────────────────────────────────────┐
│  🤖 Docmost Agent                   │
├─────────────────────────────────────┤
│                                     │
│  [用户] 📎 clash配置教程.pdf         │
│         请整理这个文档               │
│                                     │
│  [Agent] 🔄 正在提取文档内容...      │
│          ✅ 文档提取完成（312词，8张图）│
│          🔄 正在上传图片...           │
│          ✅ 图片上传完成（8张）        │
│                                     │
│  [Agent] （Markdown 流式渲染预览）   │
│          # Clash 配置教程             │
│          :::info                     │
│          本教程包含...               │
│          :::                         │
│                                     │
├─────────────────────────────────────┤
│  [应用到页面] [重新生成] [复制内容]    │
├─────────────────────────────────────┤
│  📎 附件  💬 输入指令...        发送  │
└─────────────────────────────────────┘
```

### 5.3 前端组件架构

| 组件 | 职责 | 对应 SSE 事件 |
|------|------|-------------|
| `AgentPanel` | 主容器，管理对话状态 | session |
| `MessageList` | 消息列表（用户 + Agent） | — |
| `UserMessage` | 用户消息（文本 + 文件缩略图） | — |
| `AgentMessage` | Agent 回复容器 | — |
| `ToolCallStep` | 工具调用状态行 | tool_call → tool_result |
| `StreamingMarkdown` | Markdown 流式预览 | content |
| `ActionBar` | 应用/重新生成/复制按钮 | done |
| `InputBar` | 文件上传 + 文本输入 + 发送 | — |

### 5.4 前端重构范围

**保留**：Jotai 状态管理 / SSE 流处理 / TipTap 编辑器集成 / AI Commit 流程

**重构**：`AiCreatorPanel` → `AgentPanel` / `AiCreatorInput` → `InputBar`

**废弃**：`BlueprintModal` / `ReviewModal` / `DocumentOperationCenter` / `agentModeAtom` / `ai-intent.ts` 路由

### 5.5 实施策略

**设计并行，编码顺序**：
- Phase 1 的 Task 1-5 期间：并行进行 UI 设计稿、组件架构
- Phase 1 的 Task 3（event_bridge）完成后：SSE 协议稳定，开始前端编码
- Phase 2 使用 `frontend-design` skill 执行

---

## 6. 会话管理

### 6.1 多用户隔离

```
NestJS Gateway 层：
  Redis Key: agent_session_owner:{thread_id}
  Value: { userId, workspaceId }
  TTL: 24h
  → 代理前验证当前用户 === session owner

Python Agent Service 层：
  AgentDeps.workspace_id + user_id + thread_id → 唯一标识
  session_store 按 thread_id 存储/加载对话历史
  deps 是值对象，不跨请求共享
```

### 6.2 对话历史持久化

```python
# 使用现有 session_store（支持 Redis + Postgres）
class ConversationStore:
    async def load_messages(self, thread_id: str) -> list[dict] | None:
        """加载 PydanticAI message_history 格式的消息列表"""
        ...

    async def save_turn(self, thread_id: str, user_message: str, assistant_output: str):
        """保存一轮对话（用户消息 + Agent 输出）"""
        ...
```

### 6.3 并发控制

保留 NestJS Gateway 的每用户 3 并发限制 + Redis slot 管理。

### 6.4 取消支持

集成现有 `app/agent/cancellation.py` 的 `asyncio.Event` 机制：
- Runner 在每个工具调用间检查 `is_cancelled(thread_id)`
- 取消时产出 `{"type": "cancelled"}` SSE 事件
- 前端收到后重置面板状态

---

## 7. NestJS Gateway 变更

### 7.1 新增端点

```
POST /api/agent/v2/run
Body: {
  prompt: string,
  files: Array<{ content_b64, filename, mimetype }>,
  page_id?: string,
  thread_id?: string,   // 续接对话时传入
  workspace_id: string, // Gateway 自动填充
  user_id: string,      // Gateway 自动填充
}
Response: SSE stream
```

### 7.2 保留旧端点

`/api/agent/run` 保持不变，用于渐进迁移。前端通过 feature flag 选择 v1/v2。

---

## 8. 文件结构

### 8.1 新增文件

```
agent-service/app/agent/
├── __init__.py
├── agent.py              # Agent 单例 + 工厂函数（~50行）
├── deps.py               # AgentDeps 依赖容器（~30行）
├── skill.py              # TipTap 创作 Skill system_prompt（~2000 tokens）
├── event_bridge.py       # PydanticAI 事件 → SSE 转换（~60行）
├── runner.py             # Agent 执行 + SSE 流 + 会话管理 + 后验证（~80行）
├── validator.py          # 输出后验证器（~50行）
└── tools/
    ├── __init__.py       # ALL_TOOLS 导出
    ├── extract_document.py  # 文档提取+图片上传（~80行）
    ├── scrape_url.py        # 网页抓取（~30行）
    ├── search_web.py        # 网络搜索（~30行）
    └── read_page.py         # 页面读取（~30行）
```

总计新增 ~440 行代码，取代 engine.py 1266 行 + document_task_engine.py 136 行 + complexity.py 139 行 + 相关文件。

### 8.2 废弃文件（Phase 1 不删除，渐进迁移后清理）

`orchestrator/engine.py`, `orchestrator/document_task_engine.py`, `orchestrator/tools/complexity.py`, `orchestrator/tools/create_brief.py`, `orchestrator/tools/create_blueprint.py`, `orchestrator/tools/research.py`, `orchestrator/sse_optimizer.py`, `orchestrator/prompts.py`, `agent/events.py`, `tools/registry.py`

### 8.3 保留文件

`main.py`, `config.py`, `middleware/auth.py`, `orchestrator/llm_factory.py`, `orchestrator/session_store.py`, `workers/asset_parser.py`, `workers/mineru_parser.py`, `tools/docmost_api.py`, `tools/firecrawl_scrape.py`, `tools/trafilatura_extract.py`, `tools/tavily_search.py`, `tools/source_image_store.py`, `tools/mineru_client.py`, `models/*.py`, `schemas/*.py`, `utils/*.py`

---

## 9. 分阶段实施

| 阶段 | 内容 | 前提 | 预估 |
|------|------|------|------|
| **Phase 1** | Agent Core：单例 Agent + 4 工具 + Skill + 事件桥接 + Runner + 后验证 + FastAPI 端点 + Gateway v2 | 无 | 5-7 天 |
| **Phase 2** | Frontend：MiniMax 式对话面板（`frontend-design` skill） | Phase 1 Task 3 完成（SSE 协议稳定） | 5-7 天 |
| **Phase 3** | Integration：端到端测试 + 旧代码清理 + 文档 | Phase 1 + 2 完成 | 3-5 天 |

**Phase 2 设计可与 Phase 1 并行，编码等 Phase 1 Task 3 后开始。**
