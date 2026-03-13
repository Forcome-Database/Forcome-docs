from app.agent.events import emit
from app.agent.state import AgentState


def _format_failure(item: dict) -> str:
    kind = item.get("kind", "unknown")
    source = item.get("source", kind)
    error = item.get("error") or "Evidence acquisition failed."
    return f"{kind} ({source}): {error}"


async def evidence_gate_node(state: AgentState) -> dict:
    failures = [
        item
        for item in state.get("evidence_items", [])
        if item.get("required") and item.get("status") != "success"
    ]

    if not failures:
        return {
            "phase": "evidence_gate",
            "blocked_reason": "",
        }

    message = "Required evidence is unavailable:\n" + "\n".join(
        f"- {_format_failure(item)}" for item in failures
    )
    await emit(
        state.get("_thread_id", ""),
        {
            "type": "blocked",
            "message": message,
        },
    )
    return {
        "phase": "blocked",
        "blocked_reason": message,
    }
