from app.models.asset_map import AssetItem, AssetMap


def test_asset_item_creation():
    item = AssetItem(id="img_001", type="image", source="report.pdf", content="https://example.com/img.png", summary="Architecture diagram")
    assert item.type == "image"
    assert item.reuse_decision is None


def test_asset_map_items_by_type():
    asset_map = AssetMap(items=[
        AssetItem(id="1", type="text", content="Hello"),
        AssetItem(id="2", type="image", content="img.png"),
        AssetItem(id="3", type="text", content="World"),
        AssetItem(id="4", type="table", content="| A | B |"),
    ])
    assert len(asset_map.items_by_type("text")) == 2
    assert len(asset_map.items_by_type("image")) == 1
    assert len(asset_map.items_by_type("code")) == 0


def test_asset_map_reusable_items():
    asset_map = AssetMap(items=[
        AssetItem(id="1", type="image", reuse_decision="reuse"),
        AssetItem(id="2", type="image", reuse_decision="skip"),
        AssetItem(id="3", type="table", reuse_decision="reuse"),
    ])
    reusable = asset_map.reusable_items()
    assert len(reusable) == 2
    assert all(item.reuse_decision == "reuse" for item in reusable)


def test_asset_map_serialization():
    asset_map = AssetMap(
        items=[AssetItem(id="1", type="text", content="test")],
        source_word_count=1000,
        source_section_counts={"intro": 200, "body": 800},
    )
    data = asset_map.model_dump()
    restored = AssetMap.model_validate(data)
    assert restored.source_word_count == 1000
    assert len(restored.items) == 1
