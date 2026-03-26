# AI 内容摄入管道重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 去掉 Docling，MinerU 升为默认文档解析器；优化 Firecrawl 参数消除网页脏数据；新增 Trafilatura 二次清洗；图片去重；MinerU 断路器；asset_cache 内存泄漏修复。

**Architecture:** 文档解析路径简化为 MinerU-only（断路器保护）；网页爬取改为 Firecrawl(exclude_tags+only_main_content) → Trafilatura(rawHtml, favor_precision) 双层清洗；图片合并时 MD5+pHash 去重。

**Tech Stack:** Python 3.12 + FastAPI + httpx + trafilatura + imagehash + pybreaker + cachetools

**Spec:** `docs/superpowers/specs/2026-03-26-ai-writing-comprehensive-improvement-design.md` Section 2

---

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|------|---------|------|
| 删除 | `agent-service/app/tools/docling_parser.py` | 移除 Docling 解析器 |
| 修改 | `agent-service/app/workers/asset_parser.py:43-67,213-221` | 移除 Docling 引用 |
| 修改 | `agent-service/app/config.py:38` | `mineru_enabled` 默认改为 True |
| 修改 | `agent-service/app/tools/firecrawl_scrape.py` | 添加 exclude_tags + rawHtml |
| 新增 | `agent-service/app/tools/trafilatura_extract.py` | Trafilatura 异步提取工具 |
| 修改 | `agent-service/app/orchestrator/tools/parse_assets.py:22,188-198` | TTLCache + 图片去重 |
| 修改 | `agent-service/pyproject.toml:11-12` | 移除 docling，新增 trafilatura/imagehash/pybreaker/cachetools |

---

## Task 1: 移除 Docling 依赖和代码

**背景：** 用户要求去掉 Docling，MinerU 全面接管文档解析。

**Files:**
- 删除: `agent-service/app/tools/docling_parser.py`
- 修改: `agent-service/app/workers/asset_parser.py:43-67,213-221`
- 修改: `agent-service/pyproject.toml:11`

- [ ] **Step 1: 确认 Docling 引用范围**

```bash
cd agent-service && grep -rn "docling\|_parse_with_docling\|_get_docling_parser\|_docling_parser_invoke" app/ --include="*.py"
```

- [ ] **Step 2: 删除 docling_parser.py**

```bash
rm agent-service/app/tools/docling_parser.py
```

- [ ] **Step 3: 修改 asset_parser.py — 移除 Docling 相关代码**

在 `asset_parser.py` 中：
1. 删除第 43-45 行 `_get_docling_parser()` 函数
2. 删除第 64-67 行 `_docling_parser_invoke()` 函数
3. 删除第 213-221 行 `_parse_with_docling()` 函数
4. 搜索并删除所有其他 `docling` 引用

- [ ] **Step 4: 修改 pyproject.toml — 移除 docling 依赖**

在 `pyproject.toml` 第 11 行，删除 `"docling>=2.0"` 行。

- [ ] **Step 5: 确认无残留引用**

```bash
grep -rn "docling" agent-service/ --include="*.py" --include="*.toml"
# 预期：只有注释或完全无结果
```

- [ ] **Step 6: 验证 Python 可导入**

```bash
cd agent-service && python -c "from app.workers.asset_parser import parse_document; print('ok')"
```

- [ ] **Step 7: Commit**

```bash
git add -A agent-service/
git commit -m "refactor: remove Docling dependency, MinerU is now the sole document parser"
```

---

## Task 2: MinerU 升为默认 + 降低超时

**Files:**
- 修改: `agent-service/app/config.py:38,42`

- [ ] **Step 1: 修改 config.py**

第 38 行 `mineru_enabled: bool = False` → `mineru_enabled: bool = True`

第 42 行 `mineru_poll_timeout_seconds: float = 300.0` → `mineru_poll_timeout_seconds: float = 120.0`

- [ ] **Step 2: Commit**

```bash
git add agent-service/app/config.py
git commit -m "feat: enable MinerU by default and reduce poll timeout to 120s"
```

---

## Task 3: 添加新依赖

**Files:**
- 修改: `agent-service/pyproject.toml`

- [ ] **Step 1: 在 pyproject.toml 的 dependencies 中添加**

```toml
"trafilatura>=2.0.0",
"imagehash>=4.3",
"pybreaker>=1.0",
"cachetools>=5.0",
```

- [ ] **Step 2: 安装依赖**

```bash
cd agent-service && pip install -e ".[dev]"
```

- [ ] **Step 3: Commit**

```bash
git add agent-service/pyproject.toml
git commit -m "deps: add trafilatura, imagehash, pybreaker, cachetools"
```

---

## Task 4: Firecrawl 参数优化

**背景：** 当前 `client.scrape(url, formats=["markdown"])` 无清洗参数，导航栏/Logo 等全部进入输出。

**Files:**
- 修改: `agent-service/app/tools/firecrawl_scrape.py`

- [ ] **Step 1: 重写 firecrawl_scrape.py**

