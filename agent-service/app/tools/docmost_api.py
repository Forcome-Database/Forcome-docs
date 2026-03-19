import httpx
from langchain_core.tools import tool

from app.config import settings
from app.tools.registry import register_tool


def _docmost_post(path: str, json_body: dict) -> dict:
    url = f"{settings.docmost_internal_url}/api{path}"
    headers = {"X-Internal-Secret": settings.agent_internal_secret}
    response = httpx.post(url, json=json_body, headers=headers, timeout=30.0)
    response.raise_for_status()
    payload = response.json()
    return payload.get("data", payload)


@register_tool
@tool
def docmost_page_read(page_id: str) -> str:
    """Read the markdown content of a Docmost page via the internal bridge."""
    data = _docmost_post("/ai/internal/page-read", {"pageId": page_id})
    title = data.get("title", "")
    content = data.get("content", "")
    return f"# {title}\n\n{content}" if content else f"Page {page_id} is empty."


@register_tool
@tool
def docmost_rag(
    query: str,
    workspace_id: str,
    space_id: str | None = None,
    top_k: int = 5,
) -> str:
    """Search the Docmost knowledge base and return the most relevant snippets."""
    body: dict = {
        "query": query,
        "workspaceId": workspace_id,
        "limit": top_k,
    }
    if space_id:
        body["spaceId"] = space_id

    data = _docmost_post("/ai/internal/knowledge-search", body)
    items = data.get("items", []) if isinstance(data, dict) else []
    if isinstance(items, list):
        parts = [
            f"**{item.get('title', '')}**\n{item.get('content', '')}"
            for item in items
        ]
        return "\n---\n".join(parts) if parts else "No relevant knowledge found."
    return str(data)


@register_tool
@tool
def docmost_upload(file_content_b64: str, filename: str, page_id: str) -> str:
    """Upload an image to a Docmost page and return its URL."""
    return upload_page_image(
        file_content_b64=file_content_b64,
        filename=filename,
        page_id=page_id,
        mime_type="image/png",
    )


def upload_page_image(
    file_content_b64: str,
    filename: str,
    page_id: str,
    mime_type: str = "image/png",
) -> str:
    """Upload an image to a Docmost page and return its URL."""
    result = _docmost_post(
        "/ai/internal/upload-page-image",
        {
            "pageId": page_id,
            "filename": filename,
            "fileContentB64": file_content_b64,
            "mimeType": mime_type,
        },
    )
    return result.get("url", "Upload failed")
