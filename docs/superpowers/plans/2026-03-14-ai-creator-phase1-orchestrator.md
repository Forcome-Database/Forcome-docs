# 阶段 1：核心编排器实施计划

> **对于智能体执行者：** 要求：使用 superpowers:subagent-driven-development （如果子代理可用）或 superpowers:executing-plans 来实施此计划。步骤使用复选框 (`- [ ]`) 语法进行跟踪。

**目标：** 使用 ReAct 循环、复杂性分析、用户交互工具和 1 级任务执行构建 PydanticAI Orchestrator - 证明新架构端到端地工作。

**架构：** 具有工具调用功能的单个 PydanticAI 代理充当 Orchestrator。它根据任务复杂性动态决定下一步做什么。工具包括`analyze_complexity`、`ask_user`、`simple_edit`（针对级别1）和`finalize`。现有的`asyncio.Queue` SSE 机制适用于新的事件协议。旧的 LangGraph 代码保持不变——我们在它旁边构建了 v2。

**技术栈：** PydanticAI、FastAPI、asyncio、来自 `app/config.py` 的现有 LLM 抽象

**先决条件（从第 0 阶段开始）：**
- Pydantic 型号：`CreationBrief`、`AssetMap`、`CreationBlueprint`、`SectionDraft`、`ReviewReport`、`SSEEvent`、`CreationState`
- 中文字数统计实用程序
- 前端 TypeScript 类型
- 协调员和工人的空搭建骨架

---

## 文件结构概述

### 新文件（代理服务）

| 文件 | 用途 |
|------|---------|
| `agent-service/app/orchestrator/__init__.py` | 包初始化 |
| `agent-service/app/orchestrator/llm_factory.py` | PydanticAI模型适配器工厂 |
| `agent-service/app/orchestrator/engine.py` | 核心编排引擎（PydanticAI Agent） |
| `agent-service/app/orchestrator/prompts.py` | 系统提示需要协调器 |
| `agent-service/app/orchestrator/tools/__init__.py` | 工具包初始化 |
| `agent-service/app/orchestrator/tools/complexity.py` | `analyze_complexity` tool |
| `agent-service/app/orchestrator/tools/user_interaction.py` | `ask_user`工具（中断机制） |
| `agent-service/app/orchestrator/tools/simple_edit.py` | `simple_edit` 工具（1 级执行） |
| `agent-service/app/orchestrator/tools/finalize.py` | `finalize` 工具（合并+完成） |
| `agent-service/tests/orchestrator/__init__.py` | 测试包 |
| `agent-service/tests/orchestrator/test_llm_factory.py` | LLM工厂测试 |
| `agent-service/tests/orchestrator/test_complexity.py` | 复杂性分析测试 |
| `agent-service/tests/orchestrator/test_user_interaction.py` | 用户交互测试 |
| `agent-service/tests/orchestrator/test_simple_edit.py` | 简单的编辑测试 |
| `agent-service/tests/orchestrator/test_finalize.py` | 完成测试 |
| `agent-service/tests/orchestrator/test_engine.py` | Orchestrator 引擎测试 |
| `agent-service/tests/orchestrator/test_e2e_level1.py` | 端到端1级集成测试 |

### 修改文件

| 文件 | 变更 |
|------|--------|
| `agent-service/app/main.py` | 添加 `/v2/agent/run`、`/v2/agent/resume`、`/v2/agent/stop` 端点 |
| `apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts` | 添加v2代理路由 |
| `apps/client/src/ee/ai/services/ai-create-runner.utils.ts` | 添加 v2 事件标准化 |

---

## 分块 1：LLM 适配器

### 任务 1：创建 LLM adapter for PydanticAI

PydanticAI 需要一个模型适配器。该项目支持多个提供商（OpenAI、Gemini、Ollama、OpenAI 兼容）。创建一个读取现有 `app/config.py` 设置并返回正确的 PydanticAI 模型字符串或实例的工厂。

**文件：**
- 创建：`agent-service/app/orchestrator/__init__.py`
- 创建：`agent-service/app/orchestrator/llm_factory.py`
- 测试： `agent-service/tests/orchestrator/__init__.py`
- 测试： `agent-service/tests/orchestrator/test_llm_factory.py`

**上下文：** 现有的 `app/config.py` 具有以下已解析的属性：
- `settings.llm_provider` → `"openai"` | `"openai-compatible"` | `"gemini"` | `"ollama"`
- `settings.llm_model` → e.g. `"gpt-4"`, `"gemini-2.0-flash"`, `"llama3"`
- `settings.llm_api_key` → API 密钥字符串
- `settings.llm_api_url` → 基本 URL（与 openai 兼容和 ollama 相关）

PydanticAI模型格式：
- OpenAI：`"openai:gpt-4"`（使用`OPENAI_API_KEY` env或显式）
- 双子座：`"google-gla:gemini-2.0-flash"`（使用 `GOOGLE_API_KEY` env 或显式）
- Ollama：`"ollama:llama3"`（使用 `OLLAMA_BASE_URL` env 或显式）
- OpenAI 兼容：`OpenAIModel(model_name, base_url=..., api_key=...)` 来自 `pydantic_ai.models.openai`

- [ ] **第 1 步：为 LLM 工厂编写失败测试**

```python
# agent-service/tests/orchestrator/test_llm_factory.py

from unittest.mock import patch

import pytest


def test_openai_provider_returns_correct_model_string():
    """OpenAI provider should return 'openai:model-name' format."""
    with patch("app.config.settings") as mock_settings:
        mock_settings.llm_provider = "openai"
        mock_settings.llm_model = "gpt-4o"
        mock_settings.llm_api_key = "sk-test-key"
        mock_settings.llm_api_url = "https://api.openai.com/v1"

        from app.orchestrator.llm_factory import create_pydantic_ai_model

        model = create_pydantic_ai_model()
        # Should be a valid PydanticAI model (string or object)
        assert model is not None


def test_gemini_provider_returns_correct_model():
    """Gemini provider should return a google-gla model."""
    with patch("app.config.settings") as mock_settings:
        mock_settings.llm_provider = "gemini"
        mock_settings.llm_model = "gemini-2.0-flash"
        mock_settings.llm_api_key = "test-gemini-key"
        mock_settings.gemini_api_key = "test-gemini-key"
        mock_settings.llm_api_url = ""

        from app.orchestrator.llm_factory import create_pydantic_ai_model

        model = create_pydantic_ai_model()
        assert model is not None


def test_openai_compatible_provider_returns_custom_base_url():
    """OpenAI-compatible provider should use custom base URL."""
    with patch("app.config.settings") as mock_settings:
        mock_settings.llm_provider = "openai-compatible"
        mock_settings.llm_model = "deepseek-chat"
        mock_settings.llm_api_key = "sk-custom-key"
        mock_settings.llm_api_url = "https://api.deepseek.com/v1"

        from app.orchestrator.llm_factory import create_pydantic_ai_model

        model = create_pydantic_ai_model()
        assert model is not None


def test_ollama_provider_returns_ollama_model():
    """Ollama provider should return an ollama-prefixed model."""
    with patch("app.config.settings") as mock_settings:
        mock_settings.llm_provider = "ollama"
        mock_settings.llm_model = "llama3"
        mock_settings.llm_api_key = ""
        mock_settings.llm_api_url = "http://localhost:11434"

        from app.orchestrator.llm_factory import create_pydantic_ai_model

        model = create_pydantic_ai_model()
        assert model is not None


def test_unknown_provider_falls_back_to_openai():
    """Unknown provider should fall back to OpenAI-style model."""
    with patch("app.config.settings") as mock_settings:
        mock_settings.llm_provider = "unknown-provider"
        mock_settings.llm_model = "some-model"
        mock_settings.llm_api_key = "sk-test"
        mock_settings.llm_api_url = "https://api.openai.com/v1"

        from app.orchestrator.llm_factory import create_pydantic_ai_model

        model = create_pydantic_ai_model()
        assert model is not None
```

- [ ] **第 2 步：运行测试以验证它们是否失败**

```bash
cd agent-service && python -m pytest tests/orchestrator/test_llm_factory.py -q
```

预期：失败 — `ModuleNotFoundError: No module named 'app.orchestrator'`

- [ ] **第 3 步：实施LLM工厂**