```python
# agent-service/app/tools/firecrawl_scrape.py — 完整替换
from firecrawl import FirecrawlApp
from langchain_core.tools import tool

from app.config import settings
from app.tools.registry import register_tool


@register_tool
@tool
def firecrawl_scrape(url: str) -> str:
    """Scrape a web page and return clean main-content Markdown."""
    if not url or not url.startswith(("http://", "https://")):
        return f"Invalid URL: {url[:100]}"

    client = FirecrawlApp(
        api_key=settings.firecrawl_api_key,
        api_url=settings.firecrawl_api_url,
    )

    result = client.scrape(
        url,
        formats=["markdown", "rawHtml"],
        only_main_content=True,
        exclude_tags=[
            "nav", "header", "footer", "aside",
            ".sidebar", ".navbar", ".navigation", ".menu",
            ".nav-bar", ".top-bar", ".header-wrapper",
            ".advertisement", ".ad", ".ads", ".banner",
            ".cookie-banner", ".cookie-consent", ".popup",
            ".modal", "#cookie-notice",
            ".social-share", ".share-buttons",
            "#comments", ".comments-section",
            ".breadcrumb", ".breadcrumbs",
        ],
        wait_for=1000,
        remove_base64_images=True,
        block_ads=True,
        timeout=30000,
    )

    fc_md = getattr(result, "markdown", None) or (
        result.get("markdown") if isinstance(result, dict) else None
    )
    raw_html = getattr(result, "rawHtml", None) or (
        result.get("rawHtml") if isinstance(result, dict) else None
    )

    # Trafilatura secondary cleaning if rawHtml available
    if raw_html:
        from app.tools.trafilatura_extract import trafilatura_extract_sync
        traf_md = trafilatura_extract_sync(raw_html, url)
        if traf_md:
            return _select_best(fc_md, traf_md)

    return fc_md or "Failed to extract page content."


def _select_best(fc_md: str | None, traf_md: str) -> str:
    """Quality heuristic: pick the cleaner result."""
    if not fc_md:
        return traf_md
    # Detect navigation noise in Firecrawl output
    fc_lines = fc_md.split("\n")
    short_lines = sum(1 for l in fc_lines if 0 < len(l.strip()) < 5)
    noise_ratio = short_lines / max(len(fc_lines), 1)
    if noise_ratio > 0.3:
        return traf_md
    # Check if Trafilatura over-trimmed
    if len(traf_md) < len(fc_md) * 0.3:
        return fc_md
    return traf_md  # Default: prefer Trafilatura (higher precision)
```

- [ ] **Step 2: 验证导入正确**

```bash
cd agent-service && python -c "from app.tools.firecrawl_scrape import firecrawl_scrape; print('ok')"
```

- [ ] **Step 3: Commit**

```bash
git add agent-service/app/tools/firecrawl_scrape.py
git commit -m "feat: optimize Firecrawl params with exclude_tags and Trafilatura fallback"
```

---

## Task 5: Trafilatura 提取工具

**Files:**
- 新增: `agent-service/app/tools/trafilatura_extract.py`

- [ ] **Step 1: 创建 trafilatura_extract.py**

```python
# agent-service/app/tools/trafilatura_extract.py
"""Trafilatura-based web content extraction for secondary cleaning."""
import asyncio
import logging

import trafilatura

logger = logging.getLogger(__name__)


def trafilatura_extract_sync(html: str, url: str | None = None) -> str | None:
    """Synchronous Trafilatura extraction. Call from sync context or via executor."""
    if not html or len(html) < 50:
        return None
    try:
        result = trafilatura.extract(
            html,
            output_format="markdown",
            favor_precision=True,
            include_images=True,
            include_tables=True,
            include_links=True,
            include_formatting=True,
            include_comments=False,
            url=url,
        )
        if result and len(result.strip()) > 50:
            return result
        return None
    except Exception as e:
        logger.warning("Trafilatura extraction failed for %s: %s", url, e)
        return None


async def trafilatura_extract_async(html: str, url: str | None = None) -> str | None:
    """Async wrapper — runs Trafilatura in a thread pool to avoid blocking event loop."""
    return await asyncio.to_thread(trafilatura_extract_sync, html, url)
```

- [ ] **Step 2: 验证**

```bash
cd agent-service && python -c "from app.tools.trafilatura_extract import trafilatura_extract_sync; print('ok')"
```

- [ ] **Step 3: Commit**

```bash
git add agent-service/app/tools/trafilatura_extract.py
git commit -m "feat: add Trafilatura extraction tool for web content secondary cleaning"
```

---

## Task 6: 图片去重（合并阶段）

**背景：** `parse_assets_tool()` 合并多文件 AssetMap 时仅做列表拼接，相同图片重复保留。

**Files:**
- 修改: `agent-service/app/orchestrator/tools/parse_assets.py:188-198`

- [ ] **Step 1: 在 parse_assets.py 中添加去重函数**

在文件顶部导入区域添加：
```python
import hashlib
```

在 `parse_assets_tool` 函数前添加去重函数：

