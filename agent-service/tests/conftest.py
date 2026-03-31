import pytest
from app.config import Settings


@pytest.fixture
def test_settings():
    return Settings(
        ai_driver="openai",
        ai_completion_model="gpt-4",
        openai_api_key="test-key",
        agent_internal_secret="test-secret",
        tavily_api_key="test-tavily",
        firecrawl_api_key="test-firecrawl",
    )
