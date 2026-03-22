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
from app.models.asset_map import AssetMap
from app.models.document_tree import DocumentTree
from app.utils.markdown_images import resolve_asset_image_placeholders
from app.utils.text import count_words

ASSET_MARKER_RE = re.compile(r"\s*<!--asset:[a-zA-Z0-9_-]+-->\s*")
LEADING_HEADING_RE = re.compile(
    r"^(?:\s*<!--asset:[a-zA-Z0-9_-]+-->\s*)*\s*(#{1,6})\s+([^\n]+?)\s*(?:\n+|$)",
    re.IGNORECASE,
)
SECTION_LIKE_OPENING_RE = re.compile(
    r"^\s*(?:"
    r"[一二三四五六七八九十百千]+[、.]|"
    r"\d+[、.]|"
    r"第[一二三四五六七八九十百千\d]+[章节部分步项]|"
    r"#{2,6}\s+"
    r")"
)
SECTION_HEADING_TITLE_RE = re.compile(
    r"^\s*(?:"
    r"[一二三四五六七八九十百千]+[、.]|"
    r"\d+[、.]|"
    r"第[一二三四五六七八九十百千\d]+[章节部分步项]"
    r")"
)


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
    if sections and all(isinstance(section, dict) for section in sections):
        sections = _normalize_document_title_sections(
            [dict(section) for section in sections if isinstance(section, dict)]
        )

    parts: list[str] = []

    for section in sections:
        if isinstance(section, dict):
            title = section.get("title", "")
            content = _strip_redundant_leading_heading(section.get("content", ""), title)
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


def _normalize_document_title_sections(sections: list[dict]) -> list[dict]:
    if len(sections) < 2:
        return sections

    root = sections[0]
    first_section = sections[1]
    if (root.get("title") or "").strip():
        return sections
    if int(root.get("level", 1) or 1) != 1:
        return sections

    candidate_title = str(first_section.get("title", "") or "").strip()
    candidate_content = str(first_section.get("content", "") or "").strip()
    if not candidate_title or not candidate_content:
        return sections
    if SECTION_HEADING_TITLE_RE.match(candidate_title):
        return sections
    if not SECTION_LIKE_OPENING_RE.match(candidate_content):
        return sections

    root["title"] = candidate_title
    first_section["title"] = ""
    sections[0] = root
    sections[1] = first_section
    return sections


def resolve_final_image_placeholders(
    content: str,
    asset_map: AssetMap | None = None,
) -> str:
    if not content or not asset_map:
        return content

    return resolve_asset_image_placeholders(
        content,
        {
            item.id: item.content
            for item in asset_map.items
            if item.type == "image" and item.content
        },
    )


def _strip_redundant_leading_heading(content: str, title: str) -> str:
    normalized_content = (content or "").strip()
    normalized_title = (title or "").strip().casefold()
    if not normalized_content or not normalized_title:
        return normalized_content

    match = LEADING_HEADING_RE.match(normalized_content)
    if not match:
        return normalized_content

    heading_title = match.group(2).strip().casefold()
    if heading_title != normalized_title:
        return normalized_content

    return normalized_content[match.end() :].lstrip()


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
    asset_map: AssetMap | None = None,
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
    merged = resolve_final_image_placeholders(merge_sections(sections), asset_map)
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
