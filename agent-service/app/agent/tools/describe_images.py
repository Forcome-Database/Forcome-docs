"""工具：VLM 批量描述已上传图片内容。

让 Agent 理解每张图片展示了什么，以便在 Markdown 中精确放置。
使用独立的 VLM 模型（如 gemini-flash），单次多图调用，成本极低。
"""
from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.agent.deps import AgentDeps

from pydantic_ai import RunContext

logger = logging.getLogger(__name__)


async def describe_images_impl(deps: "AgentDeps") -> str:
    """可测试的核心逻辑。"""
    if not deps.uploaded_image_urls:
        return "[No Images] No images have been uploaded. Call extract_document first."

    # 从 deps.image_payloads 获取图片数据（extract_document 已保存，避免重复提取）
    image_payloads = getattr(deps, "image_payloads", None) or []
    if not image_payloads:
        return "[No Images] No image data available. Call extract_document first."

    try:
        from app.tools.vlm_understand import vlm_describe_batch

        # 准备 VLM 输入（直接从 deps 读取，零重复提取）
        images_for_vlm = [(img.b64, img.mime_type) for img in image_payloads]

        # 单次多图 VLM 调用
        loop = asyncio.get_running_loop()
        descriptions = await loop.run_in_executor(
            None, vlm_describe_batch, images_for_vlm,
        )

        # 构建返回，将描述与已上传 URL 对齐
        lines = []
        url_list = list(deps.uploaded_image_urls.values())
        for i, desc in enumerate(descriptions):
            url = url_list[i] if i < len(url_list) else "?"
            lines.append(f'  Image {i+1}: "{desc}" → {url}')

        return (
            f"[Image Descriptions ({len(descriptions)} images)]\n"
            + "\n".join(lines)
            + "\n\nUse these descriptions to place each image after the text it illustrates."
            + "\nExample: If Image 2 shows '代理模式选择', place it after the '选择代理模式' step."
        )

    except Exception as e:
        logger.warning(f"describe_images failed: {e}")
        return f"[Error] Failed to describe images: {type(e).__name__}: {e}"


async def describe_images_tool(ctx: RunContext["AgentDeps"]) -> str:
    """Understand the content of all uploaded document images using VLM.

    Call this AFTER extract_document to understand what each image shows.
    Returns a description for each image to help you place them correctly
    in your Markdown output.
    """
    return await describe_images_impl(ctx.deps)
