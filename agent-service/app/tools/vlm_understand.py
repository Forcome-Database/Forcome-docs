import base64

from langchain_core.tools import tool
from langchain_core.messages import HumanMessage

from app.config import settings
from app.tools.registry import register_tool

def _get_vlm():
    """获取 VLM 模型实例（优先使用独立 VLM 配置）"""
    provider = settings.vlm_provider
    model = settings.vlm_model

    api_key = settings.vlm_api_key

    if provider in ("openai", "openai-compatible"):
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(
            model=model,
            api_key=api_key,
            base_url=settings.llm_api_url if provider == "openai-compatible" else None,
        )
    elif provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(model=model, google_api_key=settings.gemini_api_key or api_key)
    else:
        from langchain_openai import ChatOpenAI
        return ChatOpenAI(model=model, api_key=api_key)

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


def vlm_describe_batch(images_b64: list[tuple[str, str]]) -> list[str]:
    """一次 VLM 调用描述多张图片。

    Args:
        images_b64: [(b64_data, mime_type), ...] 列表

    Returns:
        与输入等长的描述字符串列表
    """
    if not images_b64:
        return []

    llm = _get_vlm()
    content = [
        {"type": "text", "text": (
            "以下是从文档中提取的图片。请为每张图片写一句简短描述（中文），"
            "说明图片展示的内容（如：PC端配置界面截图、手机端运行状态截图）。\n"
            "格式：每行一个，如 '1. PC端Clash导入配置界面'"
        )},
    ]
    for i, (b64, mime) in enumerate(images_b64):
        content.append({"type": "text", "text": f"\n图片 {i+1}:"})
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:{mime};base64,{b64}"},
        })

    message = HumanMessage(content=content)
    response = llm.invoke([message])
    raw = response.content or ""

    # 解析编号列表，回退到按行分割
    lines = [l.strip() for l in raw.strip().split("\n") if l.strip()]
    descriptions = []
    for i in range(len(images_b64)):
        found = False
        for line in lines:
            if line.startswith(f"{i+1}.") or line.startswith(f"{i+1}、"):
                desc = line.split(".", 1)[-1].split("、", 1)[-1].strip()
                descriptions.append(desc)
                found = True
                break
        if not found:
            descriptions.append(lines[i] if i < len(lines) else f"Image {i+1}")

    return descriptions
