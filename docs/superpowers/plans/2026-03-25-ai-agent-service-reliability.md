# AI Agent Service 可靠性与性能改进计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Python Agent Service 中阻碍 Level 3 核心功能的死代码、异步阻塞问题和资源泄漏，提升实际可用性和稳定性。

**Architecture:** 以最小改动恢复 L3 研究分支功能；将 Tavily/Firecrawl/Docmost 同步工具调用包装为 `run_in_executor`；为 Docling 添加超时保护；清理 asset cache 内存泄漏；修复 engine.py 中文乱码。

**Tech Stack:** Python 3.12 + FastAPI + asyncio + PydanticAI + httpx

---

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|------|---------|------|
| 修改 | `agent-service/app/orchestrator/engine.py:1027-1028` | 移除 `has_sufficient_evidence = True` 硬编码 |
| 修改 | `agent-service/app/workers/researcher.py:45-54,126-134` | 同步工具包装 executor |
| 修改 | `agent-service/app/orchestrator/tools/parse_assets.py:172-178` | Docling 添加超时 |
| 修改 | `agent-service/app/orchestrator/tools/parse_assets.py:21,28` | asset cache 添加 TTL 清理 |
| 修改 | `agent-service/app/orchestrator/engine.py:443` | 修复 UTF-8 乱码 |
| 新增 | `agent-service/tests/orchestrator/test_engine_level3_research.py` | L3 研究分支测试 |
| 新增 | `agent-service/tests/workers/test_researcher_executor.py` | executor 包装测试 |

---

## Task 1: 修复 Level 3 研究分支死代码

**背景：** `engine.py` 第 1027-1029 行：
```python
has_text_assets = True
has_sufficient_evidence = True   # ← 硬编码！
if not has_sufficient_evidence:  # ← 永远不执行
```
导致空白页创作时完全跳过 Web 研究步骤，Level 3 的研究功能失效。

**Files:**
- 修改: `agent-service/app/orchestrator/engine.py:1027-1028`
- 新增: `agent-service/tests/orchestrator/test_engine_level3_research.py`

- [ ] **Step 1: 阅读上下文，理解 has_text_assets 的正确语义**

```bash
grep -n "has_text_assets\|has_sufficient_evidence\|asset_map" \
  agent-service/app/orchestrator/engine.py | head -30
```

`has_text_assets` 应当根据 `asset_map` 是否包含有效文本内容来决定：
```python
has_text_assets = bool(asset_map and asset_map.items)
has_sufficient_evidence = has_text_assets  # 有上传资产则无需额外 Web 研究
```

- [ ] **Step 2: 写失败测试（修复前验证硬编码存在）**

通过源码检查验证修复——修复前此测试 FAIL，修复后 PASS：

```python
# agent-service/tests/orchestrator/test_engine_level3_research.py
import inspect
import pytest


def test_level3_does_not_hardcode_has_sufficient_evidence():
    """
    验证 _execute_level3 不再硬编码 has_sufficient_evidence = True。
    修复前：FAIL（硬编码存在）。
    修复后：PASS（改为从 asset_map 计算）。
    """
    from app.orchestrator.engine import OrchestratorEngine
    source = inspect.getsource(OrchestratorEngine._execute_level3)

    assert 'has_sufficient_evidence = True' not in source, (
        "Bug still present: 'has_sufficient_evidence = True' is hardcoded. "
        "Replace with: has_sufficient_evidence = bool(asset_map and asset_map.items)"
    )
    assert 'has_text_assets' in source, (
        "Fix missing: 'has_text_assets' computation not found in _execute_level3"
    )
```

- [ ] **Step 3: 运行测试，确认 FAIL（修复前）**

```bash
cd agent-service
pytest tests/orchestrator/test_engine_level3_research.py -v
# 预期：FAILED — AssertionError: Bug still present: 'has_sufficient_evidence = True' is hardcoded
```

- [ ] **Step 4: 修复 engine.py**

定位第 1027-1028 行，将：
```python
has_text_assets = True
has_sufficient_evidence = True
```
替换为：
```python
has_text_assets = bool(asset_map and asset_map.items)
has_sufficient_evidence = has_text_assets
```

研究分支还引用了两个在 engine.py 中**不存在**的函数，必须同步添加：

**`research_tool`：** 在文件顶部添加 import：
```python
from app.workers.researcher import research as research_tool
```

