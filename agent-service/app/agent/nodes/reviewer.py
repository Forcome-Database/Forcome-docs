"""Reviewer node: single-pass quality check with auto-fix.

No revision loop — fixes minor issues inline and delivers.
User-driven revisions happen through the chat interface.
"""
import re
from app.agent.state import AgentState
from app.agent.events import emit


def _auto_fix(draft: str) -> str:
    """Fix common minor issues in the generated content."""
    # Fix empty image references: ![alt]() → > *alt*
    draft = re.sub(r'!\[([^\]]*)\]\(\s*\)', r'> *\1*', draft)
    # Fix placeholder image URLs
    draft = re.sub(r'!\[([^\]]*)\]\(IMAGE_PLACEHOLDER[^)]*\)', r'> *\1*', draft)
    # Fix invalid image URLs (not http/https or /api/)
    draft = re.sub(r'!\[([^\]]*)\]\((?!https?://|/api/)[^)]*\)', r'> *\1*', draft)
    # Fix dangling image syntax: ![alt] without (url)
    draft = re.sub(r'!\[([^\]]*)\](?!\()', r'> *\1*', draft)
    # Remove trailing whitespace on lines
    draft = re.sub(r'[ \t]+$', '', draft, flags=re.MULTILINE)
    return draft


async def reviewer_node(state: AgentState) -> dict:
    """Single-pass quality check: auto-fix minor issues and deliver."""
    tid = state.get("_thread_id", "")

    await emit(tid, {"type": "step_start", "step": "review", "description": "正在检查内容质量..."})

    draft = state.get("draft_content", "")
    fixed = _auto_fix(draft)

    fixes_applied = fixed != draft
    summary = "质量检查通过" + ("，已自动修复格式问题" if fixes_applied else "")

    await emit(tid, {"type": "step_done", "step": "review", "result_summary": summary})

    return {
        "final_content": fixed,
        "needs_revision": False,
    }
