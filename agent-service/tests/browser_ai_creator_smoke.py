from __future__ import annotations

import json
import time

from playwright_ai_creator_utils import (
    build_smoke_context,
    create_authenticated_session,
    open_ai_creator,
    set_prompt_and_send,
    wait_for_editor_ready,
)


def wait_for_response(session, timeout_seconds: int = 90) -> str:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        state = session.eval_json(
            """
(() => ({
  bodyText: document.body?.innerText || '',
  isStreaming:
    (document.body?.innerText || '').includes('AI is writing') ||
    (document.body?.innerText || '').includes('AI 正在写作'),
  hasAwaitingInput:
    (document.body?.innerText || '').includes('AWAITING_INPUT') ||
    (
      (document.body?.innerText || '').includes('Brief') &&
      (document.body?.innerText || '').includes('Needs approval')
    ),
  hasSessionHandle:
    Object.keys(window.sessionStorage).some((key) => key.startsWith('docmost.ai.create.session:'))
}))()
            """.strip(),
            timeout_seconds=30,
        )
        if not isinstance(state, dict):
            raise RuntimeError(f"Unexpected smoke state payload: {state!r}")
        body_text = str(state.get("bodyText") or "")
        if (
            "Create a short technical note" in body_text
            and (
                bool(state.get("isStreaming"))
                or bool(state.get("hasAwaitingInput"))
                or bool(state.get("hasSessionHandle"))
            )
        ):
            return body_text
        time.sleep(1)
    raise TimeoutError("Timed out waiting for AI Creator response activity.")


def run_browser_smoke() -> dict[str, str]:
    context = build_smoke_context("AI Browser Smoke")
    session, client_url, page_url = create_authenticated_session(
        "docmost-smoke",
        context,
        agent_mode=True,
        auto_insert=False,
    )

    try:
        wait_for_editor_ready(session)
        open_ai_creator(session)
        set_prompt_and_send(
            session,
            "Create a short technical note comparing two API approaches. "
            "Use a markdown table and a mermaid flowchart.",
        )

        body_text = wait_for_response(session)
        return {
            "client_url": client_url,
            "page_url": page_url,
            "page_id": context.page_id,
            "result_excerpt": body_text[:1200],
        }
    finally:
        session.close()


if __name__ == "__main__":
    result = run_browser_smoke()
    print(json.dumps(result, ensure_ascii=True, indent=2))
