from app.models.state import CreationState
from app.models.brief import CreationBrief
from app.models.asset_map import AssetMap, AssetItem
from app.models.blueprint import CreationBlueprint, SectionPlan
from app.models.draft import SectionDraft
from app.models.review import ReviewReport


def test_creation_state_defaults():
    state = CreationState()
    assert state.user_message == ""
    assert state.conversation_history == []
    assert state.uploaded_files == []
    assert state.template_id is None
    assert state.system_prompt is None
    assert state.template_prompt is None
    assert state.complexity_level == 3
    assert state.brief is None
    assert state.asset_map is None
    assert state.blueprint is None
    assert state.section_drafts == []
    assert state.review_report is None
    assert state.page_id is None
    assert state.page_title is None
    assert state.page_content is None
    assert state.selected_text is None
    assert state.workspace_id == ""
    assert state.phase == "init"
    assert state.final_content == ""
    assert state.task_id == ""
    assert state.thread_id == ""


def test_creation_state_with_brief():
    brief = CreationBrief(audience="技术团队", goal="API文档", target_length=3000)
    state = CreationState(user_message="写一篇API文档", brief=brief)
    assert state.user_message == "写一篇API文档"
    assert state.brief is not None
    assert state.brief.audience == "技术团队"
    assert state.brief.target_length == 3000


def test_creation_state_with_all_intermediates():
    state = CreationState(
        user_message="Create document",
        complexity_level=2,
        brief=CreationBrief(goal="product intro"),
        asset_map=AssetMap(
            items=[AssetItem(id="1", type="text", content="source content")],
            source_word_count=500,
        ),
        blueprint=CreationBlueprint(
            title="Product Intro",
            sections=[SectionPlan(id="s1", title="Overview", word_budget=500)],
            total_word_budget=500,
        ),
        section_drafts=[
            SectionDraft(section_id="s1", content="Overview content", word_count=480),
        ],
        review_report=ReviewReport(overall_score=90, length_compliance=0.96),
        phase="review",
        final_content="# Product Intro\n\nOverview content",
    )
    assert state.complexity_level == 2
    assert state.brief.goal == "product intro"
    assert state.asset_map.source_word_count == 500
    assert state.blueprint.title == "Product Intro"
    assert len(state.section_drafts) == 1
    assert state.section_drafts[0].word_count == 480
    assert state.review_report.overall_score == 90
    assert state.phase == "review"


def test_creation_state_page_context():
    state = CreationState(
        page_id="page_uuid_123",
        page_title="My Document",
        page_content="Existing content here",
        selected_text="selected portion",
        workspace_id="workspace_uuid_456",
    )
    assert state.page_id == "page_uuid_123"
    assert state.page_title == "My Document"
    assert state.page_content == "Existing content here"
    assert state.selected_text == "selected portion"
    assert state.workspace_id == "workspace_uuid_456"


def test_creation_state_task_tracking():
    state = CreationState(
        task_id="task_abc",
        thread_id="thread_xyz",
        template_id="tmpl_001",
        system_prompt="You are a helpful assistant.",
        template_prompt="Write a {goal} for {audience}.",
    )
    assert state.task_id == "task_abc"
    assert state.thread_id == "thread_xyz"
    assert state.template_id == "tmpl_001"
    assert state.system_prompt == "You are a helpful assistant."
    assert state.template_prompt == "Write a {goal} for {audience}."


def test_creation_state_serialization():
    state = CreationState(
        user_message="Test",
        complexity_level=1,
        brief=CreationBrief(audience="managers", target_length=1000),
        phase="draft",
        task_id="task_001",
    )
    data = state.model_dump()
    restored = CreationState.model_validate(data)
    assert restored.user_message == "Test"
    assert restored.complexity_level == 1
    assert restored.brief is not None
    assert restored.brief.audience == "managers"
    assert restored.phase == "draft"
    assert restored == state


def test_creation_state_conversation_history():
    state = CreationState(
        conversation_history=[
            {"role": "user", "content": "Write a document"},
            {"role": "assistant", "content": "Sure, here's a draft..."},
        ]
    )
    assert len(state.conversation_history) == 2
    assert state.conversation_history[0]["role"] == "user"


def test_creation_state_uploaded_files():
    state = CreationState(
        uploaded_files=[
            {"name": "source.pdf", "url": "https://example.com/source.pdf", "type": "pdf"},
            {"name": "reference.docx", "url": "https://example.com/ref.docx", "type": "docx"},
        ]
    )
    assert len(state.uploaded_files) == 2
    assert state.uploaded_files[0]["name"] == "source.pdf"
