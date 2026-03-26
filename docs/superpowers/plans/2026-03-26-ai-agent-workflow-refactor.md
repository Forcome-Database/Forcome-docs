# AI Agent 工作流重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 L3 研究分支死代码和 researcher 同步阻塞；修复 engine.py 乱码字符串；新增 routing_decision SSE 事件增加 Agent 透明度；添加 Brief 质量门控；提取 Review 循环消除代码重复。

**Architecture:** 先修复 3 个 P0/P1 bug（L3 研究分支、researcher async、乱码字符串），再添加新 SSE 事件类型（routing_decision），然后添加 Brief 验证逻辑，最后提取 Review 循环消除 L2/L3 间的代码重复。

**Tech Stack:** Python 3.12 + FastAPI + asyncio + PydanticAI

**Spec:** `docs/superpowers/specs/2026-03-26-ai-writing-comprehensive-improvement-design.md` Section 4

---

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|------|---------|------|
| 修改 | `agent-service/app/orchestrator/engine.py:1027-1028` | 修复 L3 研究分支死代码 |
| 修改 | `agent-service/app/orchestrator/engine.py:442,874,880,932,943,972` | 修复乱码字符串 |
| 修改 | `agent-service/app/workers/researcher.py:45-66` | 同步调用改 async |
| 修改 | `agent-service/app/schemas/response.py` | 新增 RoutingDecisionEvent |
| 修改 | `agent-service/app/orchestrator/engine.py:294-350` | run() 中发射 routing_decision |
| 修改 | `agent-service/app/orchestrator/tools/create_brief.py` | Brief 验证 + 条件重试 |
| 新增 | `agent-service/app/orchestrator/review/review_loop.py` | 提取统一 Review 循环 |

---

## Task 1: 修复 L3 研究分支死代码

**背景：** engine.py L1027-1028 硬编码 `has_text_assets = True` 和 `has_sufficient_evidence = True`，导致 Web 研究分支永不执行。

**Files:**
- 修改: `agent-service/app/orchestrator/engine.py:1027-1028`

- [ ] **Step 1: 读取上下文**

```bash
cd agent-service && grep -n "has_text_assets\|has_sufficient_evidence" app/orchestrator/engine.py
```

- [ ] **Step 2: 修复硬编码**

找到 L1027-1028：
```python
has_text_assets = True
has_sufficient_evidence = True
```

替换为：
```python
has_text_assets = bool(asset_map and asset_map.items)
has_sufficient_evidence = has_text_assets
```

- [ ] **Step 3: 检查研究分支引用的函数是否存在**

```bash
grep -n "research_tool\|_extract_first_url" app/orchestrator/engine.py
```

如果 `research_tool` 未导入，在文件顶部添加：
```python
from app.workers.researcher import research as research_tool
```

如果 `_extract_first_url` 未定义，在 `OrchestratorEngine` 类之前添加：
```python
import re as _re

def _extract_first_url(text: str) -> str | None:
    urls = _re.findall(r'https?://\S+', text)
    return urls[0].rstrip('.,)>') if urls else None
```

- [ ] **Step 4: 确认 Python 可加载**

```bash
cd agent-service && python -c "from app.orchestrator.engine import OrchestratorEngine; print('ok')"
```

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/orchestrator/engine.py
git commit -m "fix: restore L3 web research branch by removing hardcoded has_sufficient_evidence=True"
```

---

## Task 2: 修复 researcher.py 同步阻塞

**背景：** `_tavily_invoke` 等 4 个函数在 `async def research` 中同步调用 `tool.invoke()`，阻塞 asyncio event loop。

**Files:**
- 修改: `agent-service/app/workers/researcher.py:45-66`

- [ ] **Step 1: 读取当前代码**

读取 `agent-service/app/workers/researcher.py`，找到 L45-66 的 4 个同步函数。

- [ ] **Step 2: 将同步调用改为 async（通过 executor）**

在文件顶部确认 `import asyncio` 存在。

将 4 个函数从同步改为 async：

```python
# 修改前（示例）：
def _tavily_invoke(query: str, max_results: int = 5) -> str:
    tool = _get_tavily_search()
    return tool.invoke({"query": query, "max_results": max_results})

