import base64
import httpx
from langchain_core.tools import tool

from app.config import settings
from app.tools.registry import register_tool

def _docmost_post(path: str, json_body: dict, headers: dict | None = None) -> dict:
    """调用 Docmost 内部 API"""
    url = f"{settings.docmost_internal_url}/api{path}"
    h = {"X-Internal-Secret": settings.agent_internal_secret, **(headers or {})}
    resp = httpx.post(url, json=json_body, headers=h, timeout=30.0)
    resp.raise_for_status()
    return resp.json().get("data", resp.json())

@register_tool
@tool
def docmost_page_read(page_id: str) -> str:
    """读取 Docmost 系统中指定页面的 Markdown 内容。"""
    data = _docmost_post("/pages/details", {"pageId": page_id})
    title = data.get("title", "")
    content = data.get("content", "")
    return f"# {title}\n\n{content}" if content else f"页面 {page_id} 内容为空。"

@register_tool
@tool
def docmost_rag(query: str, space_id: str | None = None, top_k: int = 5) -> str:
    """在 Docmost 知识库中进行语义搜索，返回相关页面片段。"""
    body: dict = {"query": query, "limit": top_k}
    if space_id:
        body["spaceId"] = space_id
    data = _docmost_post("/ai/answers", body)
    if isinstance(data, list):
        parts = [f"**{item.get('title', '')}**\n{item.get('content', '')}" for item in data]
        return "\n---\n".join(parts) if parts else "未找到相关内容。"
    return str(data)

@register_tool
@tool
def docmost_upload(file_content_b64: str, filename: str, page_id: str) -> str:
    """上传文件/图片到 Docmost 存储，返回可在文档中引用的 URL。"""
    file_bytes = base64.b64decode(file_content_b64)
    url = f"{settings.docmost_internal_url}/api/attachments/upload-image"
    files = {"file": (filename, file_bytes, "image/png")}
    data = {"pageId": page_id}
    h = {"X-Internal-Secret": settings.agent_internal_secret}
    resp = httpx.post(url, files=files, data=data, headers=h, timeout=30.0)
    resp.raise_for_status()
    result = resp.json().get("data", resp.json())
    return result.get("url", result.get("filePath", "上传失败"))
