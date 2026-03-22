"""Simple edit tool for Level 1 orchestrator tasks.

Handles direct, short-form editing operations (translate, fix, simplify, etc.)
using a single PydanticAI Agent call with streaming. Suitable for:
    - Translation
    - Spelling / grammar correction
    - Tone adjustment
    - Proofreading
    - Shortening / lengthening
    - Simplification
"""
from __future__ import annotations

from pydantic import BaseModel

from app.agent.events import emit
from app.orchestrator.llm_factory import create_pydantic_ai_model


class SimpleEditRequest(BaseModel):
    """Input model for a simple Level-1 edit operation."""

    thread_id: str
    user_message: str
    page_content: str = ""
    selected_text: str = ""
    system_prompt: str = ""
    template_prompt: str = ""
    conversation_history: list[dict] = []
    intent_route: str = "document_create"
    asset_context: str = ""
    selection_snapshot: str = ""
    local_context: str = ""
    action: str = ""
    task_summary_ref: dict | None = None


def build_simple_edit_prompt(request: SimpleEditRequest) -> str:
    """Build a complete prompt for a simple edit request.

    Constructs a structured prompt combining the system/template prompts,
    context (full page or selected text), and the user's instruction.

    Args:
        request: The SimpleEditRequest containing all required fields.

    Returns:
        A formatted prompt string ready to send to the LLM.
    """
    parts: list[str] = []

    # System / template prompts (if any)
    if request.system_prompt:
        parts.append(f"[System Instructions]\n{request.system_prompt.strip()}")

    if request.template_prompt:
        parts.append(f"[Template Instructions]\n{request.template_prompt.strip()}")

    if request.action:
        parts.append(f"[Inline Rewrite Action]\n{request.action.strip()}")

    if request.selection_snapshot:
        parts.append(
            f"[Selection Snapshot]\n{request.selection_snapshot.strip()}"
        )

    if request.local_context:
        parts.append(f"[Local Context]\n{request.local_context.strip()}")

    if request.task_summary_ref:
        summary = str(request.task_summary_ref.get("summary", "")).strip()
        include_raw_history = bool(
            request.task_summary_ref.get("include_raw_history", False)
        )
        if summary:
            parts.append(f"[Structured Task Summary]\n{summary}")
        if not include_raw_history:
            parts.append(
                "[Task Summary Rules]\nUse the structured summary only; do not inherit raw document-task history."
            )

    # Context: prefer selected text over full page content
    if request.selected_text:
        parts.append(
            f"[Selected Text to Edit]\n{request.selected_text.strip()}"
        )
    elif request.page_content:
        parts.append(
            f"[Document Content]\n{request.page_content.strip()}"
        )

    # Source document content (from asset_map, for L2 path)
    if request.asset_context:
        parts.append(f"[Source Document Content]\n{request.asset_context.strip()}")

    # Source preservation mode for document_transform
    if request.intent_route == "document_transform":
        parts.append(
            "[IMPORTANT: Source Preservation Mode]\n"
            "This is a document transform task. The source material is your PRIMARY reference.\n"
            "- Preserve ALL factual content, technical details, commands, and links from the source\n"
            "- Only restructure/reformat, do NOT rewrite or omit content\n"
            "- Output length should be at least 70% of the source content"
        )

    # The actual user instruction
    parts.append(f"[User Request]\n{request.user_message.strip()}")

    # Writing style rules
    parts.append(
        "[Writing Style]\n"
        "- Default to Chinese output unless the user explicitly requests another language.\n"
        "- NEVER use: '首先/其次/最后', '综上所述', '值得注意的是', '总而言之', '让我们'.\n"
        "- Vary paragraph length and sentence patterns; avoid formulaic structures.\n"
        "- Replace abstract descriptions with specific data, examples, and operational details.\n"
        "- Write like an experienced professional — NOT like an AI listing bullet points.\n"
        "- Avoid buzzwords: '赋能', '抓手', '落地', '闭环', '链路', '沉淀', '对齐'."
    )

    # Final instruction
    parts.append(
        "Please perform the requested edit. Return only the edited content "
        "without explanations or meta-commentary."
    )

    return "\n\n".join(parts)


async def execute_simple_edit(request: SimpleEditRequest) -> str:
    """Execute a Level 1 simple edit using a PydanticAI Agent with streaming.

    Emits SSE events to the thread's event queue as content chunks arrive.
    Returns the complete generated content.

    Args:
        request: The SimpleEditRequest with user input and context.

    Returns:
        The full edited text as a string.

    Raises:
        Exception: Propagates any LLM or network errors.
    """
    from pydantic_ai import Agent

    model = create_pydantic_ai_model()
    agent: Agent[None, str] = Agent(model=model, output_type=str)

    prompt = build_simple_edit_prompt(request)

    # Build conversation history as system messages if present
    message_history = []
    for turn in request.conversation_history:
        role = turn.get("role", "user")
        content = turn.get("content", "")
        if role and content:
            message_history.append({"role": role, "content": content})

    # Emit step start event
    await emit(
        request.thread_id,
        {
            "type": "step_start",
            "step": "simple_edit",
            "description": "Performing direct edit…",
        },
    )

    full_content = ""

    async with agent.run_stream(prompt) as result:
        async for chunk in result.stream_text(delta=True):
            full_content += chunk
            await emit(
                request.thread_id,
                {"type": "content", "chunk": chunk},
            )

    await emit(
        request.thread_id,
        {
            "type": "step_done",
            "step": "simple_edit",
            "result_summary": f"Edit complete ({len(full_content.split())} words)",
        },
    )

    return full_content
