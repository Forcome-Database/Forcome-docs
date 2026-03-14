"""Tests for the model router."""
from __future__ import annotations
from unittest.mock import MagicMock, patch

import pytest


def _make_settings(
    provider: str = "openai",
    model: str = "gpt-4o",
    api_key: str = "sk-test",
    api_url: str = "https://api.openai.com/v1",
    **role_models: str,
) -> MagicMock:
    s = MagicMock()
    s.llm_provider = provider
    s.llm_model = model
    s.llm_api_key = api_key
    s.llm_api_url = api_url
    s.gemini_api_key = ""
    # Role-specific model overrides (empty string = not set)
    for attr in ("orchestrator_model", "writer_model", "evaluator_model",
                 "fixer_model", "brief_model", "blueprint_model"):
        setattr(s, attr, role_models.get(attr, ""))
    return s


class TestModelRoleEnum:
    def test_all_roles_defined(self):
        from app.orchestrator.model_router import ModelRole
        assert ModelRole.ORCHESTRATOR == "orchestrator"
        assert ModelRole.WRITER == "writer"
        assert ModelRole.EVALUATOR == "evaluator"
        assert ModelRole.FIXER == "fixer"
        assert ModelRole.BRIEF == "brief"
        assert ModelRole.BLUEPRINT == "blueprint"


class TestGetModelForRole:
    def test_no_override_falls_back_to_default(self):
        from pydantic_ai.models.openai import OpenAIModel
        mock_settings = _make_settings(provider="openai", model="gpt-4o")
        with patch("app.orchestrator.model_router.settings", mock_settings), \
             patch("app.orchestrator.llm_factory.settings", mock_settings):
            from app.orchestrator.model_router import ModelRole, get_model_for_role
            model = get_model_for_role(ModelRole.WRITER)
        assert isinstance(model, OpenAIModel)

    def test_writer_override_uses_override_model(self):
        from pydantic_ai.models.openai import OpenAIModel
        mock_settings = _make_settings(
            provider="openai",
            model="gpt-4o",
            writer_model="gpt-4o-mini",
        )
        with patch("app.orchestrator.model_router.settings", mock_settings), \
             patch("app.orchestrator.llm_factory.settings", mock_settings):
            from app.orchestrator.model_router import ModelRole, get_model_for_role
            model = get_model_for_role(ModelRole.WRITER)
        assert isinstance(model, OpenAIModel)

    def test_orchestrator_override_uses_override_model(self):
        from pydantic_ai.models.openai import OpenAIModel
        mock_settings = _make_settings(
            provider="openai",
            model="gpt-4o-mini",
            orchestrator_model="gpt-4o",
        )
        with patch("app.orchestrator.model_router.settings", mock_settings), \
             patch("app.orchestrator.llm_factory.settings", mock_settings):
            from app.orchestrator.model_router import ModelRole, get_model_for_role
            model = get_model_for_role(ModelRole.ORCHESTRATOR)
        assert isinstance(model, OpenAIModel)

    def test_evaluator_override_not_set_uses_default(self):
        from pydantic_ai.models.openai import OpenAIModel
        mock_settings = _make_settings(provider="openai", model="gpt-4o")
        with patch("app.orchestrator.model_router.settings", mock_settings), \
             patch("app.orchestrator.llm_factory.settings", mock_settings):
            from app.orchestrator.model_router import ModelRole, get_model_for_role
            model = get_model_for_role(ModelRole.EVALUATOR)
        assert model is not None

    def test_get_role_model_name_empty_returns_none(self):
        mock_settings = _make_settings(provider="openai", fixer_model="")
        with patch("app.orchestrator.model_router.settings", mock_settings):
            from app.orchestrator.model_router import ModelRole, _get_role_model_name
            result = _get_role_model_name(ModelRole.FIXER)
        assert result is None

    def test_get_role_model_name_returns_override(self):
        mock_settings = _make_settings(evaluator_model="gemini-2.0-flash")
        with patch("app.orchestrator.model_router.settings", mock_settings):
            from app.orchestrator.model_router import ModelRole, _get_role_model_name
            result = _get_role_model_name(ModelRole.EVALUATOR)
        assert result == "gemini-2.0-flash"
