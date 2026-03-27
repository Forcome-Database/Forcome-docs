# tests/agent/tools/test_native_image_extractor.py
import base64
import io
import zipfile
import pytest
from PIL import Image


def _make_docx_with_images(image_count: int) -> bytes:
    """创建包含指定数量图片的最小 DOCX ZIP。"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        # 最小 DOCX 结构
        zf.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>')
        for i in range(image_count):
            # 创建一个 200x150 的测试图片（加入像素变化以确保 >500 bytes）
            img = Image.new("RGB", (200, 150), color=(i * 30 % 256, 100, 200))
            pixels = img.load()
            for x in range(0, 200, 2):
                for y in range(0, 150, 2):
                    pixels[x, y] = ((x + i * 30) % 256, y % 256, (x + y) % 256)
            img_buf = io.BytesIO()
            img.save(img_buf, format="PNG")
            zf.writestr(f"word/media/image{i+1}.png", img_buf.getvalue())
        # 添加一个 20x20 的小图标（应被过滤）
        tiny = Image.new("RGB", (20, 20), color=(0, 0, 0))
        tiny_buf = io.BytesIO()
        tiny.save(tiny_buf, format="PNG")
        zf.writestr("word/media/bullet.png", tiny_buf.getvalue())
    return buf.getvalue()


def test_extract_docx_images():
    from app.agent.tools.native_image_extractor import extract_native_images
    docx_bytes = _make_docx_with_images(3)
    images = extract_native_images(docx_bytes, "test.docx")
    # 3 个 200x150 图片应保留，1 个 20x20 应被过滤
    assert len(images) == 3
    for img in images:
        assert img.b64  # 有 base64 数据
        assert img.parser == "docx_native"
        assert img.mime_type == "image/png"


def test_extract_filters_tiny_images():
    from app.agent.tools.native_image_extractor import extract_native_images
    docx_bytes = _make_docx_with_images(0)  # 只有 20x20 小图标
    images = extract_native_images(docx_bytes, "test.docx")
    assert len(images) == 0


def test_extract_non_zip_returns_empty():
    from app.agent.tools.native_image_extractor import extract_native_images
    images = extract_native_images(b"not a zip file", "test.docx")
    assert len(images) == 0


def test_extract_pptx_images():
    from app.agent.tools.native_image_extractor import extract_native_images
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types></Types>')
        img = Image.new("RGB", (300, 200), color=(100, 100, 100))
        pixels = img.load()
        for x in range(0, 300, 2):
            for y in range(0, 200, 2):
                pixels[x, y] = (x % 256, y % 256, (x + y) % 256)
        img_buf = io.BytesIO()
        img.save(img_buf, format="JPEG")
        zf.writestr("ppt/media/image1.jpg", img_buf.getvalue())
    images = extract_native_images(buf.getvalue(), "slides.pptx")
    assert len(images) == 1
    assert images[0].mime_type == "image/jpeg"


def test_extract_pdf_images():
    """PDF 原生图片提取（需要 pymupdf）。"""
    import pymupdf
    from app.agent.tools.native_image_extractor import extract_native_images

    # 创建包含一张图片的最小 PDF
    doc = pymupdf.open()
    page = doc.new_page(width=612, height=792)
    # 插入一张 200x150 的测试图片（加入像素变化以确保 >500 bytes）
    img = Image.new("RGB", (200, 150), color=(50, 100, 200))
    pixels = img.load()
    for x in range(0, 200, 2):
        for y in range(0, 150, 2):
            pixels[x, y] = (x % 256, y % 256, (x + y) % 256)
    img_buf = io.BytesIO()
    img.save(img_buf, format="PNG")
    img_bytes = img_buf.getvalue()
    page.insert_image(pymupdf.Rect(100, 100, 300, 250), stream=img_bytes)
    pdf_bytes = doc.tobytes()
    doc.close()

    images = extract_native_images(pdf_bytes, "test.pdf")
    assert len(images) >= 1
    assert images[0].parser == "pdf_native"
