from __future__ import annotations

import json

from app.orchestrator.llm_result import extract_text_output


class _FakeStructuredValue:
    def model_dump(self) -> dict[str, object]:
        return {"message": "structured"}


class _FakeRunResult:
    def __init__(
        self,
        *,
        output: object | None = None,
        data: object | None = None,
        string_value: str = "AgentRunResult(output='wrapped')",
    ):
        self.output = output
        self.data = data
        self._string_value = string_value

    def __str__(self) -> str:
        return self._string_value


def test_extract_text_output_prefers_output_text_over_wrapper_repr():
    result = _FakeRunResult(
        output="Expected plain markdown",
        data="Legacy data text",
        string_value="AgentRunResult(output='Expected plain markdown')",
    )

    assert extract_text_output(result) == "Expected plain markdown"


def test_extract_text_output_falls_back_to_string_data():
    result = _FakeRunResult(output=None, data="Fallback data text")

    assert extract_text_output(result) == "Fallback data text"


def test_extract_text_output_serializes_structured_values_before_repr():
    result = _FakeRunResult(output=_FakeStructuredValue(), data=None)

    assert extract_text_output(result) == json.dumps({"message": "structured"}, ensure_ascii=False)


def test_extract_text_output_uses_str_as_last_resort():
    result = _FakeRunResult(output=None, data=None, string_value="raw string repr")

    assert extract_text_output(result) == "raw string repr"
