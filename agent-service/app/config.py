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

    # Tool API Keys
    tavily_api_key: str = ""
    firecrawl_api_key: str = ""
    firecrawl_api_url: str = "https://api.firecrawl.dev"

    # Image generation (OpenAI-compatible endpoint)
    agent_image_api_url: str = "https://api.forcome.com/v1beta"
    agent_image_model: str = "gemini-3-pro-image-preview"

    # Internal communication
    agent_internal_secret: str = ""
    docmost_internal_url: str = "http://docmost:3000"

    # Runtime config
    agent_max_iterations: int = 3

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
