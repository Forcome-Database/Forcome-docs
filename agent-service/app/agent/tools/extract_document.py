"""工具：从用户上传的文件中提取文本和图片。

图片提取策略：
- DOCX/PPTX: zipfile 原生提取 word/media/*（原始质量，零碎片）
- PDF: PyMuPDF 提取嵌入图片对象
- 兜底: MinerU 图片（仅当原生提取返回空时）
文本提取: 始终使用 MinerU（full.md 结构化文本）
"""
from __future__ import annotations

import asyncio
import base64
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
        from app.agent.tools.native_image_extractor import extract_native_images

        loop = asyncio.get_running_loop()

        # 1. MinerU 提取文本（并行处理所有文件）
        parse_tasks = [
            loop.run_in_executor(
                None, parse_document, f["content_b64"], f["filename"], f["mimetype"]
            )
            for f in deps.files
        ]
        results = await asyncio.wait_for(asyncio.gather(*parse_tasks), timeout=120)

        # 2. 原生提取图片（替代 MinerU 碎片图片）
        all_native_images = []
        for f in deps.files:
            try:
                file_bytes = base64.b64decode(f["content_b64"])
                native = extract_native_images(file_bytes, f["filename"])
                if native:
                    all_native_images.extend(native)
                    logger.info(
                        f"Native extraction: {len(native)} images from {f['filename']}"
                    )
            except Exception as e:
                logger.warning(f"Native image extraction failed for {f['filename']}: {e}")

        # 如果原生提取无结果，回退到 MinerU 图片
        if not all_native_images:
            for am in results:
                for item in getattr(am, "items", []):
                    if getattr(item, "type", "") == "image":
                        # MinerU 图片已是 AssetItem 格式，需转换
                        from app.models.source_assets import SourceImagePayload
                        content = getattr(item, "content", "")
                        if content.startswith("data:image/"):
                            _, b64 = content.split(",", 1)
                            all_native_images.append(SourceImagePayload(
                                index=len(all_native_images),
                                b64=b64,
                                desc=getattr(item, "caption", ""),
                                mime_type=getattr(item, "mime_type", "image/png"),
                                parser="mineru_fallback",
                                source_ref=getattr(item, "source_ref", ""),
                            ))

        # 3. 上传图片到 Docmost（如有 page_id）
        all_image_urls: dict[str, str] = {}
        image_metadata: list[dict] = []
        if deps.page_id and all_native_images:
            try:
                from app.tools.source_image_store import upload_source_image
                from PIL import Image as PILImage
                import io

                for img in all_native_images:
                    try:
                        img_bytes = base64.b64decode(img.b64)
                        # 获取像素尺寸
                        with PILImage.open(io.BytesIO(img_bytes)) as pil:
                            w, h = pil.size

                        # 上传
                        url = await loop.run_in_executor(
                            None,
                            upload_source_image,
                            deps.page_id,
                            img.b64,
                            f"image{img.index + 1}{_ext_for_mime(img.mime_type)}",
                            img.mime_type,
                        )

                        if url and not url.startswith("data:"):
                            ref = f"image{img.index + 1}"
                            all_image_urls[ref] = url
                            deps.uploaded_image_urls[ref] = url
                            image_metadata.append({
                                "ref": ref,
                                "url": url,
                                "width": w,
                                "height": h,
                                "size_kb": round(len(img_bytes) / 1024, 1),
                            })
                    except Exception as e:
                        logger.warning(f"Image upload failed for image{img.index + 1}: {e}")
            except Exception as img_err:
                logger.warning(f"Image upload pipeline failed (non-fatal): {img_err}")

        # 3b. 将图片 payloads 保存到 deps，供 describe_images 工具复用（避免重复提取）
        deps.image_payloads = all_native_images

        # 4. 构建文本内容
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

        # 5. 构建增强返回格式
        doc_title = ""
        for am in results:
            t = getattr(am, "document_title", "")
            if t:
                doc_title = t
                break

        summary = f"[Document Summary]\nTitle: {doc_title or 'Untitled'}\nWords: {word_count}\nImages: {len(image_metadata)} uploaded"

        image_section = ""
        if image_metadata:
            lines = []
            for m in image_metadata:
                lines.append(
                    f"  {m['ref']}: ({m['width']}x{m['height']}, {m['size_kb']}KB) → {m['url']}"
                )
            image_section = (
                f"\n\n[Uploaded Images ({len(image_metadata)} total)]\n"
                + "\n".join(lines)
                + "\n\nIMPORTANT: Use these EXACT URLs as image src in your Markdown output."
                + "\nEvery URL above MUST appear in your final output."
                + "\nCall `describe_images` tool next to understand what each image shows,"
                + "\nthen place each image after the text it illustrates."
            )

        return f"{summary}{image_section}\n\n[Document Content]\n\n{content}"

    except asyncio.TimeoutError:
        return "[Error] Document extraction timed out after 120 seconds."
    except Exception as e:
        return f"[Error] Failed to extract document: {type(e).__name__}: {e}"


def _ext_for_mime(mime: str) -> str:
    return {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
    }.get(mime, ".png")


async def extract_document_tool(ctx: RunContext["AgentDeps"], purpose: str = "") -> str:
    """Extract text and images from uploaded document files.

    Call this when the user has uploaded PDF, DOCX, PPTX, or other document files.
    Extracts original embedded images (not layout-detected crops) and uploads them to Docmost.
    After calling this, call `describe_images` to understand image content before placing them.

    Args:
        purpose: What to focus on (e.g., "full content", "images only", "table data").
    """
    return await extract_document_impl(ctx.deps, purpose)
