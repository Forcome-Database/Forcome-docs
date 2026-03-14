"""LLM factory for PydanticAI — maps existing config to PydanticAI model instances.

Reads from app/config.py settings and creates appropriate PydanticAI model references.
Supports: OpenAI, Gemini, Ollama, OpenAI-compatible providers.
"""
from __future__ import annotations

from typing import Union

from pydantic_ai.models import Model

from app.config import settings


def create_pydantic_ai_model(
    *,
    provider: str | None = None,
    model_name: str | None = None,
    api_key: str | None = None,
    base_url: str | None = None,
) -> Union[str, Model]:
    """Create a PydanticAI-compatible model instance based on config.

    Args:
        provider: LLM provider override. Defaults to settings.llm_provider.
        model_name: Model name override. Defaults to settings.llm_model.
        api_key: API key override. Defaults to settings.llm_api_key.
        base_url: Base URL override. Defaults to settings.llm_api_url.

    Returns:
        A PydanticAI Model instance.
    """
    _provider = provider or settings.llm_provider
    _model = model_name or settings.llm_model
    _api_key = api_key or settings.llm_api_key
    _base_url = base_url or getattr(settings, "llm_api_url", "")

    if _provider == "gemini":
        from pydantic_ai.models.google import GoogleModel
        from pydantic_ai.providers.google import GoogleProvider

        _gemini_key = api_key or getattr(settings, "gemini_api_key", "") or _api_key
        return GoogleModel(_model, provider=GoogleProvider(api_key=_gemini_key))

    if _provider == "ollama":
        from pydantic_ai.models.openai import OpenAIModel
        from pydantic_ai.providers.openai import OpenAIProvider

        ollama_base = _base_url or "http://localhost:11434/v1"
        if not ollama_base.endswith("/v1"):
            ollama_base = ollama_base.rstrip("/") + "/v1"
        return OpenAIModel(
            _model,
            provider=OpenAIProvider(
                base_url=ollama_base,
                api_key=_api_key or "ollama",
            ),
        )

    if _provider == "openai-compatible":
        from pydantic_ai.models.openai import OpenAIModel
        from pydantic_ai.providers.openai import OpenAIProvider

        return OpenAIModel(
            _model,
            provider=OpenAIProvider(base_url=_base_url, api_key=_api_key),
        )

    # Default: OpenAI or unknown provider
    from pydantic_ai.models.openai import OpenAIModel
    from pydantic_ai.providers.openai import OpenAIProvider

    return OpenAIModel(
        _model,
        provider=OpenAIProvider(api_key=_api_key),
    )
