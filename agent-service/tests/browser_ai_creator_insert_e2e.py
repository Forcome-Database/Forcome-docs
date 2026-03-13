from __future__ import annotations

import json
import time
from datetime import datetime

from playwright_ai_creator_utils import (
    build_smoke_context,
    click_insert_to_editor,
    create_authenticated_session,
    fetch_page_markdown,
    open_ai_creator,
    set_prompt_and_send,
    wait_for_editor_artifacts,
    wait_for_editor_ready,
)


def build_prompt(marker: str) -> str:
    return f"""Return only markdown. Do not add any explanation.

Write a short technical note with exactly these required structures:
1. A level-2 heading titled `{marker}`
2. A markdown table with columns `Approach` and `Note`
3. A mermaid code block containing `Client --> Server`

Use this exact content:

## {marker}

| Approach | Note |
| --- | --- |
| API A | Simple |
| API B | Flexible |

```mermaid
flowchart TD
  Client --> Server
```
"""


def wait_for_assistant_result(session, marker: str, timeout_seconds: int = 120) -> None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        state = session.eval_json(
            """
(() => ({
  bodyText: document.body?.innerText || '',
  actionButtons: document.querySelectorAll('[class*="messageActions"] button').length,
  isStreaming:
    (document.body?.innerText || '').includes('AI is writing') ||
    (document.body?.innerText || '').includes('AI 正在写作')
}))()
            """.strip(),
            timeout_seconds=30,
        )
        if not isinstance(state, dict):
            raise RuntimeError(f"Unexpected insert state payload: {state!r}")

        body_text = str(state.get("bodyText") or "")
        if (
            marker in body_text
            and int(state.get("actionButtons") or 0) >= 2
            and not bool(state.get("isStreaming"))
        ):
            return
        time.sleep(2)

    raise TimeoutError(f"Timed out waiting for assistant result containing {marker}.")


def wait_for_persisted_markdown(
    page_id: str,
    token: str,
    marker: str,
    timeout_seconds: int = 180,
) -> str:
    deadline = time.time() + timeout_seconds
    last_markdown = ""

    while time.time() < deadline:
        markdown = fetch_page_markdown(page_id, token)
        last_markdown = markdown
        if (
            marker in markdown
            and "| Approach | Note |" in markdown
            and "```mermaid" in markdown
            and "Client --> Server" in markdown
        ):
            return markdown
        time.sleep(3)

    raise TimeoutError(
        "Timed out waiting for persisted markdown.\n"
        + last_markdown[:1200]
    )


def run_insert_e2e() -> dict[str, object]:
    context = build_smoke_context("AI Browser Smoke")
    marker = "Browser E2E Marker " + datetime.now().strftime("%Y%m%d-%H%M%S")
    prompt = build_prompt(marker)
    session, client_url, page_url = create_authenticated_session(
        "docmost-insert",
        context,
        agent_mode=False,
        auto_insert=False,
    )

    try:
        wait_for_editor_ready(session)
        open_ai_creator(session)
        set_prompt_and_send(session, prompt)

        wait_for_assistant_result(session, marker)
        click_insert_to_editor(session)

        persisted_markdown = wait_for_persisted_markdown(
            context.page_id,
            context.token,
            marker,
        )
        browser_state = wait_for_editor_artifacts(session, marker)

        return {
            "client_url": client_url,
            "page_url": page_url,
            "page_id": context.page_id,
            "marker": marker,
            "browser_state": browser_state,
            "persisted_excerpt": persisted_markdown[:1200],
        }
    finally:
        session.close()


if __name__ == "__main__":
    result = run_insert_e2e()
    print(json.dumps(result, ensure_ascii=True, indent=2))