```python
# agent-service/app/orchestrator/__init__.py
# (empty package init)

# agent-service/app/orchestrator/llm_factory.py
"""PydanticAI model adapter factory.

Maps the existing Docmost LLM config (app/config.py) to PydanticAI model
instances. Supports: OpenAI, Gemini, Ollama, and OpenAI-compatible providers.

Existing config properties used:
  - settings.llm_provider: "openai" | "openai-compatible" | "gemini" | "ollama"
  - settings.llm_model: model name string
  - settings.llm_api_key: API key
  - settings.llm_api_url: base URL (for openai-compatible / ollama)
"""
from __future__ import annotations

from typing import Union

from pydantic_ai.models import Model

from app.config import settings


def create_pydantic_ai_model(
    *,
    provider: str | None = None,
    model_name: str | None = None,
    api_key: str | None = None,
    base_url: str | None = None,
) -> Union[str, Model]:
    """Create and return a PydanticAI-compatible model.

    Parameters override settings when provided (useful for testing).

    Returns either a model string like "openai:gpt-4" or a Model instance
    for providers that need explicit configuration (openai-compatible).
    """
    _provider = provider or settings.llm_provider
    _model = model_name or settings.llm_model
    _api_key = api_key or settings.llm_api_key
    _base_url = base_url or settings.llm_api_url

    if _provider == "gemini":
        from pydantic_ai.models.google import GoogleModel

        _gemini_key = api_key or settings.gemini_api_key or _api_key
        return GoogleModel(_model, api_key=_gemini_key)

    if _provider == "ollama":
        from pydantic_ai.models.openai import OpenAIModel

        ollama_base = _base_url or "http://localhost:11434/v1"
        if not ollama_base.endswith("/v1"):
            ollama_base = ollama_base.rstrip("/") + "/v1"
        return OpenAIModel(
            _model,
            base_url=ollama_base,
            api_key=_api_key or "ollama",  # Ollama doesn't need a real key
        )

    if _provider == "openai-compatible":
        from pydantic_ai.models.openai import OpenAIModel

        return OpenAIModel(
            _model,
            base_url=_base_url,
            api_key=_api_key,
        )

    # Default: standard OpenAI (also handles unknown providers)
    if _provider == "openai":
        from pydantic_ai.models.openai import OpenAIModel

        return OpenAIModel(_model, api_key=_api_key)

    # Unknown provider — fall back to OpenAI-style
    from pydantic_ai.models.openai import OpenAIModel

    return OpenAIModel(
        _model,
        base_url=_base_url if _base_url else None,
        api_key=_api_key,
    )
```

- [ ] **第 4 步：运行测试以验证其通过**

```bash
cd agent-service && python -m pytest tests/orchestrator/test_llm_factory.py -q
```

预期：通过 — 所有 5 项测试均通过。

- [ ] **第 5 步：通过冒烟测试进行验证（需要真实的 API 密钥）**

```bash
cd agent-service && python -c "
from app.orchestrator.llm_factory import create_pydantic_ai_model
model = create_pydantic_ai_model()
print(f'Model created: {model}')
print(f'Type: {type(model).__name__}')
"
```

预期：打印模型信息，没有错误。

- [ ] **第 6 步：提交**

```bash
git add agent-service/app/orchestrator/__init__.py agent-service/app/orchestrator/llm_factory.py agent-service/tests/orchestrator/__init__.py agent-service/tests/orchestrator/test_llm_factory.py
git commit -m "feat(orchestrator): add PydanticAI LLM adapter factory"
```

---

## 分块 2：复杂度分析

### 任务 2：实现 analyze_complexity tool

该工具分析用户输入+上下文以确定任务复杂性级别1/2/3，从而驱动编排器的执行策略。

**文件：**
- 创建：`agent-service/app/orchestrator/tools/__init__.py`
- 创建：`agent-service/app/orchestrator/tools/complexity.py`
- 测试： `agent-service/tests/orchestrator/test_complexity.py`

**复杂程度：**

| Level | 说明 | Keywords (EN) | Keywords (ZH) | Behavior |
|-------|-------------|---------------|---------------|----------|
| 1 | 简单编辑 | 翻译、修正拼写、缩短、延长、简化、改变语气 | 翻译, 改错, 精简, 加长, 简化, 改语气 | 单一 LLM 通话，无需规划 |
| 2 | 结构化编辑 | 格式、布局、继续、扩展、重组 | 排版, 续写, 扩展, 重构 | 简短+单遍写入 |
| 3 | 全创作 | 创建、编写、重写、撰写、设计 | 创作, 写, 仿写, 合并, 设计 | 完整的管道与蓝图 |

**覆盖规则：**
- 文件上传 → 至少 2 级
- 多个文件 → 3 级
- 暗示创造的模板 → 第 3 级
- `intent_route == "selection_edit"` → Level 1

- [ ] **第 1 步：编写失败测试以进行复杂性分析**

```python
# agent-service/tests/orchestrator/test_complexity.py

import pytest

from app.orchestrator.tools.complexity import analyze_task_complexity


class TestLevel1Detection:
    def test_translate_chinese(self):
        result = analyze_task_complexity(
            user_message="翻译成英文：你好世界",
            files=[],
            intent_route="document_create",
            template_id=None,
            selected_text="你好世界",
        )
        assert result["level"] == 1
        assert "reasoning" in result

    def test_translate_english(self):
        result = analyze_task_complexity(
            user_message="Translate this to French",
            files=[],
            intent_route="document_create",
            template_id=None,
            selected_text="Hello world",
        )
        assert result["level"] == 1

    def test_fix_spelling(self):
        result = analyze_task_complexity(
            user_message="改错别字",
            files=[],
            intent_route="selection_edit",
            template_id=None,
            selected_text="这是一段有错别子的文字",
        )
        assert result["level"] == 1

    def test_make_shorter(self):
        result = analyze_task_complexity(
            user_message="精简这段话",
            files=[],
            intent_route="selection_edit",
            template_id=None,
            selected_text="一段很长的文字...",
        )
        assert result["level"] == 1

    def test_change_tone(self):
        result = analyze_task_complexity(
            user_message="改成正式语气",
            files=[],
            intent_route="selection_edit",
            template_id=None,
            selected_text="Hey what's up",
        )
        assert result["level"] == 1

    def test_selection_edit_intent_forces_level1(self):
        result = analyze_task_complexity(
            user_message="帮我处理一下这段",
            files=[],
            intent_route="selection_edit",
            template_id=None,
            selected_text="some text",
        )
        assert result["level"] == 1

    def test_simplify(self):
        result = analyze_task_complexity(
            user_message="Simplify this paragraph",
            files=[],
            intent_route="document_create",
            template_id=None,
            selected_text="A complex paragraph...",
        )
        assert result["level"] == 1


class TestLevel2Detection:
    def test_format_document(self):
        result = analyze_task_complexity(
            user_message="帮我排版这篇文章",
            files=[],
            intent_route="document_transform",
            template_id=None,
            selected_text=None,
        )
        assert result["level"] == 2

    def test_continue_writing(self):
        result = analyze_task_complexity(
            user_message="续写这篇文章",
            files=[],
            intent_route="document_create",
            template_id=None,
            selected_text=None,
        )
        assert result["level"] == 2

    def test_expand_content(self):
        result = analyze_task_complexity(
            user_message="扩展这一节的内容",
            files=[],
            intent_route="document_create",
            template_id=None,
            selected_text=None,
        )
        assert result["level"] == 2

    def test_single_file_upload_bumps_to_level2(self):
        result = analyze_task_complexity(
            user_message="翻译这个文件",
            files=[{"filename": "doc.pdf", "mimetype": "application/pdf"}],
            intent_route="document_create",
            template_id=None,
            selected_text=None,
        )
        assert result["level"] >= 2


class TestLevel3Detection:
    def test_create_from_scratch(self):
        result = analyze_task_complexity(
            user_message="写一篇关于人工智能的技术博客",
            files=[],
            intent_route="document_create",
            template_id=None,
            selected_text=None,
        )
        assert result["level"] == 3

    def test_rewrite_document(self):
        result = analyze_task_complexity(
            user_message="仿写这篇文章",
            files=[],
            intent_route="document_create",
            template_id=None,
            selected_text=None,
        )
        assert result["level"] == 3

    def test_multiple_files_forces_level3(self):
        result = analyze_task_complexity(
            user_message="合并这些文件",
            files=[
                {"filename": "a.pdf", "mimetype": "application/pdf"},
                {"filename": "b.pdf", "mimetype": "application/pdf"},
            ],
            intent_route="document_create",
            template_id=None,
            selected_text=None,
        )
        assert result["level"] == 3

    def test_generic_creation(self):
        result = analyze_task_complexity(
            user_message="创作一份项目计划书",
            files=[],
            intent_route="document_create",
            template_id=None,
            selected_text=None,
        )
        assert result["level"] == 3

    def test_template_with_creation_intent(self):
        """Templates that imply creation should force Level 3."""
        result = analyze_task_complexity(
            user_message="用这个模板写一篇文章",
            files=[],
            intent_route="document_create",
            template_id="blog-post-template",
            selected_text=None,
        )
        assert result["level"] == 3


class TestReasoningOutput:
    def test_reasoning_is_non_empty(self):
        result = analyze_task_complexity(
            user_message="翻译成英文",
            files=[],
            intent_route="selection_edit",
            template_id=None,
            selected_text="你好",
        )
        assert isinstance(result["reasoning"], str)
        assert len(result["reasoning"]) > 0

    def test_result_has_correct_keys(self):
        result = analyze_task_complexity(
            user_message="写一篇文章",
            files=[],
            intent_route="document_create",
            template_id=None,
            selected_text=None,
        )
        assert "level" in result
        assert "reasoning" in result
        assert result["level"] in (1, 2, 3)
```

- [ ] **第 2 步：运行测试以验证它们是否失败**

```bash
cd agent-service && python -m pytest tests/orchestrator/test_complexity.py -q
```

预期：失败 — `ModuleNotFoundError: No module named 'app.orchestrator.tools'`

- [ ] **第 3 步：实施复杂性分析器**

