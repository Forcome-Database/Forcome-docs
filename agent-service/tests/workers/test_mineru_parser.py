from __future__ import annotations

import base64
import io
import json
import zipfile

from app.models.source_assets import SourceImagePayload
from app.workers.mineru_parser import parse_mineru_zip


def _sample_mineru_zip() -> bytes:
    content_list = [
        {
            "type": "text",
            "text": "采购退货单 SOP",
            "text_level": 1,
            "page_idx": 0,
            "bbox": [20, 20, 900, 80],
        },
        {
            "type": "text",
            "text": "处理前提",
            "text_level": 2,
            "page_idx": 0,
            "bbox": [20, 100, 420, 140],
        },
        {
            "type": "text",
            "text": "根据 IV 查到这一单有相同 SKU。",
            "page_idx": 0,
            "bbox": [20, 150, 900, 240],
        },
        {
            "type": "image",
            "img_path": "images/figure-1.png",
            "page_idx": 0,
            "bbox": [120, 260, 920, 760],
            "image_caption": ["图1 采购退货流程截图"],
            "image_footnote": ["步骤 3 页面"],
        },
    ]
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("采购退货单sop/full.md", "# 采购退货单 SOP\n\n## 处理前提\n\n根据 IV 查到这一单有相同 SKU。")
        zf.writestr(
            "采购退货单sop/采购退货单sop_content_list.json",
            json.dumps(content_list, ensure_ascii=False),
        )
        zf.writestr("采购退货单sop/images/figure-1.png", b"fake-png-bytes")
    return buf.getvalue()


def test_source_image_payload_supports_bbox_and_nearby_text():
    payload = SourceImagePayload(
        index=1,
        b64="YWJj",
        desc="Purchase return flow screenshot",
        page_number=2,
        heading="采购退货单（新增）",
        bbox=[10, 20, 300, 500],
        nearby_text="步骤 3：采购退货单（新增）",
        confidence=0.91,
        parser="mineru",
    )

    assert payload.page_number == 2
    assert payload.bbox == [10, 20, 300, 500]
    assert payload.nearby_text == "步骤 3：采购退货单（新增）"
    assert payload.parser == "mineru"
    assert payload.to_data_uri().startswith("data:image/png;base64,YWJj")


def test_parse_mineru_zip_extracts_text_images_and_structure():
    result = parse_mineru_zip(_sample_mineru_zip(), filename="采购退货单sop.pdf")

    assert "采购退货单 SOP" in result.text
    assert len(result.images) == 1
    assert result.images[0].page_number == 1
    assert "采购退货流程截图" in result.images[0].desc
    assert "步骤 3 页面" in result.images[0].nearby_text
    assert result.images[0].bbox == [120, 260, 920, 760]
    assert base64.b64decode(result.images[0].b64) == b"fake-png-bytes"
    assert result.structure[0]["text"] == "采购退货单 SOP"
    assert result.blocks[0]["type"] == "heading"
    assert result.blocks[1]["type"] == "heading"
    assert result.blocks[2]["type"] == "text"


def test_parse_mineru_zip_sets_document_title_from_first_h1():
    result = parse_mineru_zip(_sample_mineru_zip(), filename="source.pdf")

    assert result.document_title == result.structure[0]["text"]


def test_parse_mineru_zip_sets_document_title_from_top_heading_when_no_h1():
    content_list = [
        {
            "type": "text",
            "text": "Purchase Return SOP",
            "text_level": 3,
            "page_idx": 0,
            "bbox": [30, 20, 900, 90],
        },
        {
            "type": "text",
            "text": "4. Submit Review",
            "text_level": 3,
            "page_idx": 0,
            "bbox": [30, 180, 420, 240],
        },
    ]
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("doc/full.md", "### Purchase Return SOP\n\n### 4. Submit Review")
        zf.writestr("doc/content_list.json", json.dumps(content_list, ensure_ascii=False))

    result = parse_mineru_zip(buf.getvalue(), filename="source.pdf")

    assert result.document_title == "Purchase Return SOP"


def test_parse_mineru_zip_does_not_treat_numbered_section_as_document_title():
    content_list = [
        {
            "type": "text",
            "text": "4. Submit Review",
            "text_level": 3,
            "page_idx": 0,
            "bbox": [30, 20, 420, 80],
        },
        {
            "type": "text",
            "text": "5. Create Invoice",
            "text_level": 3,
            "page_idx": 0,
            "bbox": [30, 120, 760, 200],
        },
    ]
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("doc/full.md", "### 4. Submit Review\n\n### 5. Create Invoice")
        zf.writestr("doc/content_list.json", json.dumps(content_list, ensure_ascii=False))

    result = parse_mineru_zip(buf.getvalue(), filename="source.pdf")

    assert result.document_title == ""
