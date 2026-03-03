import base64

from langchain_core.tools import tool
from langchain_core.messages import HumanMessage

from app.config import settings
from app.tools.registry import register_tool

def _get_vlm():
    """获取 VLM 模型实例"""
    provider = settings.llm_provider
    model = settings.llm_model

    if provider in ("openai", "openai-compatible"):
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(
            model=model,
            api_key=settings.llm_api_key,
            base_url=settings.llm_api_url if provider == "openai-compatible" else None,
        )
    elif provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(model=model, google_api_key=settings.gemini_api_key)
    else:
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(model=model, api_key=settings.llm_api_key)

@register_tool
@tool
def vlm_understand(image_b64: str, question: str = "描述这张图片的内容") -> str:
    """使用视觉语言模型理解图片内容。返回图片的文字描述。"""
    llm = _get_vlm()
    message = HumanMessage(content=[
        {"type": "text", "text": question},
        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_b64}"}},
    ])
    response = llm.invoke([message])
    return response.content