```python
# agent-service/app/orchestrator/tools/__init__.py
# (empty package init)

# agent-service/app/orchestrator/tools/complexity.py
"""Task complexity analysis for the orchestrator.

Determines whether a user request is Level 1 (simple edit), Level 2
(structured edit), or Level 3 (full creation). This is a deterministic,
keyword-based analysis — no LLM call needed.

The orchestrator calls this as its first tool to decide which execution
path to take.
"""
from __future__ import annotations

import re
from typing import Any, TypedDict


class ComplexityResult(TypedDict):
    level: int  # 1, 2, or 3
    reasoning: str


# --- Keyword sets ---

_LEVEL1_KEYWORDS_EN = {
    "translate", "fix spelling", "fix grammar", "fix typo", "fix typos",
    "shorten", "make shorter", "make longer", "lengthen",
    "simplify", "change tone", "make formal", "make casual",
    "proofread", "correct",
}

_LEVEL1_KEYWORDS_ZH = {
    "翻译", "改错", "纠错", "精简", "缩短", "加长", "简化",
    "改语气", "改口吻", "校对", "润色", "改正", "修正",
}

_LEVEL2_KEYWORDS_EN = {
    "format", "layout", "continue", "expand", "restructure",
    "reorganize", "extend", "elaborate",
}

_LEVEL2_KEYWORDS_ZH = {
    "排版", "续写", "扩展", "扩充", "重构", "重新组织", "延伸", "补充",
}

_LEVEL3_KEYWORDS_EN = {
    "create", "write", "rewrite", "compose", "design", "draft",
    "generate", "produce", "build", "develop", "author",
}

_LEVEL3_KEYWORDS_ZH = {
    "创作", "写", "仿写", "合并", "设计", "撰写", "起草",
    "生成", "编写", "制作",
}


def _message_matches_keywords(message: str, keywords: set[str]) -> bool:
    """Check if the message contains any of the given keywords (case-insensitive)."""
    lower = message.lower()
    for kw in keywords:
        if kw.lower() in lower:
            return True
    return False


def analyze_task_complexity(
    *,
    user_message: str,
    files: list[dict[str, Any]],
    intent_route: str,
    template_id: str | None,
    selected_text: str | None,
) -> ComplexityResult:
    """Analyze user input and context to determine complexity level.

    Rules (applied in priority order):
    1. intent_route == "selection_edit" → Level 1
    2. Level 1 keywords detected (with no files) → Level 1
    3. Multiple files → Level 3
    4. template_id present with creation intent → Level 3
    5. Level 3 keywords detected → Level 3
    6. Single file upload → at least Level 2
    7. Level 2 keywords detected → Level 2
    8. Default (no keywords matched) → Level 3 (assume creation)
    """
    reasons: list[str] = []

    # Rule 1: selection_edit intent always means Level 1
    if intent_route == "selection_edit":
        reasons.append(f"intent_route is 'selection_edit'")
        return ComplexityResult(level=1, reasoning="; ".join(reasons))

    # Rule 2: Level 1 keywords (only if no file uploads)
    if not files:
        if _message_matches_keywords(user_message, _LEVEL1_KEYWORDS_EN | _LEVEL1_KEYWORDS_ZH):
            # Check that no Level 3 keywords are also present
            has_l3 = _message_matches_keywords(
                user_message, _LEVEL3_KEYWORDS_EN | _LEVEL3_KEYWORDS_ZH
            )
            if not has_l3:
                reasons.append("Level 1 keyword detected in message")
                if selected_text:
                    reasons.append("selected text present")
                return ComplexityResult(level=1, reasoning="; ".join(reasons))

    # Rule 3: Multiple files → Level 3
    if len(files) >= 2:
        reasons.append(f"multiple files uploaded ({len(files)})")
        return ComplexityResult(level=3, reasoning="; ".join(reasons))

    # Rule 4: Template with creation intent → Level 3
    if template_id and intent_route == "document_create":
        reasons.append(f"template '{template_id}' with document_create intent")
        return ComplexityResult(level=3, reasoning="; ".join(reasons))

    # Rule 5: Level 3 keywords
    if _message_matches_keywords(user_message, _LEVEL3_KEYWORDS_EN | _LEVEL3_KEYWORDS_ZH):
        reasons.append("Level 3 keyword detected in message")
        return ComplexityResult(level=3, reasoning="; ".join(reasons))

    # Rule 6: Single file → at least Level 2
    if len(files) == 1:
        # Check if Level 2 or Level 3 keywords are present
        if _message_matches_keywords(user_message, _LEVEL3_KEYWORDS_EN | _LEVEL3_KEYWORDS_ZH):
            reasons.append("single file + Level 3 keyword")
            return ComplexityResult(level=3, reasoning="; ".join(reasons))
        reasons.append("single file uploaded")
        return ComplexityResult(level=2, reasoning="; ".join(reasons))

    # Rule 7: Level 2 keywords
    if _message_matches_keywords(user_message, _LEVEL2_KEYWORDS_EN | _LEVEL2_KEYWORDS_ZH):
        reasons.append("Level 2 keyword detected in message")
        return ComplexityResult(level=2, reasoning="; ".join(reasons))

    # Default: Level 3 (assume full creation for unrecognized requests)
    reasons.append("no specific keywords matched; defaulting to full creation")
    return ComplexityResult(level=3, reasoning="; ".join(reasons))
```

- [ ] **第 4 步：运行测试以验证其通过**

```bash
cd agent-service && python -m pytest tests/orchestrator/test_complexity.py -v
```

预期：通过 — 所有测试均呈绿色。

- [ ] **第 5 步：提交**

```bash
git add agent-service/app/orchestrator/tools/__init__.py agent-service/app/orchestrator/tools/complexity.py agent-service/tests/orchestrator/test_complexity.py
git commit -m "feat(orchestrator): add deterministic task complexity analyzer"
```

---

## 分块 3：用户交互（中断机制）

### 任务 3：实现 ask_user tool (interrupt mechanism)

这是最关键的工具。它会发出 SSE 事件并暂停协调器，直到用户响应。使用 `asyncio.Event` 发出暂停/恢复信号。

**文件：**
- 创建：`agent-service/app/orchestrator/tools/user_interaction.py`
- 测试： `agent-service/tests/orchestrator/test_user_interaction.py`

**设计：**

当需要用户输入时，`ask_user` 工具由 PydanticAI 代理调用。它：
1. 将问题/数据序列化为 SSE `await_input` 事件
2. 将其推送到现有的 `asyncio.Queue`（通过 `app.agent.events.emit`）
3. 设置`asyncio.Event`并等待相应的响应事件
4. `/v2/agent/resume` 端点设置响应并发出事件信号
5. 该工具将用户的响应返回给 PydanticAI 代理

每线程注册表将 `thread_id` 映射到 `(asyncio.Event, response_value)` 对。

- [ ] **第 1 步：为用户交互编写失败的测试**

```python
# agent-service/tests/orchestrator/test_user_interaction.py

import asyncio

import pytest

from app.orchestrator.tools.user_interaction import (
    InteractionRegistry,
    InteractionPhase,
)


@pytest.fixture
def registry():
    return InteractionRegistry()


class TestInteractionRegistry:
    @pytest.mark.asyncio
    async def test_register_creates_pending_interaction(self, registry):
        registry.register("thread-1")
        assert registry.is_waiting("thread-1") is False  # not yet waiting

    @pytest.mark.asyncio
    async def test_wait_and_resume_flow(self, registry):
        """Simulate the full pause/resume cycle."""
        registry.register("thread-1")

        async def resume_after_delay():
            await asyncio.sleep(0.05)
            registry.submit_response("thread-1", {"answers": "42"})

        asyncio.create_task(resume_after_delay())

        result = await asyncio.wait_for(
            registry.wait_for_response("thread-1"),
            timeout=2.0,
        )
        assert result == {"answers": "42"}

    @pytest.mark.asyncio
    async def test_resume_unknown_thread_returns_false(self, registry):
        ok = registry.submit_response("nonexistent", {"x": 1})
        assert ok is False

    @pytest.mark.asyncio
    async def test_cleanup_removes_thread(self, registry):
        registry.register("thread-1")
        registry.cleanup("thread-1")
        assert registry.submit_response("thread-1", {}) is False

    @pytest.mark.asyncio
    async def test_wait_timeout(self, registry):
        """If no response comes, wait_for_response should be cancellable."""
        registry.register("thread-1")

        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(
                registry.wait_for_response("thread-1"),
                timeout=0.1,
            )


class TestInteractionPhase:
    def test_valid_phases(self):
        assert InteractionPhase.BRIEF == "brief"
        assert InteractionPhase.BLUEPRINT == "blueprint"
        assert InteractionPhase.REVIEW == "review"
        assert InteractionPhase.CLARIFY == "clarify"
```

- [ ] **第 2 步：运行测试以验证它们是否失败**

```bash
cd agent-service && python -m pytest tests/orchestrator/test_user_interaction.py -q
```

预期：失败 — `ModuleNotFoundError`

- [ ] **第 3 步：实现用户交互系统**