# 修改后：
async def _tavily_invoke(query: str, max_results: int = 5) -> str:
    tool = _get_tavily_search()
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None, tool.invoke, {"query": query, "max_results": max_results}
    )
```

对 `_firecrawl_invoke`、`_rag_invoke`、`_page_read_invoke` 做同样处理。

- [ ] **Step 3: 更新调用点**

在 `research` 函数（L81+）中，将所有 `_tavily_invoke(...)` 改为 `await _tavily_invoke(...)`（如果还不是 await 的话）。同样处理其他 3 个函数。

- [ ] **Step 4: 确认可导入**

```bash
cd agent-service && python -c "from app.workers.researcher import research; print('ok')"
```

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/workers/researcher.py
git commit -m "fix(perf): wrap sync tool.invoke calls in run_in_executor in researcher.py"
```

---

## Task 3: 修复 engine.py 乱码字符串

**背景：** engine.py 中 6 处乱码字符串（GB2312 被错误编码为 UTF-8）。

**Files:**
- 修改: `agent-service/app/orchestrator/engine.py:442,874,880,932,943,972`

- [ ] **Step 1: 定位所有乱码行**

```bash
grep -n "绛\|锛\|瓒\|涓\|鍒\|宸\|彇\|娑\|璇\|褰\|杈\|闃\|鏈\|瀛\|缁\|闀\|绱\|璺\|璐\|绔\|鑷" agent-service/app/orchestrator/engine.py
```

- [ ] **Step 2: 逐行替换为英文**

| 行号 | 乱码 | 替换为 |
|------|------|--------|
| L442 | `绛夊緟 Blueprint 纭瓒呮椂锛?0鍒嗛挓锛夛紝浠诲姟宸插彇娑?` | `"Timed out waiting for blueprint confirmation (10 min). Task cancelled."` |
| L874 | `绛夊緟璇勫纭瓒呮椂锛?0鍒嗛挓锛夛紝褰撳墠鍐呭浠嶆湭杈炬爣` | `"Timed out waiting for review confirmation (10 min). Content below target."` |
| L880 | `璇勫瓒呮椂锛屼粛瀛樺湪鏈В鍐崇殑闃诲闂锛屾棤娉曞畬鎴?` | `"Review timed out with unresolved blocking issues. Cannot finalize."` |
| L932 | `浠嶅瓨鍦ㄥ繀椤讳慨澶嶇殑缁撴瀯銆侀暱搴︽垨绱犳潗闂锛屾棤娉曠洿鎺ヨ烦杩囧畬鎴?` | `"Blocking structure/length/asset issues remain. Cannot skip to finalize."` |
| L943 | `璇烽€夋嫨瑕佷慨澶嶇殑闂锛涘彧鏈夎瑙夐棶棰樻墠鍏佽璺宠繃瀹屾垚` | `"Select issues to fix. Only visual issues can be skipped."` |
| L972 | `绔犺妭闆嗗悎涓?blueprint 涓嶄竴鑷达紝鏃犳硶 finalize` | `"Section set inconsistent with blueprint. Cannot finalize."` |

在每行使用编辑器的查找/替换功能精确匹配乱码字符串并替换。

- [ ] **Step 3: 确认文件编码**

```bash
file agent-service/app/orchestrator/engine.py
# 应为 UTF-8
```

- [ ] **Step 4: 确认可导入**

```bash
cd agent-service && python -c "from app.orchestrator.engine import OrchestratorEngine; print('ok')"
```

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/orchestrator/engine.py
git commit -m "fix: replace garbled Chinese timeout messages with English in engine.py"
```

---

## Task 4: 新增 routing_decision SSE 事件

**背景：** 用户不知道 Agent 为什么选了某个执行路径。新增 `routing_decision` 事件让前端展示路由决策理由。

**Files:**
- 修改: `agent-service/app/schemas/response.py`
- 修改: `agent-service/app/orchestrator/engine.py:294-350`（run 方法）

- [ ] **Step 1: 在 response.py 中新增事件类型**

在 `CancelledEvent`（L149）之后添加：

```python
class RoutingDecisionEvent(BaseModel):
    type: Literal["routing_decision"] = "routing_decision"
    task_type: str  # e.g. "structured_create", "selection_edit"
    strategy: str   # e.g. "full_pipeline", "direct_edit"
    reason: str     # human-readable reason
    confidence: float = 1.0
