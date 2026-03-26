import os
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    # Dual-layer LLM config: AGENT_* takes priority, falls back to Docmost AI_*
    ai_driver: str = "openai"
    ai_completion_model: str = "gpt-4"
    openai_api_key: str = ""
    openai_api_url: str = "https://api.openai.com/v1"
    gemini_api_key: str = ""

    agent_llm_provider: str = ""
    agent_llm_model: str = ""
    agent_llm_api_key: str = ""
    agent_llm_api_url: str = ""

    # Port variables
    port: int = 3000
    agent_port: int = 8100

    # Tool API Keys
    tavily_api_key: str = ""
    firecrawl_api_key: str = ""
    firecrawl_api_url: str = "https://api.firecrawl.dev"

    # Image generation (OpenAI-compatible endpoint)
    agent_image_api_url: str = "https://api.forcome.com/v1"
    agent_image_model: str = "gemini-3-pro-image-preview"

    # Internal communication (auto-derived from PORT if not set)
    agent_internal_secret: str = ""
    docmost_internal_url: str = ""

    # Runtime config
    agent_max_iterations: int = 3

    # MinerU parsing
    mineru_enabled: bool = True
    mineru_api_base_url: str = "https://mineru.net"
    mineru_api_token: str = ""
    mineru_poll_interval_seconds: float = 2.0
    mineru_poll_timeout_seconds: float = 120.0

    # Role-specific model overrides
    orchestrator_model: str = ""
    writer_model: str = ""
    evaluator_model: str = ""
    fixer_model: str = ""
    brief_model: str = ""
    blueprint_model: str = ""

    # PostgreSQL connection string for LangGraph checkpointer
    database_url: str = ""
    redis_url: str = ""
    session_backend: str = "postgres_redis"

    @property
    def effective_docmost_url(self) -> str:
        """Auto-derive from PORT when DOCMOST_INTERNAL_URL is not set."""
        return self.docmost_internal_url or f"http://localhost:{self.port}"

    @property
    def llm_provider(self) -> str:
        return self.agent_llm_provider or self.ai_driver

    @property
    def llm_model(self) -> str:
        return self.agent_llm_model or self.ai_completion_model

    @property
    def llm_api_key(self) -> str:
        return self.agent_llm_api_key or self.openai_api_key

    @property
    def llm_api_url(self) -> str:
        return self.agent_llm_api_url or self.openai_api_url

    model_config = {"env_file": ["../.env", ".env"], "extra": "ignore"}

settings = Settings()

import warnings as _warnings

if not settings.agent_internal_secret:
    _warnings.warn(
        "AGENT_INTERNAL_SECRET is not configured. "
        "The agent-service API will reject all requests until this is set. "
        "Set AGENT_INTERNAL_SECRET in .env for production deployments.",
        stacklevel=1,
    )