```python
# agent-service/app/orchestrator/tools/user_interaction.py
"""User interaction tool for the orchestrator.

Provides the pause/resume mechanism that lets the PydanticAI agent
ask the user a question and wait for their response. This is the
bridge between the SSE event stream and the agent's tool-calling loop.

Architecture:
  1. Agent calls ask_user tool → emits SSE await_input event
  2. SSE stream delivers event to frontend
  3. User responds → frontend calls /v2/agent/resume
  4. Resume endpoint calls registry.submit_response()
  5. ask_user tool receives response and returns it to the agent

Thread safety: Each thread_id gets its own asyncio.Event + response slot.
"""
from __future__ import annotations

import asyncio
from enum import StrEnum
from typing import Any


class InteractionPhase(StrEnum):
    """Phases where the orchestrator can pause for user input."""
    BRIEF = "brief"
    BLUEPRINT = "blueprint"
    REVIEW = "review"
    CLARIFY = "clarify"


class _PendingInteraction:
    """Internal state for a single pending user interaction."""

    __slots__ = ("event", "response")

    def __init__(self):
        self.event = asyncio.Event()
        self.response: Any = None


class InteractionRegistry:
    """Registry of pending user interactions, keyed by thread_id.

    Lifecycle:
      1. register(thread_id) — called before waiting
      2. wait_for_response(thread_id) — blocks until response arrives
      3. submit_response(thread_id, data) — called by resume endpoint
      4. cleanup(thread_id) — called when thread completes

    This is NOT a singleton — the orchestrator engine creates one instance
    and shares it with the FastAPI endpoints via dependency injection.
    """

    def __init__(self):
        self._pending: dict[str, _PendingInteraction] = {}

    def register(self, thread_id: str) -> None:
        """Register a thread for potential user interaction."""
        self._pending[thread_id] = _PendingInteraction()

    def is_waiting(self, thread_id: str) -> bool:
        """Check if a thread is currently waiting for user response."""
        pending = self._pending.get(thread_id)
        if pending is None:
            return False
        return not pending.event.is_set()

    async def wait_for_response(self, thread_id: str) -> Any:
        """Block until the user submits a response for this thread.

        Raises KeyError if thread_id is not registered.
        Can be cancelled via asyncio.wait_for(timeout=...).
        """
        pending = self._pending.get(thread_id)
        if pending is None:
            raise KeyError(f"No pending interaction for thread {thread_id}")

        await pending.event.wait()
        response = pending.response

        # Reset for next interaction in the same thread
        self._pending[thread_id] = _PendingInteraction()

        return response

    def submit_response(self, thread_id: str, data: Any) -> bool:
        """Submit a user response, unblocking the waiting tool.

        Returns True if the thread was waiting, False if not found.
        """
        pending = self._pending.get(thread_id)
        if pending is None:
            return False

        pending.response = data
        pending.event.set()
        return True

    def cleanup(self, thread_id: str) -> None:
        """Remove a thread from the registry."""
        self._pending.pop(thread_id, None)


# Module-level singleton for use by FastAPI endpoints
interaction_registry = InteractionRegistry()
```

- [ ] **第 4 步：运行测试以验证其通过**

```bash
cd agent-service && python -m pytest tests/orchestrator/test_user_interaction.py -v
```

预期：通过 — 所有测试均呈绿色。

- [ ] **第 5 步：提交**

```bash
git add agent-service/app/orchestrator/tools/user_interaction.py agent-service/tests/orchestrator/test_user_interaction.py
git commit -m "feat(orchestrator): add user interaction pause/resume mechanism"
```

---

## 分块 4：简单编辑（Level 1）

### 任务 4：实现 simple_edit tool (Level 1 execution)

对于 1 级任务：带有用户提示 + 选定文本 + 页面上下文的单个 LLM 调用。通过 SSE `content_delta` 事件传输内容。没有计划，没有蓝图，没有审查。

**文件：**
- 创建：`agent-service/app/orchestrator/tools/simple_edit.py`
- 测试： `agent-service/tests/orchestrator/test_simple_edit.py`

**设计：**
- Takes: `user_message`, `selected_text`, `page_context`, `system_prompt`
- 使用 PydanticAI 代理和流媒体进行实际的 LLM 调用
- 发出 `step_start` → 流 `content` 事件 → 发出 `step_done`
- 返回完整生成的文本

- [ ] **第 1 步：为 simple_edit 编写失败测试**

```python
# agent-service/tests/orchestrator/test_simple_edit.py

import asyncio
from unittest.mock import AsyncMock, patch, MagicMock

import pytest

from app.orchestrator.tools.simple_edit import (
    build_simple_edit_prompt,
    SimpleEditRequest,
)


class TestBuildSimpleEditPrompt:
    def test_translate_prompt_with_selected_text(self):
        prompt = build_simple_edit_prompt(
            user_message="翻译成英文",
            selected_text="你好世界",
            page_content=None,
            system_prompt=None,
        )
        assert "翻译成英文" in prompt
        assert "你好世界" in prompt

    def test_fix_spelling_prompt(self):
        prompt = build_simple_edit_prompt(
            user_message="fix spelling errors",
            selected_text="Ths is a tset",
            page_content=None,
            system_prompt=None,
        )
        assert "fix spelling" in prompt
        assert "Ths is a tset" in prompt

    def test_includes_system_prompt_when_provided(self):
        prompt = build_simple_edit_prompt(
            user_message="shorten this",
            selected_text="a long paragraph",
            page_content=None,
            system_prompt="You are a professional editor.",
        )
        assert "professional editor" in prompt

    def test_includes_page_context_when_no_selection(self):
        prompt = build_simple_edit_prompt(
            user_message="改成正式语气",
            selected_text=None,
            page_content="# My Doc\n\nSome informal content here bro",
            system_prompt=None,
        )
        assert "informal content" in prompt


class TestSimpleEditRequest:
    def test_request_model_validates(self):
        req = SimpleEditRequest(
            user_message="translate to english",
            selected_text="你好",
            page_content=None,
            system_prompt=None,
            thread_id="test-thread",
        )
        assert req.user_message == "translate to english"
        assert req.selected_text == "你好"
```

- [ ] **第 2 步：运行测试以验证它们是否失败**

```bash
cd agent-service && python -m pytest tests/orchestrator/test_simple_edit.py -q
```

预期：失败 — `ModuleNotFoundError`

- [ ] **第 3 步：实施 simple_edit**

```python
# agent-service/app/orchestrator/tools/simple_edit.py
"""Simple edit tool for Level 1 tasks.

Handles translation, spell-check, tone changes, shortening, lengthening,
and other single-pass edits. Uses a single LLM call with streaming.

This tool does NOT go through the full orchestration pipeline.
It is the fast path for simple, well-understood operations.
"""
from __future__ import annotations

from pydantic import BaseModel

from app.agent.events import emit
from app.orchestrator.llm_factory import create_pydantic_ai_model


class SimpleEditRequest(BaseModel):
    """Request model for simple edit operations."""
    user_message: str
    selected_text: str | None = None
    page_content: str | None = None
    system_prompt: str | None = None
    thread_id: str = ""


_SIMPLE_EDIT_SYSTEM = """You are a precise text editor. You receive an editing instruction and source text.
Apply the requested edit and return ONLY the edited result. Do not add explanations, commentary, or markdown formatting unless the instruction specifically asks for it.
Preserve the original structure, formatting, and style unless the instruction explicitly asks you to change them."""


def build_simple_edit_prompt(
    *,
    user_message: str,
    selected_text: str | None,
    page_content: str | None,
    system_prompt: str | None,
) -> str:
    """Build the prompt for a simple edit LLM call.

    Combines the system prompt, user instruction, and source text
    into a single prompt string.
    """
    parts: list[str] = []

    if system_prompt:
        parts.append(f"[System context]\n{system_prompt}\n")

    parts.append(f"[Editing instruction]\n{user_message}\n")

    if selected_text:
        parts.append(f"[Source text to edit]\n{selected_text}")
    elif page_content:
        parts.append(f"[Page content]\n{page_content}")

    return "\n".join(parts)


async def execute_simple_edit(
    request: SimpleEditRequest,
) -> str:
    """Execute a simple edit and stream results via SSE.

    Steps:
    1. Emit step_start event
    2. Build prompt from request
    3. Call LLM with streaming
    4. Emit content chunks as they arrive
    5. Emit step_done event
    6. Return complete text

    Args:
        request: The simple edit request with user message and context.

    Returns:
        The complete edited text.
    """
    from pydantic_ai import Agent

    thread_id = request.thread_id

    # Emit step_start
    await emit(thread_id, {
        "type": "step_start",
        "step": "simple_edit",
        "description": request.user_message[:100],
    })

    # Build prompt
    prompt = build_simple_edit_prompt(
        user_message=request.user_message,
        selected_text=request.selected_text,
        page_content=request.page_content,
        system_prompt=request.system_prompt,
    )

    # Create a one-shot PydanticAI agent for the edit
    model = create_pydantic_ai_model()
    agent = Agent(
        model,
        system_prompt=_SIMPLE_EDIT_SYSTEM,
    )

    # Run with streaming
    full_text = ""
    async with agent.run_stream(prompt) as result:
        async for chunk in result.stream_text(delta=True):
            full_text += chunk
            await emit(thread_id, {
                "type": "content",
                "chunk": chunk,
            })

    # Emit step_done
    await emit(thread_id, {
        "type": "step_done",
        "step": "simple_edit",
        "result_summary": f"Completed edit ({len(full_text)} chars)",
    })

    return full_text
```

- [ ] **第 4 步：运行测试以验证其通过**

```bash
cd agent-service && python -m pytest tests/orchestrator/test_simple_edit.py -v
```

预期：通过 - 提示构建并请求模型测试通过。

- [ ] **第 5 步：提交**

