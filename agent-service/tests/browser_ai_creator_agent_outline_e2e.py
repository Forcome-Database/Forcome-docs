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
    return f"""Use deep mode to create a short technical note.

No external research, browsing, crawling, knowledge search, or image generation is needed.
Do not call external tools unless the workflow cannot continue without them.
Use only the request below and the current empty page context.

You must provide an outline for approval before the final draft.

The final markdown must include:
- a level-2 heading named `{marker}`
- at least one markdown table
- at least one mermaid block

Keep the draft concise and markdown only.
"""


def get_run_state(session) -> dict[str, object]:
    state = session.eval_json(
        """
(() => {
  const bodyText = document.body?.innerText || '';
  const bubbles = Array.from(document.querySelectorAll('[class*="messageAiBubble"]'));
  const latestMatchingBubble = (matcher) =>
    [...bubbles].reverse().find((bubble) => matcher(bubble)) || null;
  const getTextButtons = (bubble) =>
    Array.from(bubble.querySelectorAll('button'))
      .map((button) => (button.innerText || '').trim())
      .filter(Boolean);
  const countCards = (bubble) =>
    Array.from(bubble.querySelectorAll('div')).filter((node) =>
      (node.getAttribute('style') || '').includes('cursor: pointer')
    ).length;
  const clarifyBubble = latestMatchingBubble((bubble) => {
    const textButtons = getTextButtons(bubble);
    return !!bubble.querySelector('textarea') && textButtons.length === 1 && countCards(bubble) === 0;
  });
  const proposeBubble = latestMatchingBubble((bubble) => {
    const textButtons = getTextButtons(bubble);
    return !!bubble.querySelector('textarea') && textButtons.length === 1 && countCards(bubble) > 0;
  });
  const outlineBubble = latestMatchingBubble((bubble) => getTextButtons(bubble).length === 3);
  const actionButtons = document.querySelectorAll('[class*="messageActions"] button').length;
  const isStreaming = bodyText.includes('AI is writing') || bodyText.includes('AI 正在写作');
  return {
    bodyText,
    actionButtons,
    isStreaming,
    hasClarify: !!clarifyBubble,
    hasPropose: !!proposeBubble,
    hasOutline: !!outlineBubble,
  };
})()
        """.strip(),
        timeout_seconds=30,
    )
    if not isinstance(state, dict):
        raise RuntimeError(f"Unexpected Playwright state payload: {state!r}")
    return state


def answer_clarify(session) -> None:
    answer = json.dumps(
        "Audience: engineers. Keep it minimal. "
        "Do not add introduction or conclusion. "
        "Use exactly the requested heading, one table, and one mermaid block."
    )
    session.run_code(
        f"""
async (page) => {{
  await page.evaluate((answer) => {{
    const bubbles = Array.from(document.querySelectorAll('[class*="messageAiBubble"]'));
    const bubble = [...bubbles].reverse().find((node) => {{
      const textButtons = Array.from(node.querySelectorAll('button'))
        .map((button) => (button.innerText || '').trim())
        .filter(Boolean);
      const cards = Array.from(node.querySelectorAll('div')).filter((div) =>
        (div.getAttribute('style') || '').includes('cursor: pointer')
      );
      return !!node.querySelector('textarea') && textButtons.length === 1 && cards.length === 0;
    }});
    if (!bubble) {{
      throw new Error('Clarify bubble not found');
    }}
    const textarea = bubble.querySelector('textarea');
    const submit = bubble.querySelector('button');
    if (!textarea || !submit) {{
      throw new Error('Clarify controls not found');
    }}
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    )?.set;
    if (!setter) {{
      throw new Error('Textarea value setter not found');
    }}
    setter.call(textarea, answer);
    textarea.dispatchEvent(new Event('input', {{ bubbles: true }}));
    textarea.dispatchEvent(new Event('change', {{ bubbles: true }}));
    submit.click();
  }}, {answer});
}}
        """.strip(),
        timeout_seconds=60,
    )


def select_first_proposal(session) -> None:
    session.run_code(
        """
async (page) => {
  await page.evaluate(() => {
    const bubbles = Array.from(document.querySelectorAll('[class*="messageAiBubble"]'));
    const bubble = [...bubbles].reverse().find((node) => {
      const textButtons = Array.from(node.querySelectorAll('button'))
        .map((button) => (button.innerText || '').trim())
        .filter(Boolean);
      const cards = Array.from(node.querySelectorAll('div')).filter((div) =>
        (div.getAttribute('style') || '').includes('cursor: pointer')
      );
      return !!node.querySelector('textarea') && textButtons.length === 1 && cards.length > 0;
    });
    if (!bubble) {
      throw new Error('Proposal bubble not found');
    }
    const cards = Array.from(bubble.querySelectorAll('div')).filter((div) =>
      (div.getAttribute('style') || '').includes('cursor: pointer')
    );
    const confirm = Array.from(bubble.querySelectorAll('button')).find((button) =>
      ((button.innerText || '').trim().length > 0)
    );
    if (!cards.length || !confirm) {
      throw new Error('Proposal controls not found');
    }
    cards[0].click();
    confirm.click();
  });
}
        """.strip(),
        timeout_seconds=60,
    )


