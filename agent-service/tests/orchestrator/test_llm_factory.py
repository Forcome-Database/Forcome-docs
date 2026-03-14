"""Tests for orchestrator LLM factory."""
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


def _make_settings(
    provider: str = "openai",
    model: str = "gpt-4o",
    api_key: str = "sk-test",
    api_url: str = "https://api.openai.com/v1",
    gemini_key: str = "",
) -> MagicMock:
    s = MagicMock()
    s.llm_provider = provider
    s.llm_model = model
    s.llm_api_key = api_key
    s.llm_api_url = api_url
    s.gemini_api_key = gemini_key
    return s


class TestLLMFactoryOpenAI:
    def test_default_openai_returns_model(self):
        mock_settings = _make_settings(provider="openai")
        with patch("app.orchestrator.llm_factory.settings", mock_settings):
            from app.orchestrator.llm_factory import create_pydantic_ai_model

            model = create_pydantic_ai_model()
        assert model is not None

    def test_openai_model_type(self):
        from pydantic_ai.models.openai import OpenAIModel

        mock_settings = _make_settings(provider="openai", model="gpt-4o-mini")
        with patch("app.orchestrator.llm_factory.settings", mock_settings):
            from app.orchestrator.llm_factory import create_pydantic_ai_model

            model = create_pydantic_ai_model()
        assert isinstance(model, OpenAIModel)

    def test_unknown_provider_falls_back_to_openai(self):
        from pydantic_ai.models.openai import OpenAIModel

        mock_settings = _make_settings(provider="some-unknown-provider")
        with patch("app.orchestrator.llm_factory.settings", mock_settings):
            from app.orchestrator.llm_factory import create_pydantic_ai_model

            model = create_pydantic_ai_model()
        assert isinstance(model, OpenAIModel)
        assert model is not None


class TestLLMFactoryGemini:
    def test_gemini_returns_google_model(self):
        from pydantic_ai.models.google import GoogleModel

        mock_settings = _make_settings(
            provider="gemini",
            model="gemini-2.0-flash",
            gemini_key="gemini-test-key",
        )
        with patch("app.orchestrator.llm_factory.settings", mock_settings):
            from app.orchestrator.llm_factory import create_pydantic_ai_model

            model = create_pydantic_ai_model()
        assert isinstance(model, GoogleModel)
        assert model is not None

    def test_gemini_uses_gemini_api_key(self):
        from pydantic_ai.models.google import GoogleModel

        mock_settings = _make_settings(
            provider="gemini",
            model="gemini-2.0-flash",
            api_key="openai-key",
            gemini_key="gemini-specific-key",
        )
        with patch("app.orchestrator.llm_factory.settings", mock_settings):
            from app.orchestrator.llm_factory import create_pydantic_ai_model

            model = create_pydantic_ai_model()
        assert isinstance(model, GoogleModel)


class TestLLMFactoryOllama:
    def test_ollama_returns_openai_model(self):
        from pydantic_ai.models.openai import OpenAIModel

        mock_settings = _make_settings(
            provider="ollama",
            model="llama3.2",
            api_url="http://localhost:11434/v1",
        )
        with patch("app.orchestrator.llm_factory.settings", mock_settings):
            from app.orchestrator.llm_factory import create_pydantic_ai_model

            model = create_pydantic_ai_model()
        assert isinstance(model, OpenAIModel)
        assert model is not None

    def test_ollama_appends_v1_if_missing(self):
        from pydantic_ai.models.openai import OpenAIModel

        mock_settings = _make_settings(
            provider="ollama",
            model="llama3.2",
            api_url="http://localhost:11434",
        )
        with patch("app.orchestrator.llm_factory.settings", mock_settings):
            from app.orchestrator.llm_factory import create_pydantic_ai_model

            model = create_pydantic_ai_model()
        assert isinstance(model, OpenAIModel)

    def test_ollama_v1_suffix_not_doubled(self):
        from pydantic_ai.models.openai import OpenAIModel

        mock_settings = _make_settings(
            provider="ollama",
            model="mistral",
            api_url="http://localhost:11434/v1",
        )
        with patch("app.orchestrator.llm_factory.settings", mock_settings):
            from app.orchestrator.llm_factory import create_pydantic_ai_model

            model = create_pydantic_ai_model()
        assert isinstance(model, OpenAIModel)


class TestLLMFactoryOpenAICompatible:
    def test_openai_compatible_returns_openai_model(self):
        from pydantic_ai.models.openai import OpenAIModel

        mock_settings = _make_settings(
            provider="openai-compatible",
            model="deepseek-chat",
            api_url="https://api.deepseek.com/v1",
            api_key="ds-test-key",
        )
        with patch("app.orchestrator.llm_factory.settings", mock_settings):
            from app.orchestrator.llm_factory import create_pydantic_ai_model

            model = create_pydantic_ai_model()
        assert isinstance(model, OpenAIModel)
        assert model is not None

    def test_openai_compatible_uses_provided_base_url(self):
        from pydantic_ai.models.openai import OpenAIModel

        mock_settings = _make_settings(
            provider="openai-compatible",
            model="qwen-turbo",
            api_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        )
        with patch("app.orchestrator.llm_factory.settings", mock_settings):
            from app.orchestrator.llm_factory import create_pydantic_ai_model

            model = create_pydantic_ai_model()
        assert isinstance(model, OpenAIModel)


class TestLLMFactoryOverrides:
    def test_provider_override(self):
        from pydantic_ai.models.openai import OpenAIModel

        mock_settings = _make_settings(provider="gemini")
        with patch("app.orchestrator.llm_factory.settings", mock_settings):
            from app.orchestrator.llm_factory import create_pydantic_ai_model

            # Override the settings provider
            model = create_pydantic_ai_model(
                provider="openai", api_key="sk-override"
            )
        assert isinstance(model, OpenAIModel)

    def test_model_name_override(self):
        from pydantic_ai.models.openai import OpenAIModel

        mock_settings = _make_settings(provider="openai", model="gpt-4")
        with patch("app.orchestrator.llm_factory.settings", mock_settings):
            from app.orchestrator.llm_factory import create_pydantic_ai_model

            model = create_pydantic_ai_model(model_name="gpt-4o-mini")
        assert isinstance(model, OpenAIModel)