```bash
git add agent-service/app/orchestrator/tools/simple_edit.py agent-service/tests/orchestrator/test_simple_edit.py
git commit -m "feat(orchestrator): add simple_edit tool for Level 1 tasks"
```

---

## 分块 5：finalize 工具

### 任务 5：实现 finalize tool

将所有部分草稿合并到 `final_content`，计算最终字数，并发出 `done` 事件。

**文件：**
- 创建：`agent-service/app/orchestrator/tools/finalize.py`
- 测试： `agent-service/tests/orchestrator/test_finalize.py`

- [ ] **第 1 步：为 Finalize 编写失败测试**

```python
# agent-service/tests/orchestrator/test_finalize.py

import pytest

from app.orchestrator.tools.finalize import merge_sections, compute_word_count


class TestMergeSections:
    def test_single_section(self):
        sections = [{"title": "Intro", "content": "Hello world."}]
        result = merge_sections(sections)
        assert "Hello world." in result

    def test_multiple_sections_joined(self):
        sections = [
            {"title": "Section 1", "content": "First paragraph."},
            {"title": "Section 2", "content": "Second paragraph."},
        ]
        result = merge_sections(sections)
        assert "First paragraph." in result
        assert "Second paragraph." in result
        # Sections should be separated
        assert result.index("First") < result.index("Second")

    def test_empty_sections_list(self):
        result = merge_sections([])
        assert result == ""

    def test_plain_text_merge(self):
        """When content is plain text (Level 1), just return it."""
        result = merge_sections([], plain_text="Direct LLM output here.")
        assert result == "Direct LLM output here."

    def test_sections_with_headings(self):
        sections = [
            {"title": "Introduction", "content": "Intro text."},
            {"title": "Details", "content": "Detail text."},
        ]
        result = merge_sections(sections, include_headings=True)
        assert "# Introduction" in result or "Introduction" in result
        assert "Intro text." in result


class TestComputeWordCount:
    def test_english_word_count(self):
        count = compute_word_count("Hello world foo bar baz")
        assert count == 5

    def test_chinese_word_count(self):
        count = compute_word_count("你好世界")
        assert count >= 2  # Chinese chars counted individually or by segmentation

    def test_mixed_content(self):
        count = compute_word_count("Hello 你好 World 世界")
        assert count >= 4

    def test_empty_string(self):
        count = compute_word_count("")
        assert count == 0
```

- [ ] **第 2 步：运行测试以验证它们是否失败**

```bash
cd agent-service && python -m pytest tests/orchestrator/test_finalize.py -q
```

预期：失败 — `ModuleNotFoundError`

- [ ] **第 3 步：实施最终确定工具**

```python
# agent-service/app/orchestrator/tools/finalize.py
"""Finalize tool for the orchestrator.

Merges section drafts into final content, computes word count,
and emits the done event via SSE.
"""
from __future__ import annotations

import re
from typing import Any

from app.agent.events import emit


def compute_word_count(text: str) -> int:
    """Count words in mixed Chinese/English text.

    Chinese characters are counted individually (each char ≈ 1 word).
    English/Latin words are counted by whitespace separation.
    """
    if not text:
        return 0

    # Count Chinese characters
    chinese_chars = len(re.findall(r"[\u4e00-\u9fff\u3400-\u4dbf]", text))

    # Remove Chinese characters, then count remaining words
    text_without_chinese = re.sub(r"[\u4e00-\u9fff\u3400-\u4dbf]", " ", text)
    english_words = len(text_without_chinese.split())

    return chinese_chars + english_words


def merge_sections(
    sections: list[dict[str, Any]],
    *,
    plain_text: str | None = None,
    include_headings: bool = False,
) -> str:
    """Merge section drafts into a single document.

    Args:
        sections: List of {"title": str, "content": str} dicts.
        plain_text: If provided, return this directly (Level 1 path).
        include_headings: If True, prepend "# title" before each section.

    Returns:
        Merged content string.
    """
    if plain_text is not None:
        return plain_text

    if not sections:
        return ""

    parts: list[str] = []
    for section in sections:
        title = section.get("title", "")
        content = section.get("content", "")

        if include_headings and title:
            parts.append(f"# {title}\n\n{content}")
        else:
            parts.append(content)

    return "\n\n".join(parts)


async def finalize_and_emit(
    *,
    thread_id: str,
    sections: list[dict[str, Any]] | None = None,
    plain_text: str | None = None,
    insert_mode: str = "create",
) -> str:
    """Merge content and emit the done event.

    Args:
        thread_id: SSE thread identifier.
        sections: Section drafts to merge (Level 2/3).
        plain_text: Direct text result (Level 1).
        insert_mode: How the frontend should insert the content.

    Returns:
        The final merged content.
    """
    final_content = merge_sections(
        sections or [],
        plain_text=plain_text,
    )

    word_count = compute_word_count(final_content)

    await emit(thread_id, {
        "type": "done",
        "final_content": final_content,
        "insert_mode": insert_mode,
    })

    return final_content
```

- [ ] **第 4 步：运行测试以验证其通过**

```bash
cd agent-service && python -m pytest tests/orchestrator/test_finalize.py -v
```

预期：通过 — 所有测试均呈绿色。

- [ ] **第 5 步：提交**

```bash
git add agent-service/app/orchestrator/tools/finalize.py agent-service/tests/orchestrator/test_finalize.py
git commit -m "feat(orchestrator): add finalize tool for content merging"
```

---

## 分块 6：编排器引擎

### 任务 6：构建 the 编排器引擎

核心 PydanticAI 代理将一切联系在一起。

**文件：**
- 创建：`agent-service/app/orchestrator/prompts.py`
- 创建：`agent-service/app/orchestrator/engine.py`
- 测试： `agent-service/tests/orchestrator/test_engine.py`

**设计：**

该引擎创建一个 PydanticAI 代理：
- 来自`prompts.py`的系统提示
- Tools: `analyze_complexity`, `ask_user`, `simple_edit`, `finalize`
- `CreationState` 的依赖注入（运行时上下文）
- 通过 SSE 事件进行流式输出

`run()` 方法协调整个生命周期：
1. 根据请求创建状态
2. 运行 PydanticAI 代理 — 代理决定调用哪些工具
3. 对于级别 1：座席呼叫 `analyze_complexity` → `simple_edit` → `finalize`
4. 对于 2/3 级：代理调用 `analyze_complexity` → `ask_user`（可选）→ 委托给工作人员（阶段 2+）
5. 处理取消和错误

- [ ] **第 1 步：编写 Orchestrator 系统提示符**

```python
# agent-service/app/orchestrator/prompts.py
"""System prompts for the PydanticAI orchestrator.

The orchestrator prompt instructs the agent on HOW to use its tools,
not on how to write content (that's the workers' job).
"""

ORCHESTRATOR_SYSTEM_PROMPT = """You are the orchestrator for a document creation system. Your job is to analyze the user's request, determine the right execution strategy, and coordinate the work.

## Your Tools

1. **analyze_complexity** — Call this FIRST on every request. It determines the task level:
   - Level 1: Simple edit (translate, fix spelling, shorten, change tone). Use simple_edit directly.
   - Level 2: Structured edit (format, continue, expand). Needs brief → single-pass write.
   - Level 3: Full creation (write, rewrite, compose). Needs brief → blueprint → sectioned write → review.

2. **simple_edit** — For Level 1 tasks only. Single LLM call that applies the edit and streams the result.

3. **ask_user** — Pause and ask the user a question. Use ONLY when you have a specific, concrete question that cannot be answered from the available context. Do NOT ask unnecessary questions.

4. **finalize** — Call this LAST to emit the done event. Pass either plain_text (Level 1) or sections (Level 2/3).

## Execution Rules

- ALWAYS call analyze_complexity first.
- For Level 1: analyze_complexity → simple_edit → finalize. No questions, no planning.
- For Level 2: analyze_complexity → [ask_user if truly needed] → (delegate to workers — not yet available, use simple_edit as fallback). → finalize.
- For Level 3: analyze_complexity → [ask_user if truly needed] → (delegate to workers — not yet available, use simple_edit as fallback). → finalize.
- NEVER skip analyze_complexity.
- NEVER ask the user questions for Level 1 tasks.
- If workers are not yet available (Phase 1), fall back to simple_edit for all levels.

## Language

- Respond in the same language as the user's message.
- If the user writes in Chinese, your tool arguments and reasoning should be in Chinese.
"""
```

- [ ] **第 2 步：为引擎编写失败测试**

```python
# agent-service/tests/orchestrator/test_engine.py

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.orchestrator.engine import OrchestratorEngine, OrchestratorRequest


class TestOrchestratorRequest:
    def test_creates_from_minimal_input(self):
        req = OrchestratorRequest(
            user_message="翻译成英文：你好",
            thread_id="test-thread-1",
            workspace_id="ws-1",
        )
        assert req.user_message == "翻译成英文：你好"
        assert req.thread_id == "test-thread-1"

    def test_creates_with_full_context(self):
        req = OrchestratorRequest(
            user_message="Translate to English",
            thread_id="test-thread-2",
            workspace_id="ws-1",
            selected_text="你好世界",
            page_content="# Test Page\n\n你好世界",
            page_id="page-1",
            page_title="Test Page",
            intent_route="selection_edit",
            files=[],
            template_id=None,
            system_prompt=None,
            template_prompt=None,
            insert_mode="replace",
        )
        assert req.intent_route == "selection_edit"
        assert req.insert_mode == "replace"


class TestOrchestratorEngine:
    def test_engine_initializes(self):
        engine = OrchestratorEngine()
        assert engine is not None

    @pytest.mark.asyncio
    async def test_engine_rejects_empty_message(self):
        engine = OrchestratorEngine()
        req = OrchestratorRequest(
            user_message="",
            thread_id="test-thread",
            workspace_id="ws-1",
        )
        with pytest.raises(ValueError, match="empty"):
            await engine.run(req)
```

