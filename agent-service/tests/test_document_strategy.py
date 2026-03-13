from app.agent.document_strategy import (
    derive_visual_requirements,
    format_document_strategy,
    normalize_document_plan,
)
from app.agent.nodes.explorer import should_skip_research_planning
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


def test_normalize_document_plan_normalizes_evidence_aliases():
    plan = normalize_document_plan(
        {
            "sections": [
                {
                    "title": "Workflow",
                    "goal": "Explain the workflow",
                    "artifacts": ["mermaid", "unknown"],
                    "must_cover": ["resume flow"],
                    "evidence": ["search", "knowledge_base", "image_generation", "vision"],
                }
            ]
        }
    )

    assert plan["sections"] == [
        {
            "id": "section-1",
            "title": "Workflow",
            "goal": "Explain the workflow",
            "artifacts": ["mermaid"],
            "must_cover": ["resume flow"],
            "evidence": [
                "web_search",
                "knowledge_search",
                "generated_image",
                "vision",
            ],
        }
    ]


def test_derive_visual_requirements_detects_mermaid_and_table():
    state = {
        "user_message": "Compare two API designs and explain the workflow with a sequence diagram",
        "document_strategy": {},
    }

    requirements = derive_visual_requirements(state)

    assert "table" in requirements
    assert "mermaid" in requirements


def test_should_skip_research_planning_when_prompt_explicitly_disables_external_research():
    state = {
        "user_message": (
            "No external research is needed. "
            "Do not call external tools and use only the request below."
        ),
        "uploaded_files": [],
    }

    assert should_skip_research_planning(state) is True


def test_should_not_skip_research_planning_when_files_are_uploaded():
    state = {
        "user_message": "No external research is needed.",
        "uploaded_files": [{"filename": "spec.pdf"}],
    }

    assert should_skip_research_planning(state) is False


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


def test_evaluate_document_quality_flags_missing_required_coverage_points():
    strategy = {
        "objectives": ["compare authentication latency", "document rollback handling"],
        "requiredSections": ["overview"],
    }
    document_plan = {
        "sections": [
            {
                "title": "Overview",
                "must_cover": ["compare authentication latency", "document rollback handling"],
            }
        ]
    }
    draft = """# Overview

This note compares maintainability tradeoffs between two approaches.
"""

    result = evaluate_document_quality(draft, strategy, document_plan)

    assert result["needs_rewrite"] is True
    assert "compare authentication latency" in result["missing_coverage"]
    assert "document rollback handling" in result["missing_coverage"]


def test_evaluate_document_quality_flags_generic_prose_regression():
    strategy = {
        "objectives": ["include rollback steps", "document verification checks"],
    }
    document_plan = {"sections": []}
    draft = (
        "This document provides a general overview of the solution and discusses several "
        "important considerations for implementation. The approach is flexible and should "
        "be adapted as appropriate for the environment. Stakeholders should review the "
        "details carefully and align on the next steps before rollout. The system is "
        "designed to support a broad range of use cases and can be extended in different "
        "ways over time. Teams should think about process, communication, planning, and "
        "operational readiness when deciding how to adopt the change. This document also "
        "highlights that best practices may evolve, and it is useful to keep the guidance "
        "high level until future requirements become clearer. Overall, the recommendation "
        "is to proceed thoughtfully, capture lessons learned, and refine execution as the "
        "implementation moves forward."
    )

    result = evaluate_document_quality(draft, strategy, document_plan)

    assert result["needs_rewrite"] is True
    assert any("generic prose" in issue.lower() for issue in result["issues"])


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
