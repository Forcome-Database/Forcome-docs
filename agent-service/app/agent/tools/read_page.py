"""工具：读取 Docmost 页面内容。"""
from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.agent.deps import AgentDeps

from pydantic_ai import RunContext


async def read_page_impl(page_id: str) -> str:
    """可测试的核心逻辑。"""
    try:
        from app.tools.docmost_api import docmost_page_read

        # docmost_page_read 是 sync 函数（被 @tool 装饰），使用 .func 获取原始函数
        fn = docmost_page_read.func if hasattr(docmost_page_read, "func") else docmost_page_read
        result = await asyncio.wait_for(
            asyncio.to_thread(fn, page_id), timeout=10
        )
        content = str(result)
        if len(content) > 8000:
            content = content[:8000] + f"\n\n[Truncated — original {len(content)} characters]"
        return f"[Page: {page_id}]\n{content}"
    except asyncio.TimeoutError:
        return f"[Error] Reading page {page_id} timed out."
    except Exception as e:
        return f"[Error] Failed to read page: {type(e).__name__}: {e}"


async def read_page_tool(ctx: RunContext["AgentDeps"], page_id: str = "") -> str:
    """Read the content of a Docmost page.

    Call this when you need to reference or incorporate content from an existing page.
    If page_id is empty, reads the current page the user is editing.

    Args:
        page_id: The UUID of the page to read. Leave empty for the current page.
    """
    pid = page_id or ctx.deps.page_id
    if not pid:
        return "[Error] No page ID available. The user has not specified a page."
    return await read_page_impl(pid)
