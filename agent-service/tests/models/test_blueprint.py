from app.models.blueprint import VisualPlan, SectionPlan, CreationBlueprint


def test_visual_plan_creation():
    vp = VisualPlan(type="mermaid", description="Flowchart of process")
    assert vp.type == "mermaid"
    assert vp.description == "Flowchart of process"
    assert vp.source_asset_id is None
    assert vp.position == "end_of_section"


def test_visual_plan_with_source():
    vp = VisualPlan(type="reuse_image", source_asset_id="img_001", position="before_section")
    assert vp.source_asset_id == "img_001"
    assert vp.position == "before_section"


def test_section_plan_creation():
    sp = SectionPlan(
        id="sec_001",
        title="Introduction",
        level=1,
        word_budget=500,
        description="Overview of the document",
        assets=["asset_1", "asset_2"],
        visuals=[VisualPlan(type="ai_image", description="Hero image")],
        must_cover=["background", "objectives"],
    )
    assert sp.id == "sec_001"
    assert sp.title == "Introduction"
    assert sp.level == 1
    assert sp.word_budget == 500
    assert len(sp.assets) == 2
    assert len(sp.visuals) == 1
    assert len(sp.must_cover) == 2


def test_section_plan_defaults():
    sp = SectionPlan(id="sec_002", title="Body")
    assert sp.level == 2
    assert sp.word_budget == 0
    assert sp.assets == []
    assert sp.visuals == []
    assert sp.must_cover == []


def test_creation_blueprint_with_sections():
    bp = CreationBlueprint(
        title="Technical Guide",
        total_word_budget=3000,
        style_guide="Use active voice",
        sections=[
            SectionPlan(id="s1", title="Intro", word_budget=500),
            SectionPlan(id="s2", title="Body", word_budget=2000),
            SectionPlan(id="s3", title="Conclusion", word_budget=500),
        ],
    )
    assert bp.title == "Technical Guide"
    assert len(bp.sections) == 3
    assert bp.total_word_budget == 3000


def test_section_by_id_found():
    bp = CreationBlueprint(
        sections=[
            SectionPlan(id="s1", title="Intro"),
            SectionPlan(id="s2", title="Body"),
        ]
    )
    section = bp.section_by_id("s2")
    assert section is not None
    assert section.title == "Body"


def test_section_by_id_not_found():
    bp = CreationBlueprint(sections=[SectionPlan(id="s1", title="Intro")])
    assert bp.section_by_id("nonexistent") is None


def test_validate_word_budgets_passing():
    bp = CreationBlueprint(
        total_word_budget=1000,
        sections=[
            SectionPlan(id="s1", title="A", word_budget=500),
            SectionPlan(id="s2", title="B", word_budget=500),
        ],
    )
    assert bp.validate_word_budgets() is True


def test_validate_word_budgets_within_tolerance():
    # 950 / 1000 = 0.95, within [0.9, 1.1]
    bp = CreationBlueprint(
        total_word_budget=1000,
        sections=[
            SectionPlan(id="s1", title="A", word_budget=500),
            SectionPlan(id="s2", title="B", word_budget=450),
        ],
    )
    assert bp.validate_word_budgets() is True


def test_validate_word_budgets_failing():
    # 500 / 1000 = 0.5, below 0.9
    bp = CreationBlueprint(
        total_word_budget=1000,
        sections=[SectionPlan(id="s1", title="A", word_budget=500)],
    )
    assert bp.validate_word_budgets() is False


def test_validate_word_budgets_zero_total():
    # zero total_word_budget always returns True
    bp = CreationBlueprint(
        total_word_budget=0,
        sections=[SectionPlan(id="s1", title="A", word_budget=500)],
    )
    assert bp.validate_word_budgets() is True


def test_blueprint_serialization():
    bp = CreationBlueprint(
        title="Test Doc",
        total_word_budget=2000,
        sections=[SectionPlan(id="s1", title="Intro", word_budget=500)],
    )
    data = bp.model_dump()
    restored = CreationBlueprint.model_validate(data)
    assert restored.title == "Test Doc"
    assert len(restored.sections) == 1
    assert restored.sections[0].title == "Intro"
    assert restored == bp
