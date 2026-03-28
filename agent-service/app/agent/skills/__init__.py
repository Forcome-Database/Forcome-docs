"""Agent skills package — shared format rules, creation skill, and editing skill.

Re-exports:
- TIPTAP_FORMAT_RULES: shared syntax constraints and content quality rules
- CREATION_SKILL: full document creation skill (thinking framework + tools + shared rules)
- EDITING_SKILL: concise document editing skill (edit framework + shared rules)
"""

from app.agent.skills.shared import TIPTAP_FORMAT_RULES
from app.agent.skills.creation import CREATION_SKILL
from app.agent.skills.editing import EDITING_SKILL

__all__ = ["TIPTAP_FORMAT_RULES", "CREATION_SKILL", "EDITING_SKILL"]