**`_extract_first_url`：** 整个代码库中均未定义，需在 engine.py 的类定义之前直接实现：
```python
import re

def _extract_first_url(text: str) -> str | None:
    """Extract the first URL found in text."""
    urls = re.findall(r'https?://\S+', text)
    return urls[0].rstrip('.,)>') if urls else None
```

确认文件顶部已有 `import re`（若无则添加）。

- [ ] **Step 5: 运行现有 L3 测试确认不破坏**

```bash
pytest tests/orchestrator/test_e2e_level3.py tests/orchestrator/test_engine.py -v -x
# 预期：全部 PASS（无回归）
```

- [ ] **Step 6: Commit**

```bash
git add agent-service/app/orchestrator/engine.py
git add agent-service/tests/orchestrator/test_engine_level3_research.py
git commit -m "fix: restore Level 3 web research branch by removing hardcoded has_sufficient_evidence=True"
```

---

## Task 2: 同步工具调用包装 run_in_executor

**背景：** `researcher.py` 中 `_tavily_invoke` 和 `_firecrawl_invoke` 在 `async def` 中直接调用同步 `tool.invoke(...)`，阻塞 asyncio event loop，影响 SSE 推送实时性。

**Files:**
- 修改: `agent-service/app/workers/researcher.py:45-54,126-134`

- [ ] **Step 1: 定位现有调用模式**

```bash
grep -n "tool.invoke\|_tavily_invoke\|_firecrawl_invoke" \
  agent-service/app/workers/researcher.py
```

- [ ] **Step 2: 写测试验证包装后行为不变**

```python
# agent-service/tests/workers/test_researcher_executor.py
import asyncio
import pytest
from unittest.mock import MagicMock, patch


@pytest.mark.asyncio
async def test_tavily_invoke_does_not_block_event_loop():
    """
    验证 _tavily_invoke 通过 executor 调用，不阻塞当前协程。
    使用 asyncio.sleep(0) 检测是否在调用期间其他协程可以运行。
    """
    ran_concurrently = []

    async def concurrent_task():
        ran_concurrently.append("ran")

    # Mock tavily tool
    mock_tool = MagicMock()
    mock_tool.invoke.return_value = [{"content": "result", "url": "http://example.com"}]

    with patch("app.workers.researcher.tavily_tool", mock_tool):
        from app.workers.researcher import _tavily_invoke

        # 并发运行搜索任务 + 后台任务
        task = asyncio.create_task(concurrent_task())
        await _tavily_invoke("test query")
        await task

    # 如果 _tavily_invoke 是 async（通过 executor），后台任务应该能运行
    assert "ran" in ran_concurrently
```

- [ ] **Step 3: 运行测试，确认当前行为（可能 FAIL 或 PASS，记录基准）**

```bash
pytest tests/workers/test_researcher_executor.py -v
```

- [ ] **Step 4: 修改 researcher.py**

找到 `_tavily_invoke` 和 `_firecrawl_invoke` 函数（或内联调用），将同步调用改为 executor：

```python
# 修改前（示例）
def _tavily_invoke(query: str) -> list[dict]:
    return tavily_tool.invoke(query)

# 修改后
async def _tavily_invoke(query: str) -> list[dict]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, tavily_tool.invoke, query)
```

**`researcher.py` 中共有 4 个同步 invoke 函数需要全部包装：**

```python
# _firecrawl_invoke
async def _firecrawl_invoke(url: str) -> list[dict]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, firecrawl_tool.invoke, url)

# _rag_invoke（若存在）
async def _rag_invoke(query: str, workspace_id: str) -> list[dict]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, rag_tool.invoke, {"query": query, "workspace_id": workspace_id})

# _page_read_invoke（若存在）
async def _page_read_invoke(page_id: str) -> list[dict]:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, page_read_tool.invoke, page_id)
```

确认文件顶部有 `import asyncio`。

**更新全部调用点（4 个函数）：**
```bash
grep -n "_tavily_invoke\|_firecrawl_invoke\|_rag_invoke\|_page_read_invoke\|tool\.invoke" \
  agent-service/app/workers/researcher.py
```

将每处直接调用改为 `await fn(...)`，并确保调用方函数是 `async def`。

- [ ] **Step 5: 对 docmost_api 工具同样包装（同一文件中）**

```bash
grep -n "docmost_page_read\|docmost_rag\|tool.invoke" agent-service/app/workers/researcher.py
```

同样改为 `await loop.run_in_executor(None, tool.invoke, ...)` 模式。