- [ ] **第 3 步：运行测试以验证它们是否失败**

```bash
cd agent-service && python -m pytest tests/orchestrator/test_engine.py -q
```

预期：失败 — `ModuleNotFoundError`

- [ ] **第 4 步：实施协调器引擎**

```python
# agent-service/app/orchestrator/engine.py
"""Core orchestrator engine.

The orchestrator is a PydanticAI Agent that coordinates task execution.
It analyzes complexity, decides execution strategy, and delegates to
the appropriate tools.

In Phase 1, only Level 1 (simple_edit) is fully implemented.
Level 2/3 fall back to simple_edit until workers are built in Phase 2+.
"""
from __future__ import annotations

import asyncio
from typing import Any

from pydantic import BaseModel, Field

from app.agent.events import create_queue, emit, emit_done, remove_queue
from app.agent.cancellation import (
    AgentCancelledError,
    register_task,
    unregister_task,
)
from app.orchestrator.llm_factory import create_pydantic_ai_model
from app.orchestrator.prompts import ORCHESTRATOR_SYSTEM_PROMPT
from app.orchestrator.tools.complexity import analyze_task_complexity
from app.orchestrator.tools.simple_edit import execute_simple_edit, SimpleEditRequest
from app.orchestrator.tools.finalize import finalize_and_emit
from app.orchestrator.tools.user_interaction import interaction_registry


class OrchestratorRequest(BaseModel):
    """Input request for the orchestrator."""
    user_message: str
    thread_id: str
    workspace_id: str = ""

    # Page context
    page_id: str | None = None
    page_title: str | None = None
    page_content: str | None = None
    selected_text: str | None = None
    selection_range: dict | None = None

    # Configuration
    intent_route: str = "document_create"
    scope: str = "blank_page"
    source_policy: str = "create_new"
    length_policy: str = "preserve"
    insert_mode: str = "create"

    # Files and templates
    files: list[dict[str, Any]] = Field(default_factory=list)
    template_id: str | None = None
    system_prompt: str | None = None
    template_prompt: str | None = None

    # Conversation context
    conversation_history: list[dict] = Field(default_factory=list)
    config: dict = Field(default_factory=dict)


class OrchestratorEngine:
    """The v2 orchestrator engine.

    In Phase 1, this engine:
    1. Analyzes task complexity (deterministic, no LLM)
    2. For Level 1: runs simple_edit → finalize
    3. For Level 2/3: falls back to simple_edit (workers not yet built)
    4. Emits SSE events throughout

    In Phase 2+, Level 2/3 will delegate to specialized workers.
    """

    async def run(self, request: OrchestratorRequest) -> str:
        """Execute the orchestrator pipeline.

        Args:
            request: The orchestrator request.

        Returns:
            The final content string.

        Raises:
            ValueError: If user_message is empty.
            AgentCancelledError: If the task is cancelled.
        """
        if not request.user_message.strip():
            raise ValueError("User message cannot be empty")

        # Step 1: Analyze complexity
        complexity = analyze_task_complexity(
            user_message=request.user_message,
            files=request.files,
            intent_route=request.intent_route,
            template_id=request.template_id,
            selected_text=request.selected_text,
        )

        level = complexity["level"]

        # Emit complexity analysis result
        await emit(request.thread_id, {
            "type": "step_start",
            "step": "analyze_complexity",
            "description": f"Task complexity: Level {level} — {complexity['reasoning']}",
        })

        await emit(request.thread_id, {
            "type": "step_done",
            "step": "analyze_complexity",
            "result_summary": f"Level {level}",
        })

        # Step 2: Execute based on level
        if level == 1:
            return await self._execute_level1(request)
        elif level == 2:
            # Phase 1 fallback: treat as Level 1
            return await self._execute_level1(request)
        else:
            # Phase 1 fallback: treat as Level 1
            return await self._execute_level1(request)

    async def _execute_level1(self, request: OrchestratorRequest) -> str:
        """Execute a Level 1 simple edit task."""
        edit_request = SimpleEditRequest(
            user_message=request.user_message,
            selected_text=request.selected_text,
            page_content=request.page_content,
            system_prompt=request.system_prompt,
            thread_id=request.thread_id,
        )

        result_text = await execute_simple_edit(edit_request)

        # Finalize
        final_content = await finalize_and_emit(
            thread_id=request.thread_id,
            plain_text=result_text,
            insert_mode=request.insert_mode,
        )

        return final_content
```

- [ ] **第 5 步：运行测试以验证其通过**

```bash
cd agent-service && python -m pytest tests/orchestrator/test_engine.py -v
```

预期：PASS — 请求模型和引擎初始化测试通过。

- [ ] **第 6 步：提交**

```bash
git add agent-service/app/orchestrator/prompts.py agent-service/app/orchestrator/engine.py agent-service/tests/orchestrator/test_engine.py
git commit -m "feat(orchestrator): add core orchestrator engine with Level 1 execution"
```

---

## 分块 7：FastAPI 端点

### 任务 7：创建 new FastAPI v2 endpoints

添加与旧 LangGraph 端点共存的 `/v2/agent/run`、`/v2/agent/resume` 和 `/v2/agent/stop`。

**文件：**
- 修改：`agent-service/app/main.py`

**设计：**
- 新端点使用 `OrchestratorEngine` 而不是 LangGraph
- 相同的SSE事件流格式（重用`asyncio.Queue`机制）
- 相同的身份验证中间件（`verify_internal_secret`）
- 旧端点保持不变以实现向后兼容性

- [ ] **第 1 步：为 v2 端点编写失败测试**

```python
# agent-service/tests/orchestrator/test_endpoints.py

import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.config import settings


@pytest.fixture
def auth_headers():
    return {"X-Internal-Secret": settings.agent_internal_secret}


@pytest.mark.asyncio
async def test_v2_run_endpoint_exists():
    """The /v2/agent/run endpoint should exist and accept POST."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/v2/agent/run",
            json={
                "user_message": "test",
                "thread_id": "test-thread",
            },
            headers={"X-Internal-Secret": settings.agent_internal_secret},
        )
        # Should not be 404 (endpoint exists)
        assert response.status_code != 404


@pytest.mark.asyncio
async def test_v2_stop_endpoint_exists():
    """The /v2/agent/stop endpoint should exist and accept POST."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/v2/agent/stop",
            json={"task_id": "nonexistent"},
            headers={"X-Internal-Secret": settings.agent_internal_secret},
        )
        assert response.status_code != 404


@pytest.mark.asyncio
async def test_v2_resume_endpoint_exists():
    """The /v2/agent/resume endpoint should exist and accept POST."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/v2/agent/resume",
            json={
                "thread_id": "test-thread",
                "resume_value": {"answers": "test"},
            },
            headers={"X-Internal-Secret": settings.agent_internal_secret},
        )
        assert response.status_code != 404


@pytest.mark.asyncio
async def test_old_endpoints_still_work():
    """Old /agent/run endpoint should still exist."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/agent/run",
            json={
                "user_message": "test",
            },
            headers={"X-Internal-Secret": settings.agent_internal_secret},
        )
        assert response.status_code != 404
```

- [ ] **第 2 步：运行测试以验证它们是否失败**

```bash
cd agent-service && python -m pytest tests/orchestrator/test_endpoints.py -q
```

预期：FAIL — `/v2/agent/run` 为 404

- [ ] **步骤 3：将 v2 端点添加到 main.py**

将以下内容添加到 `agent-service/app/main.py`（在现有端点之后，保持它们不变）：

