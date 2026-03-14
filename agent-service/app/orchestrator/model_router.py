"""Model router — assigns different LLM models to different roles.

Configuration via environment variables:
  ORCHESTRATOR_MODEL=claude-sonnet-4-20250514
  WRITER_MODEL=gpt-4o-mini
  EVALUATOR_MODEL=gemini-2.0-flash

If not set, all roles use the default model from settings.llm_model.
"""
from __future__ import annotations
from enum import StrEnum
from typing import Union
from pydantic_ai.models import Model
from app.config import settings
from app.orchestrator.llm_factory import create_pydantic_ai_model


class ModelRole(StrEnum):
    ORCHESTRATOR = "orchestrator"
    WRITER = "writer"
    EVALUATOR = "evaluator"
    FIXER = "fixer"
    BRIEF = "brief"
    BLUEPRINT = "blueprint"


def _get_role_model_name(role: ModelRole) -> str | None:
    """Get model name override for a role from environment/settings."""
    env_key = f"{role}_model"
    # Check settings for role-specific model
    return getattr(settings, env_key, None) or None


def get_model_for_role(role: ModelRole) -> Union[str, Model]:
    """Get the appropriate PydanticAI model for a given role.

    Falls back to the default model if no role-specific model is configured.
    """
    model_name = _get_role_model_name(role)
    if model_name:
        return create_pydantic_ai_model(model_name=model_name)
    return create_pydantic_ai_model()
