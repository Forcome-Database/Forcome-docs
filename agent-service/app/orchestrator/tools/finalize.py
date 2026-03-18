"""Finalize tool — content merging and SSE completion signalling.

Handles the last step of the orchestrator pipeline:
1. Merging one or more section drafts into a single markdown document.
2. Computing the final word count.
3. Emitting a ``done`` SSE event with the merged content.
"""
from __future__ import annotations

import re
from typing import Union

from app.agent.events import emit
from app.models.document_tree import DocumentTree
from app.utils.text import count_words

ASSET_MARKER_RE = re.compile(r"\s*<!--asset:[a-zA-Z0-9_-]+-->\s*")


def document_tree_to_sections(document_tree: DocumentTree) -> list[dict]:
    sections: list[dict] = [
        {
            "title": document_tree.root.title,
            "level": document_tree.root.level,
            "content": document_tree.root.content,
        }
    ]
    sections.extend(
        {
            "title": node.title,
            "level": node.level,
            "content": node.content,
        }
        for node in document_tree.sections
    )
    return sections


def merge_sections(sections: list[Union[str, dict]]) -> str:
    """Merge a list of content sections into a single markdown document.

    Supports two input formats:
    - ``list[str]``: plain content strings (L1/L2 path).
    - ``list[dict]``: dicts with ``title``, ``level`` (optional, default 2),
      and ``content`` keys (L3 path). Headings are prepended automatically.

    Args:
        sections: Ordered list of string or dict sections.

    Returns:
        A single markdown string with sections joined by double newlines.
        Returns an empty string if all sections are empty/whitespace.
    """
    parts: list[str] = []

    for section in sections:
        if isinstance(section, dict):
            title = section.get("title", "")
            content = section.get("content", "")
            level = section.get("level", 2)
            heading = f"{'#' * level} {title}" if title else ""
            # Allow heading-only sections (e.g. document title as H1)
            if not content or not content.strip():
                if heading:
                    parts.append(heading)
                continue
            if heading:
                parts.append(f"{heading}\n\n{content.strip()}")
            else:
                parts.append(content.strip())
        else:
            if section and section.strip():
                parts.append(section.strip())

    merged = "\n\n".join(parts)
    return ASSET_MARKER_RE.sub("\n", merged).strip()


def compute_word_count(content: str) -> int:
    """Compute the word count of the final merged content.

    Delegates to :func:`app.utils.text.count_words` which handles both
    Chinese character counting and English word splitting.

    Args:
        content: The final merged markdown or plain-text document.

    Returns:
        Total word count as an integer.
    """
    return count_words(content)


async def finalize_and_emit(
    *,
    thread_id: str,
    sections: list[Union[str, dict]],
    insert_mode: str = "create",
) -> str:
    """Merge sections, compute stats, and emit the final ``done`` SSE event.

    Args:
        thread_id: SSE queue key to emit events to.
        sections: Ordered list of content sections to merge.
            Can be plain strings or dicts with title/level/content.
        insert_mode: Editor insert mode ("create", "replace", "append").
            Passed through to the ``done`` event so the frontend knows
            how to handle the content.

    Returns:
        The merged final content string.
    """
    merged = merge_sections(sections)
    word_count = compute_word_count(merged)

    await emit(
        thread_id,
        {
            "type": "step_done",
            "step": "finalize",
            "result_summary": f"Document finalized ({word_count} words)",
        },
    )

    await emit(
        thread_id,
        {
            "type": "done",
            "final_content": merged,
            "insert_mode": insert_mode,
        },
    )

    return merged