```python
# --- v2 Orchestrator Endpoints ---
# These coexist with the old LangGraph endpoints during migration.

from app.orchestrator.engine import OrchestratorEngine, OrchestratorRequest
from app.orchestrator.tools.user_interaction import interaction_registry

_orchestrator = OrchestratorEngine()
_v2_task_counter = 0


class V2RunRequest(BaseModel):
    """Request body for /v2/agent/run."""
    user_message: str
    thread_id: str | None = None
    workspace_id: str = ""
    page_context: PageContext = Field(default_factory=PageContext)
    files: list[FileInfo] = Field(default_factory=list)
    template_id: str | None = None
    system_prompt: str | None = None
    template_prompt: str | None = None
    intent_route: str = "document_create"
    scope: str = "blank_page"
    source_policy: str = "create_new"
    length_policy: str = "preserve"
    conversation_history: list[dict] = Field(default_factory=list)
    config: dict = Field(default_factory=dict)


class V2ResumeRequest(BaseModel):
    """Request body for /v2/agent/resume."""
    thread_id: str
    resume_value: dict


class V2StopRequest(BaseModel):
    """Request body for /v2/agent/stop."""
    task_id: str


async def _run_v2_orchestrator(
    *,
    task_id: str,
    thread_id: str,
    request: OrchestratorRequest,
):
    """Background task that runs the orchestrator and handles errors."""
    try:
        await _orchestrator.run(request)
    except AgentCancelledError:
        await emit(thread_id, {"type": "cancelled"})
    except Exception as exc:
        await emit(thread_id, {"type": "error", "message": str(exc)[:500]})
    finally:
        await emit_done(thread_id)
        unregister_task(task_id, thread_id)
        interaction_registry.cleanup(thread_id)


@app.post("/v2/agent/run", dependencies=[Depends(verify_internal_secret)])
async def run_agent_v2(request: V2RunRequest):
    global _v2_task_counter
    _v2_task_counter += 1
    task_id = f"v2-task-{_v2_task_counter}"

    thread_id = request.thread_id or str(uuid4())
    register_task(task_id, thread_id)
    queue = create_queue(thread_id)
    interaction_registry.register(thread_id)

    orchestrator_request = OrchestratorRequest(
        user_message=request.user_message,
        thread_id=thread_id,
        workspace_id=request.workspace_id,
        page_id=request.page_context.page_id,
        page_title=request.page_context.page_title,
        page_content=request.page_context.page_content,
        selected_text=request.page_context.selected_text,
        selection_range=request.page_context.selection_range,
        intent_route=request.intent_route,
        scope=request.scope,
        source_policy=request.source_policy,
        length_policy=request.length_policy,
        insert_mode=request.config.get("insert_mode", "create"),
        files=[f.model_dump() for f in request.files],
        template_id=request.template_id,
        system_prompt=request.system_prompt,
        template_prompt=request.template_prompt,
        conversation_history=request.conversation_history,
        config=request.config,
    )

    asyncio.create_task(
        _run_v2_orchestrator(
            task_id=task_id,
            thread_id=thread_id,
            request=orchestrator_request,
        )
    )

    return EventSourceResponse(
        _event_generator(thread_id, queue),
        headers={"X-Task-Id": task_id},
    )


@app.post("/v2/agent/resume", dependencies=[Depends(verify_internal_secret)])
async def resume_agent_v2(request: V2ResumeRequest):
    ok = interaction_registry.submit_response(
        request.thread_id,
        request.resume_value,
    )
    if ok:
        return {"status": "resumed"}
    return {"status": "not_found"}


@app.post("/v2/agent/stop", dependencies=[Depends(verify_internal_secret)])
async def stop_agent_v2(request: V2StopRequest):
    if cancel_task(request.task_id):
        return {"status": "stopping"}
    return {"status": "not_found"}
```

**重要提示：** 在 `main.py` 顶部添加这些导入：

```python
from pydantic import BaseModel, Field
```

（`BaseModel` 已通过 `app.schemas.request` 导入，但 v2 请求模型目前在 `main.py` 中内联定义。）

- [ ] **第 4 步：运行测试以验证其通过**

```bash
cd agent-service && python -m pytest tests/orchestrator/test_endpoints.py -v
```

预期：通过 — 所有 4 个端点存在测试均通过。

- [ ] **第 5 步：提交**

```bash
git add agent-service/app/main.py agent-service/tests/orchestrator/test_endpoints.py
git commit -m "feat(orchestrator): add /v2/agent/run, /resume, /stop endpoints"
```

---

## 分块 8：NestJS 网关适配

### 任务 8：适配 NestJS gateway for v2 endpoints

在代理到 Python `/v2/` 端点的 NestJS 网关中添加新的路由处理程序。保持现有路线正常运行。

**文件：**
- 修改：`apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts`

- [ ] **步骤 1：将 v2 代理路由添加到网关控制器**

将这些方法添加到 `agent-gateway.controller.ts` 中的 `AgentGatewayController`：

```typescript
@Post('v2/run')
async runAgentV2(
  @AuthUser() user: any,
  @AuthWorkspace() workspace: any,
  @Req() req: FastifyRequest,
  @Res() res: FastifyReply,
) {
  const parts = req.parts();
  const bufferedFiles: { buffer: Buffer; mimetype: string; filename: string }[] = [];
  const fields: Record<string, string> = {};

  for await (const part of parts) {
    if (part.type === 'file') {
      if (bufferedFiles.length >= MAX_FILES) continue;
      const buffer = await part.toBuffer();
      if (buffer.length > MAX_FILE_SIZE) {
        throw new PayloadTooLargeException(`File ${part.filename} exceeds 20MB`);
      }
      bufferedFiles.push({ buffer, mimetype: part.mimetype, filename: part.filename });
    } else {
      fields[part.fieldname] = part.value as string;
    }
  }

  const files = bufferedFiles.map((file) => ({
    filename: file.filename,
    mimetype: file.mimetype,
    content_b64: file.buffer.toString('base64'),
  }));

  const history = fields.history ? JSON.parse(fields.history) : [];

  const globalSystemPrompt = await this.aiTemplateService.getSystemPrompt(
    workspace.id,
  );
  const templatePrompt = fields.templateId
    ? await this.aiTemplateService.getTemplatePrompt(
        fields.templateId,
        workspace.id,
        user.id,
      )
    : null;

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
    system_prompt: globalSystemPrompt || null,
    template_prompt: templatePrompt,
    intent_route: fields.intentRoute || 'document_create',
    scope: fields.scope || 'blank_page',
    source_policy: fields.sourcePolicy || 'create_new',
    length_policy: fields.lengthPolicy || 'preserve',
    conversation_history: history,
    workspace_id: workspace.id,
    config: {
      insert_mode: fields.insertMode || 'create',
    },
  };

  const agentUrl = new URL('/v2/agent/run', this.environmentService.getAgentServiceUrl());
  const postData = JSON.stringify(agentBody);

  const proxyReq = http.request(
    {
      hostname: agentUrl.hostname,
      port: agentUrl.port,
      path: agentUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'X-Internal-Secret': this.environmentService.getAgentInternalSecret(),
      },
    },
    (proxyRes) => {
      if (proxyRes.statusCode !== 200) {
        writeSseHeaders(res);
        res.raw.write(`data: ${JSON.stringify({ type: 'error', message: `Agent v2 returned ${proxyRes.statusCode}` })}\n\n`);
        res.raw.end();
        return;
      }

      const taskIdHeader = Array.isArray(proxyRes.headers['x-task-id'])
        ? proxyRes.headers['x-task-id'][0]
        : proxyRes.headers['x-task-id'];
      writeSseHeaders(res, taskIdHeader);

      proxyRes.on('data', (chunk: Buffer) => {
        res.raw.write(chunk);
      });
      proxyRes.on('end', () => {
        res.raw.end();
      });
      proxyRes.on('error', (err) => {
        this.logger.error('Agent v2 stream error', err);
        res.raw.end();
      });
    },
  );

  proxyReq.on('error', (err) => {
    this.logger.error('Agent v2 connection error', err);
    writeSseHeaders(res);
    res.raw.write(`data: ${JSON.stringify({ type: 'error', message: err.message || 'Agent v2 service unavailable' })}\n\n`);
    res.raw.end();
  });

  proxyReq.write(postData);
  proxyReq.end();
}

@Post('v2/resume')
async resumeAgentV2(
  @Body() dto: AgentResumeDto,
  @Res() res: FastifyReply,
): Promise<void> {
  const postData = JSON.stringify({
    thread_id: dto.threadId,
    resume_value: dto.resumeValue,
  });

  const agentUrl = new URL('/v2/agent/resume', this.environmentService.getAgentServiceUrl());

  const proxyReq = http.request(
    {
      hostname: agentUrl.hostname,
      port: agentUrl.port,
      path: agentUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'X-Internal-Secret': this.environmentService.getAgentInternalSecret(),
      },
    },
    (proxyRes) => {
      let body = '';
      proxyRes.on('data', (chunk) => { body += chunk; });
      proxyRes.on('end', () => {
        res.status(proxyRes.statusCode || 200).send(body);
      });
    },
  );

  proxyReq.on('error', (err) => {
    this.logger.error('Agent v2 resume error', err);
    res.status(502).send({ error: err.message });
  });

  proxyReq.write(postData);
  proxyReq.end();
}

@Post('v2/stop')
async stopAgentV2(@Body() dto: AgentStopDto) {
  return this.agentGatewayService.stopAgentV2(dto.taskId);
}
```

**注意：** `AgentGatewayService` 中的 `stopAgentV2` 方法应代理到 `/v2/agent/stop`。如果服务还没有此方法，请按照与现有 `stopAgent` 相同的模式添加它。

- [ ] **第 2 步：验证网关是否编译**

```bash
cd E:/test/Docmost && pnpm --filter ./apps/server exec tsc --noEmit --pretty
```

预期：没有编译错误。

- [ ] **第 3 步：提交**

```bash
git add apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts
git commit -m "feat(gateway): add v2 proxy routes for orchestrator endpoints"
```

---

## 分块 9：Level 1 端到端测试

### 任务 9：Level 1 end-to-end integration test

练习完整 1 级路径的测试：请求 → 复杂性分析 → simple_edit → 最终确定 → SSE 事件。

**文件：**
- 创建：`agent-service/tests/orchestrator/test_e2e_level1.py`

**注意：** 该测试模拟了 LLM 层，但真实地练习了其他所有内容。

- [ ] **第 1 步：编写端到端测试**

