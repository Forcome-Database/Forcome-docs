"""动态 max_tokens 查找，适配不同模型的输出上限。"""
from __future__ import annotations

# 已验证的主力模型输出上限（key 为小写 model name，连字符分隔）
MODEL_OUTPUT_LIMITS: dict[str, int] = {
    # OpenAI
    "gpt-5-4": 131072,
    "gpt-4o": 16384,
    "gpt-4o-mini": 16384,
    # Google Gemini
    "gemini-3-1-pro": 65536,
    "gemini-2-5-pro": 65536,
    "gemini-1-5-pro": 8192,
    # Anthropic Claude
    "claude-opus-4-6": 131072,
    "claude-sonnet-4-6": 131072,
    "claude-haiku-4-5": 131072,
}

# Provider 级别的保守默认值
PROVIDER_DEFAULTS: dict[str, int] = {
    "openai": 65536,
    "openai-compatible": 65536,
    "openai-responses": 65536,
    "gemini": 65536,
    "anthropic": 65536,
    "ollama": 8192,  # Ollama 本地模型保守默认（避免超限崩溃）
}


def get_max_tokens(provider: str | None = None, model_name: str | None = None) -> int:
    """返回适配指定 provider/model 的 max_tokens。"""
    p = (provider or "").lower()
    m = (model_name or "").lower().replace("/", "-").replace(":", "-").replace(".", "-")
    if m in MODEL_OUTPUT_LIMITS:
        return MODEL_OUTPUT_LIMITS[m]
    return PROVIDER_DEFAULTS.get(p, 65536)


def get_max_tokens_for_current_model() -> int:
    """从 settings 读取当前配置的模型，返回对应 max_tokens。"""
    try:
        from app.config import settings
        provider = getattr(settings, "ai_provider", "") or ""
        model_name = (
            getattr(settings, "ai_model", "")
            or getattr(settings, "openai_model", "")
            or ""
        )
        return get_max_tokens(provider, model_name)
    except Exception:
        return 65536  # fallback