```

在 `SSEEvent` 联合类型（L158）中添加 `| RoutingDecisionEvent`。

- [ ] **Step 2: 在 engine.py 的 run() 方法中发射事件**

在 `run()` 方法（L294-350）中，Level 路由决策后（选择 L1/L2/L3 后），调用 emit 发射事件：

```python
from app.schemas.response import RoutingDecisionEvent

# 在选择 level 后，执行 _execute_levelX 之前
await self._emit(RoutingDecisionEvent(
    task_type=complexity_result.get("task_type", "unknown"),
    strategy=f"level_{level}",
    reason=complexity_result.get("reason", "Determined by complexity analysis"),
    confidence=complexity_result.get("confidence", 1.0),
))
```

需要先读取 `run()` 方法的实际代码，确认 complexity 分析结果的变量名和 emit 方法名。

- [ ] **Step 3: 确认可导入**

```bash
cd agent-service && python -c "from app.schemas.response import RoutingDecisionEvent; print('ok')"
```

- [ ] **Step 4: Commit**

```bash
git add agent-service/app/schemas/response.py agent-service/app/orchestrator/engine.py
git commit -m "feat: add routing_decision SSE event for Agent transparency"
```

---

## Task 5: Brief 质量门控

**背景：** Brief 由 LLM 一次性生成，无质量验证。默认值（"general audience"、"general-purpose writing"）会直接通过。

**Files:**
- 修改: `agent-service/app/orchestrator/tools/create_brief.py`

- [ ] **Step 1: 读取 create_brief.py**

```bash
wc -l agent-service/app/orchestrator/tools/create_brief.py
head -30 agent-service/app/orchestrator/tools/create_brief.py
```

找到 `generate_brief` 或 `create_brief` 函数的返回点。

- [ ] **Step 2: 添加验证函数**

在 `create_brief.py` 中添加：

```python
import re as _re


def _extract_explicit_length(text: str) -> int | None:
    """Extract explicit word count from user message like '2000字' or '2000 words'."""
    m = _re.search(r'(\d{3,6})\s*(?:字|词|words?|characters?)', text, _re.IGNORECASE)
    return int(m.group(1)) if m else None


def _validate_brief(brief, user_message: str) -> tuple[bool, list[str]]:
    """Deterministic validation — no LLM needed."""
    issues = []
    if getattr(brief, 'target_length', 0) <= 0:
        issues.append("target_length is zero or negative")
    if getattr(brief, 'goal', '') in ('', 'general-purpose writing'):
        issues.append("goal was not analyzed from user message")
    if getattr(brief, 'audience', '') in ('', 'general audience'):
        issues.append("audience was not inferred")
    explicit = _extract_explicit_length(user_message)
    if explicit and hasattr(brief, 'target_length'):
        if abs(brief.target_length - explicit) > explicit * 0.5:
            issues.append(f"target_length {brief.target_length} diverges from user-specified {explicit}")
    return len(issues) == 0, issues
```

- [ ] **Step 3: 在 brief 生成后调用验证**

找到 brief 生成的返回点。在返回前添加验证 + 条件重试（最多 1 次）：

```python
valid, issues = _validate_brief(brief, user_message)
if not valid and retry_count == 0:
    logger.warning("Brief validation failed: %s. Retrying with hints.", issues)
    # Retry with issues as hint in prompt
    hint = f"\nPrevious attempt failed validation: {', '.join(issues)}. Please fix these."
    brief = await _call_llm_for_brief(user_message + hint, ...)
    retry_count += 1
```

具体实现取决于函数签名和调用方式，需要先读取实际代码。

- [ ] **Step 4: 确认可导入**

```bash
cd agent-service && python -c "from app.orchestrator.tools.create_brief import _validate_brief; print('ok')"
```

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/orchestrator/tools/create_brief.py
git commit -m "feat: add Brief quality validation with conditional retry"
```

---

## Task 6: 提取 Review 循环消除重复