```python
def _deduplicate_image_items(
    items: list,
) -> tuple[list, dict[str, str]]:
    """Deduplicate image AssetItems by content_hash. Returns (deduped_items, redirect_map)."""
    seen_hashes: dict[str, str] = {}  # content_hash → keeper item id
    redirect_map: dict[str, str] = {}  # removed id → keeper id
    result = []
    for item in items:
        if item.type == "image" and getattr(item, "content_hash", None):
            if item.content_hash in seen_hashes:
                redirect_map[item.id] = seen_hashes[item.content_hash]
                continue
            seen_hashes[item.content_hash] = item.id
        result.append(item)
    return result, redirect_map
```

- [ ] **Step 2: 在合并逻辑中调用去重**

找到合并逻辑（约第 188-198 行）`combined.items.extend(asset_map.items)` 之后，在返回 `combined` 之前添加：

```python
# Deduplicate images across all documents
combined.items, redirect_map = _deduplicate_image_items(combined.items)

# Rewrite image references in text items to point to kept images
if redirect_map:
    for item in combined.items:
        if item.type == "text" and item.content:
            for old_id, new_id in redirect_map.items():
                item.content = item.content.replace(old_id, new_id)
```

- [ ] **Step 3: 验证导入正确**

```bash
cd agent-service && python -c "from app.orchestrator.tools.parse_assets import parse_assets_tool; print('ok')"
```

- [ ] **Step 4: Commit**

```bash
git add agent-service/app/orchestrator/tools/parse_assets.py
git commit -m "feat: deduplicate images by content_hash during multi-document merge"
```

---

## Task 7: MinerU 断路器 + asset_cache TTLCache

**Files:**
- 修改: `agent-service/app/workers/asset_parser.py` (断路器)
- 修改: `agent-service/app/orchestrator/tools/parse_assets.py:22` (TTLCache)

- [ ] **Step 1: 在 asset_parser.py 中添加断路器**

在文件顶部添加导入：
```python
import pybreaker
```

在 `parse_document` 函数之前添加断路器实例：
```python
_mineru_breaker = pybreaker.CircuitBreaker(
    fail_max=3,
    reset_timeout=300,  # 5 minutes
    name="mineru_circuit_breaker",
)
```

在 `parse_document` 函数中，将 `_parse_with_mineru()` 调用包裹在断路器中：

```python
# 原来：
# result = await _parse_with_mineru(...)
# 改为：
try:
    result = _mineru_breaker.call(
        lambda: asyncio.get_event_loop().run_until_complete(
            _parse_with_mineru(file_content_b64, filename, mimetype)
        )
    )
except pybreaker.CircuitBreakerError:
    raise ValueError(
        "Document parsing service is temporarily unavailable (circuit breaker open). "
        "Please try again later."
    )
```

注意：如果 `parse_document` 本身是 async，需要用 `await` + executor 包装断路器调用。具体看实际代码决定。

- [ ] **Step 2: 在 parse_assets.py 中将 _asset_cache 改为 TTLCache**

第 22 行，将：
```python
_asset_cache: dict[str, AssetMap] = {}
```
改为：
```python
from cachetools import TTLCache

_asset_cache: TTLCache = TTLCache(maxsize=20, ttl=3600)  # max 20 entries, 1h TTL
```

同时检查 `clear_asset_cache()` 函数（如存在），确保调用 `_asset_cache.clear()`。

- [ ] **Step 3: 验证**

```bash
cd agent-service && python -c "
from cachetools import TTLCache
from app.orchestrator.tools.parse_assets import _asset_cache
assert isinstance(_asset_cache, TTLCache)
print(f'cache maxsize={_asset_cache.maxsize}, ttl={_asset_cache.ttl}')
"
```

- [ ] **Step 4: Commit**

```bash
git add agent-service/app/workers/asset_parser.py agent-service/app/orchestrator/tools/parse_assets.py
git commit -m "feat: add MinerU circuit breaker and replace unbounded asset_cache with TTLCache"
```

---

## 验收检查

```bash
cd agent-service

# 确认 Docling 已完全移除
grep -rn "docling" app/ --include="*.py" && echo "FAIL: docling references remain" || echo "OK: docling removed"

# 确认 MinerU 默认启用
python -c "from app.config import settings; assert settings.mineru_enabled == True; print('OK: MinerU enabled')"

# 确认新依赖可导入
python -c "import trafilatura; import imagehash; import pybreaker; import cachetools; print('OK: all deps available')"

# 确认 Trafilatura 工具可导入
python -c "from app.tools.trafilatura_extract import trafilatura_extract_sync; print('OK: trafilatura tool')"

# 确认 asset_cache 是 TTLCache
python -c "from app.orchestrator.tools.parse_assets import _asset_cache; from cachetools import TTLCache; assert isinstance(_asset_cache, TTLCache); print('OK: TTLCache')"

# 确认 firecrawl 工具可导入
python -c "from app.tools.firecrawl_scrape import firecrawl_scrape; print('OK: firecrawl tool')"
```