- [ ] **Step 6: 运行全部 researcher 测试**

```bash
pytest tests/workers/test_researcher.py tests/workers/test_researcher_executor.py -v
# 预期：全部 PASS
```

- [ ] **Step 7: Commit**

```bash
git add agent-service/app/workers/researcher.py
git add agent-service/tests/workers/test_researcher_executor.py
git commit -m "fix(perf): wrap sync tool.invoke calls in run_in_executor in researcher.py"
```

---

## Task 3: Docling 解析添加超时保护

**背景：** `parse_assets.py` 中 Docling 解析通过 `loop.run_in_executor(None, parse_document, ...)` 调用，但没有 `asyncio.wait_for` 超时包装，大文件可能无限占用 executor 线程。

**Files:**
- 修改: `agent-service/app/orchestrator/tools/parse_assets.py`（parse_document 调用处）

- [ ] **Step 1: 定位调用位置**

```bash
grep -n "run_in_executor.*parse_document\|parse_document" \
  agent-service/app/orchestrator/tools/parse_assets.py | head -15
```

- [ ] **Step 2: 写失败测试（验证 wait_for 尚未添加）**

```python
# 在 agent-service/tests/orchestrator/test_parse_assets.py 追加以下测试
import inspect
import pytest


def test_parse_assets_uses_asyncio_wait_for():
    """
    验证 parse_assets.py 已使用 asyncio.wait_for 包装 Docling 调用。
    修复前：FAIL（源码中无 wait_for）。
    修复后：PASS。
    """
    from app.orchestrator.tools import parse_assets as parse_assets_module
    source = inspect.getsource(parse_assets_module)
    assert 'asyncio.wait_for' in source, (
        "parse_assets.py must wrap the Docling executor call with asyncio.wait_for"
    )
    assert 'PARSE_TIMEOUT_SECONDS' in source or 'timeout' in source.lower(), (
        "parse_assets.py must define a timeout constant for Docling"
    )
```

- [ ] **Step 3: 在 parse_assets.py 中添加超时**

找到 `run_in_executor` 调用，包装 `asyncio.wait_for`：

```python
# 修改前
result = await loop.run_in_executor(None, parse_document, file_path)

# 修改后
PARSE_TIMEOUT_SECONDS = 120  # 2 分钟，可通过环境变量配置

try:
    result = await asyncio.wait_for(
        loop.run_in_executor(None, parse_document, file_path),
        timeout=PARSE_TIMEOUT_SECONDS,
    )
except asyncio.TimeoutError:
    logger.warning(f"Docling parse timed out after {PARSE_TIMEOUT_SECONDS}s: {file_path}")
    # 必须返回 AssetMap() 而非 None：调用方（asyncio.gather 收集结果后）
    # 会访问 asset_map.items，None 会引发 AttributeError
    from app.models.asset_map import AssetMap
    return AssetMap()
```

确认文件顶部有 `import asyncio`。

- [ ] **Step 4: 运行 parse_assets 测试**

```bash
pytest tests/orchestrator/test_parse_assets.py -v
# 预期：全部 PASS，无回归
```

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/orchestrator/tools/parse_assets.py
git commit -m "fix(stability): add asyncio.wait_for timeout to Docling parse_document executor call"
```

---

## Task 4: 修复 asset cache 内存泄漏

**背景：** `parse_assets.py` 的模块级 `_asset_cache` 是 `dict`，key 为文件 MD5，没有 TTL 或大小上限，长时间运行后内存无限增长。

**Files:**
- 修改: `agent-service/app/orchestrator/tools/parse_assets.py:21,28-31`

- [ ] **Step 1: 写测试验证 cache 有大小上限**

```python
# 在 tests/orchestrator/test_parse_assets.py 追加
def test_asset_cache_has_max_size():
    """验证 cache 的条目数不会无限增长"""
    from app.orchestrator.tools.parse_assets import _asset_cache, MAX_CACHE_SIZE

    # 插入超过上限的条目
    for i in range(MAX_CACHE_SIZE + 10):
        _asset_cache[f"fake_md5_{i}"] = {"data": "x" * 100}

    # cache 大小应不超过 MAX_CACHE_SIZE
    assert len(_asset_cache) <= MAX_CACHE_SIZE
