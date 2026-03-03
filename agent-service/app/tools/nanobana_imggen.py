import base64
import httpx
from langchain_core.tools import tool

from app.config import settings
from app.tools.registry import register_tool


@register_tool
@tool
def nanobana_imggen(prompt: str, size: str = "1024x1024") -> str:
    """根据文字描述生成图片。使用 OpenAI 兼容格式调用图片生成模型，返回图片的 base64 数据。"""
    resp = httpx.post(
        f"{settings.agent_image_api_url}/chat/completions",
        headers={
            "Authorization": f"Bearer {settings.llm_api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": settings.agent_image_model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": f"Generate an image: {prompt}",
                        },
                    ],
                },
            ],
        },
        timeout=120.0,
    )
    resp.raise_for_status()
    data = resp.json()

    # Extract image from response - handle multiple response formats
    choices = data.get("choices", [])
    if not choices:
        return ""

    message = choices[0].get("message", {})
    content = message.get("content", "")

    # If content is a list (multimodal response), find the image part
    if isinstance(content, list):
        for part in content:
            if isinstance(part, dict):
                if part.get("type") == "image_url":
                    url = part.get("image_url", {}).get("url", "")
                    # If it's a data URI, extract base64
                    if url.startswith("data:"):
                        return url.split(",", 1)[-1]
                    return url
                elif part.get("type") == "image" and part.get("data"):
                    return part["data"]
        return ""

    # If content is a string containing base64 image data
    if isinstance(content, str) and content.startswith("data:image"):
        return content.split(",", 1)[-1]

    return content
