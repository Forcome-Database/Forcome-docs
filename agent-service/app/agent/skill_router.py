"""Skill router — selects which agent skill to use for a given request.

Primary signal: has_message_history (is this a follow-up turn?)
Secondary signal: has_files (did user upload new documents?)
Conservative routing: editing only when clearly a follow-up without new files.
"""


def select_skill(*, has_message_history: bool, has_files: bool) -> str:
    """Select which skill to use.

    Returns "creation" or "editing".

    Rules:
    - Follow-up turn (has_message_history=True) with no new files → "editing"
    - Everything else (first turn, or new files uploaded) → "creation"
    """
    if has_message_history and not has_files:
        return "editing"
    return "creation"
