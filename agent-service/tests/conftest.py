import pytest
from app.config import Settings
from app.orchestrator.session_store import session_store


@pytest.fixture(autouse=True)
def use_explicit_memory_session_backend():
    session_store.use_memory_backend()
    session_store.clear()
    yield
    session_store.use_memory_backend()
    session_store.clear()

@pytest.fixture
def test_settings():
    return Settings(
        ai_driver="openai",
        ai_completion_model="gpt-4",
        openai_api_key="test-key",
        agent_internal_secret="test-secret",
        tavily_api_key="test-tavily",
        firecrawl_api_key="test-firecrawl",
        nanobana_api_key="test-nanobana",
    )
