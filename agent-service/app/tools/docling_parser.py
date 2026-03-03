import base64
import io
import tempfile
from pathlib import Path

from langchain_core.tools import tool

from app.tools.registry import register_tool


@register_tool
@tool
def docling_parser(file_content_b64: str, filename: str, mimetype: str) -> str:
    """解析文档文件，返回 Markdown 格式文本（含图片提取）。
    支持: PDF, Word(.docx), Excel(.xlsx), TXT, HTML, Markdown, Image(OCR)。
    PDF 中的图片会被提取并以 base64 内联方式嵌入 Markdown。
    """
    from docling.document_converter import DocumentConverter
    from docling.datamodel.base_models import InputFormat

    file_bytes = base64.b64decode(file_content_b64)

    with tempfile.NamedTemporaryFile(suffix=Path(filename).suffix, delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    try:
        converter = DocumentConverter()
        result = converter.convert(tmp_path)
        doc = result.document

        # Export to markdown with image placeholders
        md = doc.export_to_markdown()

        # Try to extract images and replace references with data URIs
        try:
            images_extracted = 0
            for element_ix, element in enumerate(doc.pages):
                if hasattr(element, 'image') and element.image:
                    # Docling 2.x: access page images
                    pass

            # Alternative: use document pictures if available
            if hasattr(doc, 'pictures') and doc.pictures:
                for i, pic in enumerate(doc.pictures):
                    if hasattr(pic, 'image') and pic.image:
                        img_data = pic.image
                        if hasattr(img_data, 'tobytes'):
                            img_bytes = img_data.tobytes()
                        elif isinstance(img_data, bytes):
                            img_bytes = img_data
                        else:
                            continue
                        b64 = base64.b64encode(img_bytes).decode()
                        # Add extracted image info to the markdown
                        md += f"\n\n![文档图片 {i+1}](data:image/png;base64,{b64})"
                        images_extracted += 1
        except Exception:
            # Image extraction is best-effort; don't fail the whole parse
            pass

        return f"[Document: {filename}]\n\n{md}"
    finally:
        Path(tmp_path).unlink(missing_ok=True)