```python
# agent-service/tests/orchestrator/test_e2e_level1.py
"""End-to-end test for Level 1 (simple edit) path.

Tests the full pipeline: v2 endpoint → OrchestratorEngine →
analyze_complexity → simple_edit → finalize → SSE events.

The LLM is mocked to return deterministic content.
"""

import asyncio
import json
from unittest.mock import AsyncMock, patch, MagicMock

import pytest
from httpx import AsyncClient, ASGITransport

from app.config import settings
from app.main import app


def _make_mock_agent():
    """Create a mock PydanticAI Agent that returns a predictable result."""
    mock_agent = MagicMock()

    class MockStreamResult:
        async def stream_text(self, *, delta=False):
            yield "Hello "
            yield "World"

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

    mock_agent.run_stream = MagicMock(return_value=MockStreamResult())
    return mock_agent


@pytest.mark.asyncio
async def test_level1_translate_e2e():
    """Full Level 1 flow: translate request → SSE stream with content."""
    with patch("app.orchestrator.tools.simple_edit.Agent") as MockAgentClass, \
         patch("app.orchestrator.tools.simple_edit.create_pydantic_ai_model") as mock_factory:

        mock_factory.return_value = "test-model"

        class MockStreamResult:
            async def stream_text(self, *, delta=False):
                yield "Hello "
                yield "World"

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                pass

        mock_instance = MagicMock()
        mock_instance.run_stream = MagicMock(return_value=MockStreamResult())
        MockAgentClass.return_value = mock_instance

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/v2/agent/run",
                json={
                    "user_message": "翻译成英文：你好世界",
                    "page_context": {
                        "selected_text": "你好世界",
                    },
                    "intent_route": "selection_edit",
                },
                headers={"X-Internal-Secret": settings.agent_internal_secret},
            )

            assert response.status_code == 200
            assert "text/event-stream" in response.headers.get("content-type", "")

            # Parse SSE events
            events = []
            for line in response.text.split("\n"):
                if line.startswith("data: "):
                    data = json.loads(line[6:])
                    events.append(data)

            # Verify event sequence
            event_types = [e["type"] for e in events]

            # Should have: session → step_start (complexity) → step_done →
            # step_start (edit) → content → content → step_done → done
            assert "session" in event_types
            assert "step_start" in event_types
            assert "content" in event_types
            assert "done" in event_types

            # Verify content was streamed
            content_chunks = [e["chunk"] for e in events if e["type"] == "content"]
            assert "".join(content_chunks) == "Hello World"

            # Verify done event has final content
            done_events = [e for e in events if e["type"] == "done"]
            assert len(done_events) == 1
            assert done_events[0]["final_content"] == "Hello World"


@pytest.mark.asyncio
async def test_level1_completes_without_ask_user():
    """Level 1 tasks should NEVER invoke ask_user."""
    with patch("app.orchestrator.tools.simple_edit.Agent") as MockAgentClass, \
         patch("app.orchestrator.tools.simple_edit.create_pydantic_ai_model"):

        class MockStreamResult:
            async def stream_text(self, *, delta=False):
                yield "Fixed text"

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                pass

        mock_instance = MagicMock()
        mock_instance.run_stream = MagicMock(return_value=MockStreamResult())
        MockAgentClass.return_value = mock_instance

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            response = await client.post(
                "/v2/agent/run",
                json={
                    "user_message": "改错别字",
                    "page_context": {
                        "selected_text": "这是一段有错别子的文字",
                    },
                    "intent_route": "selection_edit",
                },
                headers={"X-Internal-Secret": settings.agent_internal_secret},
            )

            events = []
            for line in response.text.split("\n"):
                if line.startswith("data: "):
                    events.append(json.loads(line[6:]))

            event_types = [e["type"] for e in events]
            assert "await_input" not in event_types
            assert "done" in event_types
```

- [ ] **第 2 步：运行测试**

```bash
cd agent-service && python -m pytest tests/orchestrator/test_e2e_level1.py -v
```

预期：通过 - 完整的 1 级管道与模拟的 LLM 端到端工作。

- [ ] **第 3 步：提交**

```bash
git add agent-service/tests/orchestrator/test_e2e_level1.py
git commit -m "test(orchestrator): add Level 1 end-to-end integration test"
```

---

## 分块 10：前端事件适配

### 任务 10：Frontend event handler adaptation

在现有事件处理旁边添加 v2 事件规范化。第 2+ 阶段的新事件已定义但尚未使用。

**文件：**
- 修改：`apps/client/src/ee/ai/services/ai-create-runner.utils.ts`

- [ ] **步骤 1：将 v2 事件类型添加到 AiCreateRunEvent**

将这些新事件类型添加到 `ai-create-runner.utils.ts` 中的 `AiCreateRunEvent` 联合中：

```typescript
// Add to the AiCreateRunEvent union type:
| { type: "section_progress"; sectionId: string; sectionTitle: string; progress: number }
| { type: "brief_ready"; data: unknown }
| { type: "blueprint_ready"; data: unknown }
| { type: "review_ready"; data: unknown }
| { type: "complexity_analyzed"; level: 1 | 2 | 3; reasoning: string }
```

- [ ] **步骤 2：将 v2 事件规范化案例添加到 normalizeAgentRunEvent**

将这些案例添加到 `normalizeAgentRunEvent` 中的 `switch`：

```typescript
case "section_progress":
  return {
    type: "section_progress",
    sectionId: (event as any).section_id || (event as any).sectionId || "",
    sectionTitle: (event as any).section_title || (event as any).sectionTitle || "",
    progress: (event as any).progress || 0,
  };
case "brief_ready":
  return {
    type: "brief_ready",
    data: (event as any).data || {},
  };
case "blueprint_ready":
  return {
    type: "blueprint_ready",
    data: (event as any).data || {},
  };
case "review_ready":
  return {
    type: "review_ready",
    data: (event as any).data || {},
  };
case "complexity_analyzed":
  return {
    type: "complexity_analyzed",
    level: (event as any).level || 3,
    reasoning: (event as any).reasoning || "",
  };
```

- [ ] **第 3 步：验证 TypeScript 是否编译**

```bash
cd E:/test/Docmost && pnpm --filter ./apps/client exec tsc --noEmit --pretty
```

预期：没有编译错误。

- [ ] **第 4 步：提交**

```bash
git add apps/client/src/ee/ai/services/ai-create-runner.utils.ts
git commit -m "feat(client): add v2 event types for orchestrator SSE protocol"
```

---

## 最终验证

- [ ] **第 1 步：运行所有 Orchestrator 测试**

```bash
cd agent-service && python -m pytest tests/orchestrator/ -v
```

预期：所有测试均通过。

- [ ] **步骤 2：运行现有代理测试（回归检查）**

```bash
cd agent-service && python -m pytest tests/ -v --ignore=tests/orchestrator/
```

预期：现有测试仍然通过 - v2 代码不会破坏 v1。

- [ ] **步骤 3：验证服务器编译**

```bash
cd E:/test/Docmost && pnpm --filter ./apps/server exec tsc --noEmit --pretty
```

预期：没有错误。

- [ ] **第 4 步：验证客户端编译**

```bash
cd E:/test/Docmost && pnpm --filter ./apps/client exec tsc --noEmit --pretty
```

预期：没有错误。

- [ ] **第 5 步：最终提交和标记**

```bash
git add -A
git commit -m "docs: add Phase 1 orchestrator implementation plan"
```

---

## 依赖关系图

```
任务 1 (LLM Factory)
    ↓
任务 2 (Complexity) ←── independent of 任务 1
    ↓
任务 3 (User Interaction) ←── independent of 任务 1/2
    ↓
任务 4 (Simple Edit) ←── depends on 任务 1 (llm_factory)
    ↓
任务 5 (Finalize) ←── independent
    ↓
任务 6 (Engine) ←── depends on 任务 1-5
    ↓
任务 7 (FastAPI Endpoints) ←── depends on 任务 6
    ↓
任务 8 (NestJS Gateway) ←── depends on 任务 7 (endpoint URLs)
    ↓
任务 9 (E2E Test) ←── depends on 任务 7
    ↓
任务 10 (Frontend Events) ←── independent of backend tasks
```

任务 1、2、3、5 和 10 可以并行进行。任务 4 取决于任务 1。任务 6 取决于所有工具任务。任务 7-9 是连续的。

---

## 阶段 1 Deliverables Summary

第一阶段完成后，系统可以：

1. 通过`/v2/agent/run`接受请求（与旧的`/agent/run`共存）
2. 确定性地分析任务复杂性（无需LLM）
3. 端到端执行 1 级任务（翻译、修正拼写、缩短、改变语气）
4. 通过 SSE 流式传输结果，事件格式与 v1 相同
5. 通过 `ask_user` 机制暂停/恢复（基础设施就绪，在阶段 2+ 中使用）
6.通过`/v2/agent/stop`取消正在运行的任务
7.通过NestJS网关代理到前端

第 1 阶段不做什么（推迟到第 2+ 阶段）：
- 2/3 级任务退回到 simple_edit（无计划/蓝图/审查）
- 工人代表团（无 `plan_worker`、`write_worker`、`review_worker`）
- 证据获取（保留在 v1 LangGraph 路径中）
- 资产地图构建
- 多节写作
- 审查和修订循环
