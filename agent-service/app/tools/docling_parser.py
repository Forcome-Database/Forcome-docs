import base64
import json
import tempfile
from pathlib import Path

from langchain_core.tools import tool

from app.tools.registry import register_tool


@register_tool
@tool
def docling_parser(file_content_b64: str, filename: str, mimetype: str) -> str:
    """解析文档文件，返回 JSON 格式结果（含文本和提取的图片）。
    支持: PDF, Word(.docx), Excel(.xlsx), TXT, HTML, Markdown, Image(OCR)。

    返回 JSON: {"text": "...", "images": [{"index": 0, "b64": "...", "desc": "..."}, ...]}
    """
    from docling.document_converter import DocumentConverter

    file_bytes = base64.b64decode(file_content_b64)

    with tempfile.NamedTemporaryFile(suffix=Path(filename).suffix, delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    try:
        converter = DocumentConverter()
        result = converter.convert(tmp_path)
        doc = result.document

        # Export markdown (text only)
        md = doc.export_to_markdown()

        # Extract images from document
        images = []
        try:
            # Docling 2.x: try export_to_markdown with embedded images
            from docling_core.types.doc import ImageRefMode
            md_with_images = doc.export_to_markdown(image_mode=ImageRefMode.EMBEDDED)

            # Parse out data URIs from the markdown
            import re
            pattern = r'!\[([^\]]*)\]\((data:image/[^;]+;base64,[^)]+)\)'
            for i, match in enumerate(re.finditer(pattern, md_with_images)):
                alt_text = match.group(1) or f"图片 {i+1}"
                data_uri = match.group(2)
                # Extract just the base64 part
                b64_data = data_uri.split(",", 1)[-1] if "," in data_uri else ""
                if b64_data:
                    images.append({"index": i, "b64": b64_data, "desc": alt_text})

            # If embedded mode produced images, use the text-only markdown for content
            # (images will be handled separately via upload)
        except (ImportError, Exception):
            # Fallback: try to access doc.pictures directly
            try:
                if hasattr(doc, 'pictures') and doc.pictures:
                    for i, pic in enumerate(doc.pictures):
                        img = getattr(pic, 'image', None)
                        if img is None:
                            continue
                        # Try to get image bytes from PIL Image or bytes
                        if hasattr(img, 'pil_image'):
                            import io
                            buf = io.BytesIO()
                            img.pil_image.save(buf, format="PNG")
                            b64 = base64.b64encode(buf.getvalue()).decode()
                        elif isinstance(img, bytes):
                            b64 = base64.b64encode(img).decode()
                        else:
                            continue
                        desc = getattr(pic, 'caption', '') or f"文档图片 {i+1}"
                        images.append({"index": i, "b64": b64, "desc": str(desc)})
            except Exception:
                pass

        return json.dumps({
            "text": f"[Document: {filename}]\n\n{md}",
            "images": images,
            "image_count": len(images),
        }, ensure_ascii=False)

    finally:
        Path(tmp_path).unlink(missing_ok=True)
