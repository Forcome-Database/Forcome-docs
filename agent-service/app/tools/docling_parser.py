import base64
import tempfile
from pathlib import Path

from langchain_core.tools import tool

from app.tools.registry import register_tool

@register_tool
@tool
def docling_parser(file_content_b64: str, filename: str, mimetype: str) -> str:
    """解析文档文件，返回 Markdown 格式文本。
    支持: PDF, Word(.docx), Excel(.xlsx), TXT, HTML, Markdown, Image(OCR)。
    """
    from docling.document_converter import DocumentConverter

    file_bytes = base64.b64decode(file_content_b64)

    with tempfile.NamedTemporaryFile(suffix=Path(filename).suffix, delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    try:
        converter = DocumentConverter()
        result = converter.convert(tmp_path)
        md = result.document.export_to_markdown()
        return f"[Document: {filename}]\n\n{md}"
    finally:
        Path(tmp_path).unlink(missing_ok=True)
