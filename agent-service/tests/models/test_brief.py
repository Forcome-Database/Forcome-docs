from app.models.brief import CreationBrief


def test_creation_brief_defaults():
    brief = CreationBrief()
    assert brief.audience == ""
    assert brief.target_length == 0
    assert brief.length_tolerance == 0.1
    assert brief.structure_strategy == "ai_recommend"
    assert brief.image_strategy == "mixed"
    assert brief.constraints == []


def test_creation_brief_full():
    brief = CreationBrief(
        audience="技术团队",
        goal="产品介绍文档",
        target_length=5000,
        style="专业严谨",
        tone="正式",
        structure_strategy="copy_source",
        image_strategy="reuse_source",
        constraints=["不超过10页", "包含API示例"],
    )
    assert brief.audience == "技术团队"
    assert brief.target_length == 5000
    assert brief.constraints == ["不超过10页", "包含API示例"]


def test_creation_brief_serialization():
    brief = CreationBrief(audience="管理层", goal="季度报告", target_length=3000)
    data = brief.model_dump()
    assert data["audience"] == "管理层"
    restored = CreationBrief.model_validate(data)
    assert restored == brief
