from langchain_core.language_models import BaseChatModel
from app.config import settings

def get_chat_model() -> BaseChatModel:
    """根据配置返回 LLM 实例"""
    provider = settings.llm_provider
    model = settings.llm_model

    if provider in ("openai", "openai-compatible"):
        from langchain_openai import ChatOpenAI
        kwargs = {"model": model, "api_key": settings.llm_api_key, "streaming": True}
        if provider == "openai-compatible":
            kwargs["base_url"] = settings.llm_api_url
        return ChatOpenAI(**kwargs)
    elif provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(
            model=model, google_api_key=settings.gemini_api_key, streaming=True
        )
    else:
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(model=model, api_key=settings.llm_api_key, streaming=True)
