from app.agent.document_strategy import (
    derive_visual_requirements,
    format_document_strategy,
    normalize_document_plan,
)
from app.agent.quality_checks import evaluate_document_quality
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


def test_evaluate_document_quality_flags_missing_required_artifacts_and_sections():
    strategy = {
        "requiredArtifacts": ["table", "mermaid"],
        "requiredSections": ["overview", "workflow"],
    }
    document_plan = {
        "required_artifacts": ["table", "mermaid"],
        "sections": [{"title": "Overview"}, {"title": "Workflow"}],
    }

    result = evaluate_document_quality(
        "# Overview\n\nOnly prose here without the required structures.",
        strategy,
        document_plan,
    )

    assert result["needs_rewrite"] is True
    assert "table" in result["missing_artifacts"]
    assert "mermaid" in result["missing_artifacts"]
    assert "Workflow" in result["missing_sections"]


def test_evaluate_document_quality_accepts_required_sections_and_artifacts():
    strategy = {
        "requiredArtifacts": ["table", "mermaid"],
        "requiredSections": ["overview", "workflow"],
    }
    document_plan = {
        "required_artifacts": ["table", "mermaid"],
        "sections": [{"title": "Overview"}, {"title": "Workflow"}],
    }
    draft = """# Overview

| Option | Value |
| --- | --- |
| A | B |

## Workflow

```mermaid
flowchart TD
  A --> B
```
"""

    result = evaluate_document_quality(draft, strategy, document_plan)

    assert result["needs_rewrite"] is False
    assert result["missing_artifacts"] == []
    assert result["missing_sections"] == []
