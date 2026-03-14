"""Finalize tool — content merging and SSE completion signalling.

Handles the last step of the orchestrator pipeline:
1. Merging one or more section drafts into a single markdown document.
2. Computing the final word count.
3. Emitting a ``done`` SSE event with the merged content.
"""
from __future__ import annotations

from app.agent.events import emit
from app.utils.text import count_words


def merge_sections(sections: list[str]) -> str:
    """Merge a list of content sections into a single markdown document.

    Each non-empty section is separated from the next by a blank line.
    Plain-text sections are included as-is.  If a section already starts with
    a markdown heading it is preserved unchanged; otherwise no heading is
    added automatically.

    Args:
        sections: Ordered list of markdown/plaintext string sections.

    Returns:
        A single string with sections joined by double newlines.
        Returns an empty string if all sections are empty/whitespace.
    """
    non_empty = [s.strip() for s in sections if s and s.strip()]
    return "\n\n".join(non_empty)


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
    sections: list[str],
    insert_mode: str = "create",
) -> str:
    """Merge sections, compute stats, and emit the final ``done`` SSE event.

    Args:
        thread_id: SSE queue key to emit events to.
        sections: Ordered list of content sections to merge.
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
