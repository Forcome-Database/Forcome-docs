from app.agent.document_strategy import (
    derive_visual_requirements,
    format_document_strategy,
    normalize_document_plan,
)
from app.agent.nodes.reviewer import parse_review_result


def test_normalize_document_plan_uses_strategy_defaults():
    strategy = {
        "docType": "technical-documentation",
        "audience": "engineers",
        "requiredSections": ["overview", "workflow"],
        "requiredArtifacts": ["code_block"],
    }

    plan = normalize_document_plan({}, strategy)

    assert plan["doc_type"] == "technical-documentation"
    assert plan["required_artifacts"] == ["code_block"]
    assert [section["title"] for section in plan["sections"]] == ["overview", "workflow"]


def test_derive_visual_requirements_detects_mermaid_and_table():
    state = {
        "user_message": "Compare two API designs and explain the workflow with a sequence diagram",
        "document_strategy": {},
    }

    requirements = derive_visual_requirements(state)

    assert "table" in requirements
    assert "mermaid" in requirements


def test_parse_review_result_falls_back_on_invalid_json():
    result = parse_review_result("not-json", "draft")

    assert result["summary"] == "Quality review completed"
    assert result["revised_content"] == "draft"


def test_format_document_strategy_includes_editor_hints():
    text = format_document_strategy({"docType": "report", "audience": "stakeholders"})

    assert "Document type: report" in text
    assert "Editor syntax hints:" in text
