from app.agent.model_limits import get_max_tokens, PROVIDER_DEFAULTS


def test_ollama_default_is_conservative():
    assert get_max_tokens("ollama", "llama3") == 8192


def test_gpt5_4_is_128k():
    assert get_max_tokens("openai", "gpt-5-4") == 131072


def test_gemini_3_1_pro():
    assert get_max_tokens("gemini", "gemini-3.1-pro") == 65536


def test_claude_opus():
    assert get_max_tokens("anthropic", "claude-opus-4-6") == 131072


def test_unknown_model_falls_back_to_provider_default():
    result = get_max_tokens("openai", "unknown-future-model")
    assert result == PROVIDER_DEFAULTS["openai"]


def test_unknown_everything_falls_back_to_65536():
    assert get_max_tokens("", "") == 65536


def test_model_name_normalization():
    """斜杠、点号、冒号都应被规范化。"""
    assert get_max_tokens("openai", "gpt-5.4") == 131072  # 点号转连字符
