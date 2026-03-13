import json
from pathlib import Path

import pytest

from app.agent.quality_checks import evaluate_document_quality


FIXTURE_PATH = (
    Path(__file__).parent / "fixtures" / "document_quality_eval_cases.json"
)


def _load_cases():
    with FIXTURE_PATH.open("r", encoding="utf-8") as handle:
        return json.load(handle)


@pytest.mark.parametrize(
    "case",
    _load_cases(),
    ids=lambda case: case["name"],
)
def test_document_quality_eval_cases(case):
    result = evaluate_document_quality(
        case["draft"],
        case.get("strategy"),
        case.get("document_plan"),
    )
    expected = case["expected"]

    assert result["needs_rewrite"] is expected["needs_rewrite"]

    for artifact in expected.get("missing_artifacts", []):
        assert artifact in result["missing_artifacts"]

    for section in expected.get("missing_sections", []):
        assert any(
            section.lower() == missing.lower()
            for missing in result["missing_sections"]
        )