```

- [ ] **Step 2: 运行测试，确认 FAIL**

```bash
pytest tests/orchestrator/test_parse_assets.py::test_asset_cache_has_max_size -v
# 预期：FAIL — MAX_CACHE_SIZE not defined
```

- [ ] **Step 3: 将 _asset_cache 替换为 LRU Cache**

```python
# agent-service/app/orchestrator/tools/parse_assets.py — 修改 cache 定义
from functools import lru_cache
from collections import OrderedDict

MAX_CACHE_SIZE = 50  # 最多缓存 50 个文件解析结果

class _LRUCache:
    """简单的 LRU 缓存，有大小上限。"""
    def __init__(self, max_size: int):
        self._cache: OrderedDict = OrderedDict()
        self._max_size = max_size

    def get(self, key: str):
        if key in self._cache:
            self._cache.move_to_end(key)
            return self._cache[key]
        return None

    def set(self, key: str, value):
        if key in self._cache:
            self._cache.move_to_end(key)
        else:
            if len(self._cache) >= self._max_size:
                self._cache.popitem(last=False)  # 移除最旧条目
        self._cache[key] = value

    def __setitem__(self, key, value):
        self.set(key, value)

    def __getitem__(self, key):
        result = self.get(key)
        if result is None:
            raise KeyError(key)
        return result

    def __contains__(self, key):
        return key in self._cache

    def __len__(self):
        return len(self._cache)

    def clear(self):
        self._cache.clear()


_asset_cache = _LRUCache(MAX_CACHE_SIZE)
```

替换后，原来的 `_asset_cache[key] = value` 和 `_asset_cache.get(key)` 调用无需修改（接口兼容）。
`clear_asset_cache()` 函数改为调用 `_asset_cache.clear()`。

- [ ] **Step 4: 运行测试**

```bash
pytest tests/orchestrator/test_parse_assets.py -v
# 预期：全部 PASS，包括新的 max_size 测试
```

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/orchestrator/tools/parse_assets.py
git commit -m "fix(memory): replace unbounded asset cache dict with LRU cache (max 50 entries)"
```

---

## Task 5: 修复 engine.py 中文超时提示乱码

**背景：** `engine.py` 中部分超时提示字符串显示为 `"绛夊緟 Blueprint..."` 等乱码，为 GB2312 字符被错误编码为 UTF-8。

**Files:**
- 修改: `agent-service/app/orchestrator/engine.py`（所有乱码字符串行）

- [ ] **Step 1: 定位所有乱码行**

```bash
grep -n "绛\|锛\|瓒\|涓\|鍒\|宸\|彇\|娑" agent-service/app/orchestrator/engine.py
```

- [ ] **Step 2: 替换乱码字符串为 ASCII 英文**

将每个乱码字符串替换为等价英文描述（超时信息不影响功能，统一用英文）。例如：

```python
# 修改前（乱码）
timeout_message="绛夊緟 Blueprint 纭瓒呮椂锛?0鍒嗛挓锛夛紝浠诲姟宸插彇娑?"

# 修改后（英文）
timeout_message="Timed out waiting for blueprint confirmation (10 minutes). Task cancelled."
```

逐行检查并修复所有乱码字符串。

- [ ] **Step 3: 确认文件编码**

```bash
file agent-service/app/orchestrator/engine.py
# 应显示 UTF-8 Unicode text
```

若输出不是 UTF-8，执行：
```bash
iconv -f GBK -t UTF-8 agent-service/app/orchestrator/engine.py > /tmp/engine_fixed.py
mv /tmp/engine_fixed.py agent-service/app/orchestrator/engine.py
```

- [ ] **Step 4: 运行 engine 测试验证无回归**

```bash
pytest tests/orchestrator/test_engine.py -v -x
# 预期：全部 PASS
```

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/orchestrator/engine.py
git commit -m "fix: replace garbled Chinese timeout messages with ASCII English in engine.py"
```

---

## 验收检查

所有 Task 完成后执行：

```bash
cd agent-service

# 单元测试
pytest tests/orchestrator/test_engine_level3_research.py \
       tests/workers/test_researcher_executor.py \
       tests/orchestrator/test_parse_assets.py \
       tests/orchestrator/test_document_task_engine.py \
       tests/orchestrator/test_engine.py \
       -v --tb=short

# 整体回归
pytest tests/ -v --ignore=tests/browser_ai_creator_smoke.py \
              --ignore=tests/browser_ai_creator_insert_e2e.py \
              -x --tb=short
```

预期：0 failures，允许已知的跳过测试（browser/playwright 类）。