def confirm_outline(session) -> None:
    session.run_code(
        """
async (page) => {
  await page.evaluate(() => {
    const bubbles = Array.from(document.querySelectorAll('[class*="messageAiBubble"]'));
    const bubble = [...bubbles].reverse().find((node) => {
      const textButtons = Array.from(node.querySelectorAll('button'))
        .map((button) => (button.innerText || '').trim())
        .filter(Boolean);
      return textButtons.length === 3;
    });
    if (!bubble) {
      throw new Error('Outline bubble not found');
    }
    const buttons = Array.from(bubble.querySelectorAll('button')).filter((button) =>
      ((button.innerText || '').trim().length > 0)
    );
    if (buttons.length !== 3) {
      throw new Error('Outline controls not found');
    }
    buttons[1].click();
  });
}
        """.strip(),
        timeout_seconds=60,
    )


def wait_for_final_agent_content(session, marker: str, timeout_seconds: int = 480) -> str:
    deadline = time.time() + timeout_seconds
    outline_excerpt = ""
    handled_stages: set[str] = set()
    last_state: dict[str, object] | None = None

    while time.time() < deadline:
        state = get_run_state(session)
        last_state = state
        body_text = str(state.get("bodyText") or "")

        if state.get("hasClarify") and "clarify" not in handled_stages:
            answer_clarify(session)
            handled_stages.add("clarify")
            time.sleep(2)
            continue

        if state.get("hasPropose") and "propose" not in handled_stages:
            select_first_proposal(session)
            handled_stages.add("propose")
            time.sleep(2)
            continue

        if state.get("hasOutline") and "outline" not in handled_stages:
            outline_excerpt = body_text[:1200]
            confirm_outline(session)
            handled_stages.add("outline")
            time.sleep(2)
            continue

        if (
            "outline" in handled_stages
            and int(state.get("actionButtons") or 0) >= 2
            and not bool(state.get("isStreaming"))
        ):
            return outline_excerpt or body_text[:1200]

        time.sleep(2)

    raise TimeoutError(
        "Timed out waiting for the agent clarify/propose/outline flow to reach final content.\n"
        + json.dumps(last_state or {}, ensure_ascii=False, indent=2)
    )


def wait_for_persisted_markdown(
    page_id: str,
    token: str,
    marker: str,
    timeout_seconds: int = 240,
) -> str:
    deadline = time.time() + timeout_seconds
    last_markdown = ""

    while time.time() < deadline:
        markdown = fetch_page_markdown(page_id, token)
        last_markdown = markdown
        if (
            markdown != "# Browser Smoke\n\nInitial content."
            and "```mermaid" in markdown
            and "| --- |" in markdown
        ):
            return markdown
        time.sleep(3)

    raise TimeoutError(
        "Timed out waiting for persisted markdown.\n"
        + last_markdown[:1600]
    )


def run_agent_outline_e2e() -> dict[str, object]:
    context = build_smoke_context("PW Agent Outline")
    marker = "Agent Outline E2E Marker " + datetime.now().strftime("%Y%m%d-%H%M%S")
    prompt = build_prompt(marker)
    session, client_url, page_url = create_authenticated_session(
        "docmost-agent-outline",
        context,
        agent_mode=True,
        auto_insert=False,
    )

    try:
        wait_for_editor_ready(session)
        open_ai_creator(session)
        set_prompt_and_send(session, prompt)

        outline_excerpt = wait_for_final_agent_content(session, marker)
        click_insert_to_editor(session)

        persisted_markdown = wait_for_persisted_markdown(
            context.page_id,
            context.token,
            marker,
        )
        browser_state = wait_for_editor_artifacts(
            session,
            marker,
            require_marker=False,
        )

        return {
            "client_url": client_url,
            "page_url": page_url,
            "page_id": context.page_id,
            "marker": marker,
            "outline_excerpt": outline_excerpt,
            "browser_state": browser_state,
            "persisted_excerpt": persisted_markdown[:1600],
        }
    finally:
        session.close()


if __name__ == "__main__":
    result = run_agent_outline_e2e()
    print(json.dumps(result, ensure_ascii=True, indent=2))
