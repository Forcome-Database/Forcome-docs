"""DEPRECATED: Use app.agent.skills.creation / .editing instead.

This file is kept for backward compatibility with tests that import TIPTAP_CREATION_SKILL.
The original monolithic skill has been split into:
  - skills/shared.py   — TipTap format rules
  - skills/creation.py — Document creation skill (thinking framework + tools)
  - skills/editing.py  — Document editing skill (preservation-focused)
"""
from app.agent.skills.creation import CREATION_SKILL

TIPTAP_CREATION_SKILL = CREATION_SKILL  # Backward compat alias