**背景：** `_execute_structured_write_from_brief`（L866-969）和 `_execute_level3`（L1185-1288）中的 Review 循环代码几乎完全相同。

**Files:**
- 新增: `agent-service/app/orchestrator/review/__init__.py`
- 新增: `agent-service/app/orchestrator/review/review_loop.py`
- 修改: `agent-service/app/orchestrator/engine.py:866-969,1185-1288`

- [ ] **Step 1: 创建 review 目录**

```bash
mkdir -p agent-service/app/orchestrator/review
touch agent-service/app/orchestrator/review/__init__.py
```

- [ ] **Step 2: 读取 L2 和 L3 的 Review 循环代码**

读取 engine.py L866-969 和 L1185-1288，对比差异。

- [ ] **Step 3: 创建 review_loop.py**

提取公共逻辑到 `review_loop.py`。由于两个循环几乎相同（只有超时消息不同），创建一个参数化函数：

```python
# agent-service/app/orchestrator/review/review_loop.py
"""Unified review loop shared by L2 structured write and L3 pipeline."""
import logging

logger = logging.getLogger(__name__)


async def run_review_loop(
    *,
    section_drafts,
    blueprint,
    brief,
    asset_map,
    thread_id: str,
    page_id: str | None,
    emit_fn,
    await_user_input_fn,
    evaluate_fn,
    fix_fn,
    finalize_fn,
    timeout_message: str = "Review timed out.",
    blocking_message: str = "Blocking issues remain.",
):
    """
    Run the review → fix → finalize loop.

    This is the common logic extracted from _execute_structured_write_from_brief
    and _execute_level3 to eliminate code duplication.
    """
    # Implementation: copy the review loop logic from one of the methods
    # and parameterize the differences (timeout messages, callbacks)
    pass  # IMPLEMENTER: Copy actual logic from engine.py L866-969
```

- [ ] **Step 4: 在 engine.py 中替换两处 Review 循环**

在 `_execute_structured_write_from_brief` 和 `_execute_level3` 中，将重复的 Review 循环代码替换为：

```python
from app.orchestrator.review.review_loop import run_review_loop

await run_review_loop(
    section_drafts=section_drafts,
    blueprint=blueprint,
    brief=brief,
    asset_map=asset_map,
    thread_id=self.thread_id,
    page_id=request.page_id,
    emit_fn=self._emit,
    await_user_input_fn=self._await_user_input,
    evaluate_fn=...,
    fix_fn=...,
    finalize_fn=...,
    timeout_message="Timed out waiting for review confirmation (10 min).",
    blocking_message="Blocking issues remain. Cannot finalize.",
)
```

- [ ] **Step 5: 确认可导入且无回归**

```bash
cd agent-service && python -c "from app.orchestrator.engine import OrchestratorEngine; print('ok')"
```

- [ ] **Step 6: Commit**

```bash
git add agent-service/app/orchestrator/review/ agent-service/app/orchestrator/engine.py
git commit -m "refactor: extract unified Review loop to eliminate code duplication between L2 and L3"
```

---

## 验收检查

```bash
cd agent-service

# 确认 L3 研究分支修复
python -c "
import inspect
from app.orchestrator.engine import OrchestratorEngine
src = inspect.getsource(OrchestratorEngine._execute_level3)
assert 'has_sufficient_evidence = True' not in src, 'Bug still present'
assert 'has_text_assets' in src
print('OK: L3 research branch fixed')
"

# 确认乱码已清除
grep -c "绛\|锛\|瓒" app/orchestrator/engine.py
# 预期: 0

# 确认 researcher 使用 async
python -c "
import inspect, asyncio
from app.workers.researcher import _tavily_invoke
assert asyncio.iscoroutinefunction(_tavily_invoke), 'Not async'
print('OK: researcher is async')
"

# 确认新 SSE 事件可导入
python -c "from app.schemas.response import RoutingDecisionEvent; print('OK: RoutingDecisionEvent')"

# 确认 Brief 验证可导入
python -c "from app.orchestrator.tools.create_brief import _validate_brief; print('OK: _validate_brief')"

# 确认 Review 循环可导入
python -c "from app.orchestrator.review.review_loop import run_review_loop; print('OK: review_loop')"
```
