"""从 Office XML (DOCX/PPTX) 和 PDF 中原生提取嵌入图片。

绕过 MinerU 的 YOLO 布局检测，直接从文件结构中提取原始图片，
消除截图被拆碎为 UI 元素碎片的问题。
"""
from __future__ import annotations

import base64
import io
import logging
import zipfile
from pathlib import Path

from PIL import Image

from app.models.source_assets import SourceImagePayload

logger = logging.getLogger(__name__)

MIN_PIXEL_AREA = 2500  # 50x50 — 过滤装饰性小图标/项目符号
MIN_FILE_BYTES = 500   # 过滤极小文件

# Office XML ZIP 中图片的路径前缀
_MEDIA_PREFIXES = {
    "docx": "word/media/",
    "doc": "word/media/",
    "pptx": "ppt/media/",
    "ppt": "ppt/media/",
}

# 支持的光栅图片扩展名（跳过 EMF/WMF 矢量格式）
_RASTER_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".tif"}

_MIME_MAP = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".tiff": "image/tiff",
    ".tif": "image/tiff",
}


def _get_format_key(filename: str) -> str | None:
    """从文件名提取格式 key（docx/pptx 等）。"""
    ext = Path(filename).suffix.lower().lstrip(".")
    return ext if ext in _MEDIA_PREFIXES else None


def _extract_from_office_zip(
    file_bytes: bytes, media_prefix: str,
) -> list[SourceImagePayload]:
    """从 Office XML ZIP 中提取 media/ 目录下的光栅图片。"""
    try:
        zf = zipfile.ZipFile(io.BytesIO(file_bytes))
    except (zipfile.BadZipFile, Exception):
        return []

    images: list[SourceImagePayload] = []
    for name in sorted(zf.namelist()):
        if not name.startswith(media_prefix):
            continue

        ext = Path(name).suffix.lower()
        if ext not in _RASTER_EXTS:
            continue

        img_bytes = zf.read(name)
        if len(img_bytes) < MIN_FILE_BYTES:
            continue

        # 读取像素尺寸（Pillow 只读 header，极快）
        try:
            with Image.open(io.BytesIO(img_bytes)) as pil_img:
                w, h = pil_img.size
        except Exception:
            continue

        if w * h < MIN_PIXEL_AREA:
            continue

        images.append(SourceImagePayload(
            index=len(images),
            b64=base64.b64encode(img_bytes).decode("utf-8"),
            desc=f"Embedded image ({w}x{h})",
            mime_type=_MIME_MAP.get(ext, "image/png"),
            parser="docx_native",
            source_ref=name,
            confidence=1.0,
        ))

    zf.close()
    logger.info(
        "native_image_extraction",
        extra={"source": "office_zip", "prefix": media_prefix, "count": len(images)},
    )
    return images


def _extract_from_pdf(file_bytes: bytes) -> list[SourceImagePayload]:
    """从 PDF 中用 PyMuPDF 提取嵌入图片。"""
    try:
        import pymupdf
    except ImportError:
        logger.warning("pymupdf not installed, skipping PDF native extraction")
        return []

    images: list[SourceImagePayload] = []
    try:
        doc = pymupdf.open(stream=file_bytes, filetype="pdf")
    except Exception:
        return []

    seen_xrefs: set[int] = set()
    for page in doc:
        for img_info in page.get_images(full=True):
            xref = img_info[0]
            if xref in seen_xrefs:
                continue
            seen_xrefs.add(xref)

            try:
                base_image = doc.extract_image(xref)
            except Exception:
                continue

            img_bytes = base_image.get("image")
            img_ext = base_image.get("ext", "png")
            if not img_bytes or len(img_bytes) < MIN_FILE_BYTES:
                continue

            # 读取像素尺寸
            try:
                with Image.open(io.BytesIO(img_bytes)) as pil_img:
                    w, h = pil_img.size
            except Exception:
                continue

            if w * h < MIN_PIXEL_AREA:
                continue

            mime = _MIME_MAP.get(f".{img_ext}", "image/png")
            images.append(SourceImagePayload(
                index=len(images),
                b64=base64.b64encode(img_bytes).decode("utf-8"),
                desc=f"Embedded image ({w}x{h})",
                mime_type=mime,
                page_number=page.number + 1,
                parser="pdf_native",
                source_ref=f"page{page.number + 1}_xref{xref}",
                confidence=1.0,
            ))

    doc.close()
    logger.info(
        "native_image_extraction",
        extra={"source": "pdf", "count": len(images)},
    )
    return images


def extract_native_images(
    file_bytes: bytes, filename: str,
) -> list[SourceImagePayload]:
    """从文件中原生提取嵌入图片。

    - DOCX/PPTX: 从 ZIP 的 word/media/ 或 ppt/media/ 直接提取
    - PDF: 用 PyMuPDF 提取嵌入图片对象
    - 其他格式: 返回空列表（回退到 MinerU）

    Args:
        file_bytes: 原始文件字节
        filename: 文件名（用于判断格式）

    Returns:
        SourceImagePayload 列表，过滤掉了装饰性小图
    """
    fmt = _get_format_key(filename)
    if fmt and fmt in _MEDIA_PREFIXES:
        return _extract_from_office_zip(file_bytes, _MEDIA_PREFIXES[fmt])

    if filename.lower().endswith(".pdf"):
        return _extract_from_pdf(file_bytes)

    return []
