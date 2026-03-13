from app.agent.document_strategy import (
    derive_visual_requirements,
    format_document_strategy,
    normalize_document_plan,
)
from app.agent.graph import route_after_explorer, route_after_reviewer, route_after_router
from app.agent.nodes.explorer import build_source_first_plan, should_skip_research_planning
from app.agent.quality_checks import evaluate_document_quality
from app.agent.nodes.reviewer import parse_review_result
from app.agent.nodes.writer import format_research_context_item


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


def test_should_skip_research_planning_for_document_transforms():
    state = {
        "user_message": "Optimize the uploaded document formatting",
        "uploaded_files": [{"filename": "spec.pdf"}],
        "intent_route": "document_transform",
    }

    assert should_skip_research_planning(state) is True


def test_build_source_first_plan_prefers_parsing_uploaded_files():
    state = {
        "uploaded_files": [{"filename": "spec.pdf"}],
        "page_id": "page-1",
        "page_content": "existing content",
        "selected_text": "",
    }

    plan = build_source_first_plan(state)

    assert plan == [
        {
            "step_id": 1,
            "action": "parse",
            "description": "解析用户上传的源文档并提取关键信息",
            "tool": "docling_parser",
            "args": {},
            "status": "pending",
        }
    ]


def test_graph_routes_selection_edit_directly_to_writer():
    assert route_after_router({"intent_route": "selection_edit"}) == "writer"
    assert route_after_explorer({"intent_route": "document_transform"}) == "writer"
    assert route_after_explorer({"intent_route": "document_create"}) == "clarifier"


def test_parse_review_result_falls_back_on_invalid_json():
    result = parse_review_result("not-json", "draft")

    assert result["summary"] == "Quality review completed"
    assert result["revised_content"] == "draft"


def test_format_document_strategy_includes_editor_hints():
    text = format_document_strategy(
        {
            "docType": "report",
            "audience": "stakeholders",
            "intentRoute": "document_transform",
            "scope": "uploaded_document",
            "sourcePolicy": "preserve_source",
            "lengthPolicy": "preserve",
            "prioritizeUserInstructions": True,
        }
    )

    assert "Document type: report" in text
    assert "Editor syntax hints:" in text
    assert "Intent route: document_transform" in text
    assert "User instructions have highest priority: yes" in text


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


def test_evaluate_document_quality_flags_unresolved_artifact_placeholders():
    result = evaluate_document_quality(
        "# Quick Start\n\n- [Artifact: code_block]\n- [Artifact: table]",
        {},
        {},
    )

    assert result["needs_rewrite"] is True
    assert any("placeholder" in issue.lower() for issue in result["issues"])


def test_format_research_context_item_keeps_headings_and_urls_beyond_excerpt():
    long_intro = "intro " * 900
    content = (
        long_intro
        + "\n## macOS\nbrew install cliproxyapi\n"
        + "\n## Windows\n"
        + "Binary: https://help.router-for.me/downloads/cliproxyapi.exe\n"
        + "EasyCLI: https://help.router-for.me/downloads/easycli.exe\n"
    )

    formatted = format_research_context_item(
        {
            "source": "reference_url",
            "url": "https://help.router-for.me/cn/introduction/quick-start.html",
            "content": content,
        }
    )

    assert "Source headings:" in formatted
    assert "Windows" in formatted
    assert "Source URLs:" in formatted
    assert "https://help.router-for.me/downloads/cliproxyapi.exe" in formatted
    assert "https://help.router-for.me/downloads/easycli.exe" in formatted


def test_route_after_reviewer_retries_when_quality_gate_fails():
    assert route_after_reviewer({"needs_revision": True, "iteration_count": 1, "max_iterations": 3}) == "writer"
    assert route_after_reviewer({"needs_revision": True, "iteration_count": 3, "max_iterations": 3}) == "done"
    assert route_after_reviewer({"needs_revision": False, "iteration_count": 1, "max_iterations": 3}) == "done"
