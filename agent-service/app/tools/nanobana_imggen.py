import httpx
from langchain_core.tools import tool

from app.config import settings
from app.tools.registry import register_tool

@register_tool
@tool
def nanobana_imggen(prompt: str, style: str = "default") -> str:
    """根据文字描述生成图片。返回图片的 base64 数据。"""
    resp = httpx.post(
        "https://api.nanobana.com/v2/generate",
        headers={"Authorization": f"Bearer {settings.nanobana_api_key}"},
        json={"prompt": prompt, "style": style},
        timeout=60.0,
    )
    resp.raise_for_status()
    data = resp.json()
    return data.get("image_b64", "")
