"""工具：从用户上传的文件中提取文本和图片。"""
from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.agent.deps import AgentDeps

from pydantic_ai import RunContext

logger = logging.getLogger(__name__)


async def extract_document_impl(deps: "AgentDeps", purpose: str = "") -> str:
    """可测试的核心逻辑（不依赖 RunContext）。"""
    if not deps.files:
        return "[No Files] No files were uploaded. Ask the user to upload a document."

    try:
        from app.workers.asset_parser import parse_document

        # 并行解析所有文件
        loop = asyncio.get_running_loop()
        tasks = [
            loop.run_in_executor(
                None, parse_document, f["content_b64"], f["filename"], f["mimetype"]
            )
            for f in deps.files
        ]
        results = await asyncio.wait_for(asyncio.gather(*tasks), timeout=120)

        # 上传图片（如有 page_id）
        all_image_urls: dict[str, str] = {}
        if deps.page_id:
            try:
                from app.tools.source_image_store import upgrade_source_image_assets

                for am in results:
                    image_items = [i for i in am.items if i.type == "image"]
                    if image_items:
                        # 检查 upgrade_source_image_assets 是否为 async
                        import inspect
                        if inspect.iscoroutinefunction(upgrade_source_image_assets):
                            upgraded = await asyncio.wait_for(
                                upgrade_source_image_assets(image_items, deps.page_id),
                                timeout=60,
                            )
                        else:
                            upgraded = await asyncio.wait_for(
                                asyncio.to_thread(upgrade_source_image_assets, image_items, deps.page_id),
                                timeout=60,
                            )
                        for item in upgraded:
                            if hasattr(item, "content") and item.content and not item.content.startswith("data:"):
                                ref = getattr(item, "source_ref", None) or getattr(item, "id", str(item))
                                all_image_urls[ref] = item.content
                                deps.uploaded_image_urls[ref] = item.content
            except Exception as img_err:
                logger.warning(f"Image upload failed (non-fatal): {img_err}")

        # 构建文本内容
        text_parts = []
        for am in results:
            if getattr(am, "source_markdown", None):
                text_parts.append(am.source_markdown)
            else:
                for item in getattr(am, "items", []):
                    if getattr(item, "type", "") in ("text", "table", "code"):
                        text_parts.append(item.content)

        content = "\n\n".join(text_parts) or "No text content extracted."
        word_count = sum(len(p.split()) for p in text_parts)

        # 图片目录
        image_section = ""
        if all_image_urls:
            lines = [f"  - {ref} → {url}" for ref, url in all_image_urls.items()]
            image_section = (
                f"\n\n[Uploaded Images ({len(all_image_urls)} total)]\n"
                + "\n".join(lines)
                + "\n\nIMPORTANT: Use these EXACT URLs as image src in your Markdown output. "
                + "Every URL above MUST appear in your final output."
            )

        return f"[Document Content] ({word_count} words){image_section}\n\n{content}"

    except asyncio.TimeoutError:
        return "[Error] Document extraction timed out after 120 seconds."
    except Exception as e:
        return f"[Error] Failed to extract document: {type(e).__name__}: {e}"


async def extract_document_tool(ctx: RunContext["AgentDeps"], purpose: str = "") -> str:
    """Extract text and images from uploaded document files.

    Call this when the user has uploaded PDF, DOCX, PPTX, or other document files.
    Automatically uploads extracted images to Docmost and returns their URLs.
    You MUST use the returned URLs when referencing images in your output.

    Args:
        purpose: What to focus on (e.g., "full content", "images only", "table data").
    """
    return await extract_document_impl(ctx.deps, purpose)
