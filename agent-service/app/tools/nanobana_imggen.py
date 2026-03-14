import re

import httpx
from langchain_core.tools import tool

from app.config import settings
from app.tools.registry import register_tool


def normalize_nanobana_base_url(base_url: str) -> str:
    normalized = (base_url or "").rstrip("/")
    if "api.forcome.com" in normalized and normalized.endswith("/v1beta"):
        return normalized[:-len("/v1beta")] + "/v1"
    return normalized


def build_nanobana_chat_url(base_url: str) -> str:
    return f"{normalize_nanobana_base_url(base_url)}/chat/completions"


def extract_nanobana_image_data(content: str) -> str:
    if not content:
        return ""

    markdown_match = re.search(
        r"!\[[^\]]*\]\((data:image/[^;]+;base64,([^)]+))\)",
        content,
    )
    if markdown_match:
        return markdown_match.group(2)

    data_uri_match = re.search(r"data:image/[^;]+;base64,([A-Za-z0-9+/=\r\n_-]+)", content)
    if data_uri_match:
        return data_uri_match.group(1)

    return content


@register_tool
@tool
def nanobana_imggen(prompt: str, size: str = "1024x1024") -> str:
    """根据文字描述生成图片。使用 OpenAI 兼容格式调用图片生成模型，返回图片的 base64 数据。"""
    resp = httpx.post(
        build_nanobana_chat_url(settings.agent_image_api_url),
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

    choices = data.get("choices", [])
    if not choices:
        return ""

    message = choices[0].get("message", {})
    content = message.get("content", "")

    if isinstance(content, list):
        for part in content:
            if not isinstance(part, dict):
                continue
            if part.get("type") == "image_url":
                url = part.get("image_url", {}).get("url", "")
                return extract_nanobana_image_data(url)
            if part.get("type") == "image" and part.get("data"):
                return part["data"]
        return ""

    if isinstance(content, str):
        return extract_nanobana_image_data(content)

    return ""
