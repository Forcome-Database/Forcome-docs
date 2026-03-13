from __future__ import annotations

import json
import time
from datetime import datetime

import requests
from DrissionPage import Chromium

from browser_ai_creator_smoke import (
    CLIENT_URL,
    SERVER_URL,
    build_smoke_context,
    find_ai_creator_button,
)


def unwrap_data(payload: dict) -> dict:
    if isinstance(payload, dict) and "data" in payload:
        return payload["data"]
    return payload


def ensure_client_origin(tab, timeout_seconds: int = 20) -> None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        current_url = str(tab.url or "")
        if current_url.startswith(CLIENT_URL):
            return
        tab.get(CLIENT_URL)
        time.sleep(1)
    raise TimeoutError(f"Timed out loading client origin: {CLIENT_URL}")


def set_creator_preferences(tab, *, agent_mode: bool, auto_insert: bool) -> None:
    ensure_client_origin(tab)
    tab.run_js(
        f"""
        localStorage.setItem('aiAgentMode', {json.dumps("true" if agent_mode else "false")});
        localStorage.setItem('aiAutoInsert', {json.dumps("true" if auto_insert else "false")});
        """
    )


def wait_for_editor_ready(tab, timeout_seconds: int = 30) -> None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        if tab.ele("css:.editor-container .ProseMirror"):
            return
        time.sleep(1)
    raise TimeoutError("Timed out waiting for the editor to become available.")


def set_prompt_value(tab, prompt: str) -> None:
    result = tab.run_js(
        f"""
        const textarea = document.querySelector('textarea[data-ai-input]');
        if (!textarea) return null;
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value',
        ).set;
        setter.call(textarea, {json.dumps(prompt)});
        textarea.dispatchEvent(new Event('input', {{ bubbles: true }}));
        textarea.dispatchEvent(new Event('change', {{ bubbles: true }}));
        return textarea.value;
        """
    )
    if result != prompt:
        raise RuntimeError("Failed to populate the AI Creator prompt.")


def find_send_button(tab, textarea) -> object:
    deadline = time.time() + 15
    while time.time() < deadline:
        try:
            tx, ty = textarea.rect.viewport_location
            tw, th = textarea.rect.size
        except Exception:
            time.sleep(1)
            continue

        candidates = []
        for button in tab.eles("xpath://button"):
            try:
                x, y = button.rect.viewport_location
                width, height = button.rect.size
            except Exception:
                continue

            if (
                y >= ty
                and y <= ty + th + 90
                and x >= tx + tw - 120
                and 20 <= width <= 40
                and 20 <= height <= 40
            ):
                candidates.append((x, button))

        if candidates:
            candidates.sort(key=lambda item: item[0], reverse=True)
            return candidates[0][1]

        time.sleep(1)

    raise RuntimeError("Could not locate the AI Creator send button.")


def fetch_page_markdown(page_id: str, token: str) -> str:
    session = requests.Session()
    session.cookies.set("authToken", token)
    response = session.post(
        f"{SERVER_URL}/api/pages/info",
        json={"pageId": page_id, "format": "markdown"},
        timeout=30,
    )
    response.raise_for_status()
    payload = unwrap_data(response.json())
    return str(payload.get("content") or "")


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


def wait_for_editor_artifacts(
    tab,
    marker: str,
    timeout_seconds: int = 90,
) -> dict[str, bool]:
    deadline = time.time() + timeout_seconds
    last_state = {
        "has_marker": False,
        "has_table": False,
        "has_mermaid_svg": False,
    }

    while time.time() < deadline:
        editor_text = tab.run_js(
            """
            const editor = document.querySelector('.editor-container .ProseMirror');
            return editor ? editor.innerText : '';
            """
        ) or ""
        last_state = {
            "has_marker": marker in editor_text,
            "has_table": bool(tab.ele("css:.editor-container .ProseMirror table")),
            "has_mermaid_svg": bool(tab.ele("css:.editor-container .ProseMirror .mermaid svg")),
            "has_mermaid_code": "Client --> Server" in editor_text,
        }
        if (
            last_state["has_marker"]
            and last_state["has_table"]
            and (
                last_state["has_mermaid_svg"]
                or last_state["has_mermaid_code"]
            )
        ):
            return last_state
        time.sleep(2)

    raise TimeoutError(
        "Timed out waiting for browser artifacts: "
        + json.dumps(last_state, ensure_ascii=False)
    )


def wait_for_assistant_result(tab, marker: str, timeout_seconds: int = 120) -> None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        state = tab.run_js(
            """
            const bodyText = document.body?.innerText || '';
            const actionButtons = Array.from(
              document.querySelectorAll('[class*="messageActions"] button')
            ).length;
            const isStreaming = bodyText.includes('AI is writing') || bodyText.includes('AI 正在写作');
            return { bodyText, actionButtons, isStreaming };
            """
        ) or {}

        body_text = str(state.get("bodyText") or "")
        action_buttons = int(state.get("actionButtons") or 0)
        is_streaming = bool(state.get("isStreaming"))

        if marker in body_text and action_buttons >= 2 and not is_streaming:
            return
        time.sleep(2)

    raise TimeoutError(f"Timed out waiting for assistant result containing {marker}.")


def click_insert_to_editor(tab) -> None:
    clicked = tab.run_js(
        """
        const groups = Array.from(document.querySelectorAll('[class*="messageActions"]'));
        const lastGroup = groups.at(-1);
        if (!lastGroup) return false;
        const buttons = Array.from(lastGroup.querySelectorAll('button'));
        if (buttons.length < 2) return false;
        buttons[1].click();
        return true;
        """
    )
    if not clicked:
        raise RuntimeError("Could not click the AI Creator insert-to-editor action.")


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


def run_insert_e2e() -> dict[str, object]:
    context = build_smoke_context()
    marker = "Browser E2E Marker " + datetime.now().strftime("%Y%m%d-%H%M%S")
    prompt = build_prompt(marker)
    browser = Chromium()

    try:
        tab = browser.latest_tab
        tab.get(CLIENT_URL)
        time.sleep(2)
        tab.set.cookies(
            {
                "name": "authToken",
                "value": context.token,
                "domain": "localhost",
                "path": "/",
            }
        )
        tab.refresh()
        time.sleep(2)
        ensure_client_origin(tab)
        set_creator_preferences(tab, agent_mode=False, auto_insert=False)
        time.sleep(1)

        page_url = f"{CLIENT_URL}/s/{context.space_slug}/p/{context.page_slug}"
        tab.get(page_url)
        wait_for_editor_ready(tab)

        ai_button = find_ai_creator_button(tab)
        ai_button.click()
        tab.wait.ele_displayed("text=AI Assistant", timeout=15)

        textarea = tab.ele("css:textarea[data-ai-input]")
        set_prompt_value(tab, prompt)
        send_button = find_send_button(tab, textarea)
        send_button.click()

        wait_for_assistant_result(tab, marker)
        click_insert_to_editor(tab)

        persisted_markdown = wait_for_persisted_markdown(
            context.page_id,
            context.token,
            marker,
        )
        browser_state = wait_for_editor_artifacts(tab, marker)

        return {
            "page_url": page_url,
            "page_id": context.page_id,
            "marker": marker,
            "browser_state": browser_state,
            "persisted_excerpt": persisted_markdown[:1200],
        }
    finally:
        browser.quit()


if __name__ == "__main__":
    result = run_insert_e2e()
    print(json.dumps(result, ensure_ascii=False, indent=2))
