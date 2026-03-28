"""Skill router — selects which agent skill to use for a given request.

Signals (in priority order):
1. has_selection — user selected text or placed cursor → editing (even on first turn)
2. has_message_history — follow-up turn → editing
3. has_files — new file upload → creation (overrides history)
"""


def select_skill(
    *,
    has_message_history: bool,
    has_files: bool,
    has_selection: bool = False,
) -> str:
    """Select which skill to use.

    Returns "creation" or "editing".

    Rules:
    - Selection editing (has_selection=True) without new files → "editing"
    - Follow-up turn (has_message_history=True) without new files → "editing"
    - Everything else → "creation"
    """
    if has_selection and not has_files:
        return "editing"
    if has_message_history and not has_files:
        return "editing"
    return "creation"
