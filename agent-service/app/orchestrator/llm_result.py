from __future__ import annotations

import json
from typing import Any


def _coerce_value(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if hasattr(value, "model_dump_json"):
        candidate = value.model_dump_json()
        if isinstance(candidate, str):
            return candidate
    if hasattr(value, "model_dump"):
        candidate = value.model_dump()
        if isinstance(candidate, (dict, list, tuple, int, float, bool)) or candidate is None:
            return json.dumps(candidate, ensure_ascii=False)
    return None


def extract_text_output(result: Any) -> str:
    for attr in ("output", "data"):
        coerced = _coerce_value(getattr(result, attr, None))
        if coerced is not None:
            return coerced
    return str(result)
