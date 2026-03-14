import json
from app.models.events import (
    StepEvent, ContentEvent, InteractionEvent,
    SectionProgressEvent, CompletionEvent, ComplexityEvent,
    serialize_event,
)


def test_step_event_start():
    event = StepEvent(type="step_start", step_name="analyze", description="Analyzing content")
    assert event.type == "step_start"
    assert event.step_name == "analyze"
    assert event.result_summary == ""


def test_step_event_done():
    event = StepEvent(type="step_done", step_name="analyze", result_summary="Found 3 sections")
    assert event.type == "step_done"
    assert event.result_summary == "Found 3 sections"


def test_content_event_delta():
    event = ContentEvent(type="content_delta", chunk="Hello world", section_id="sec_001")
    assert event.type == "content_delta"
    assert event.chunk == "Hello world"
    assert event.section_id == "sec_001"


def test_content_event_cleared():
    event = ContentEvent(type="content_cleared")
    assert event.type == "content_cleared"
    assert event.chunk == ""
    assert event.section_id is None


def test_interaction_event():
    event = InteractionEvent(
        type="await_user_input",
        phase="brief",
        data={"audience": "请确认受众", "goal": "请描述目标"},
    )
    assert event.type == "await_user_input"
    assert event.phase == "brief"
    assert "audience" in event.data


def test_section_progress_event():
    event = SectionProgressEvent(type="section_progress", current=2, total=5, section_title="Introduction")
    assert event.type == "section_progress"
    assert event.current == 2
    assert event.total == 5
    assert event.section_title == "Introduction"


def test_completion_event_done():
    event = CompletionEvent(type="done", final_content="# Result\nContent here")
    assert event.type == "done"
    assert event.final_content == "# Result\nContent here"
    assert event.error_message == ""


def test_completion_event_error():
    event = CompletionEvent(type="error", error_message="LLM timeout")
    assert event.type == "error"
    assert event.error_message == "LLM timeout"


def test_complexity_event():
    event = ComplexityEvent(type="complexity_analyzed", level=2, reasoning="Medium length document")
    assert event.type == "complexity_analyzed"
    assert event.level == 2
    assert event.reasoning == "Medium length document"


def test_serialize_event_step():
    event = StepEvent(type="step_start", step_name="plan", description="Planning")
    serialized = serialize_event(event)
    data = json.loads(serialized)
    assert data["type"] == "step_start"
    assert data["step_name"] == "plan"


def test_serialize_event_content():
    event = ContentEvent(type="content_delta", chunk="Hello", section_id="s1")
    serialized = serialize_event(event)
    data = json.loads(serialized)
    assert data["type"] == "content_delta"
    assert data["chunk"] == "Hello"


def test_serialize_event_completion():
    event = CompletionEvent(type="done", final_content="# Doc")
    serialized = serialize_event(event)
    data = json.loads(serialized)
    assert data["type"] == "done"


def test_serialize_event_returns_string():
    event = ComplexityEvent(type="complexity_analyzed", level=1)
    result = serialize_event(event)
    assert isinstance(result, str)
    assert json.loads(result)  # valid JSON
