from __future__ import annotations

import json
import time
from datetime import datetime

import requests

from playwright_ai_creator_utils import (
    SERVER_URL,
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
    return f"""Use deep mode to create a concise technical note.

No external research, browsing, crawling, knowledge search, or image generation is needed.
Do not call external tools unless the workflow cannot continue without them.
Use only the request below and the current empty page context.

Use the AI creator workbench checkpoints before the final draft, but keep those checkpoints internal.
Do not create a separate "checkpoint" section in the final markdown.
Do not wrap the final markdown in tool traces, result objects, quotes, or explanations.

The final markdown must include:
- a level-2 heading named `{marker}`
- at least one markdown table
- at least one mermaid block
- one short paragraph comparing the two structures in plain prose

Aim for roughly 250 to 350 words.
Keep the draft concise and markdown only.
"""


def get_run_state(session) -> dict[str, object]:
    state = session.eval_json(
        """
(() => {
  const bodyText = document.body?.innerText || '';
  const allButtons = Array.from(document.querySelectorAll('button'))
    .map((button) => ({
      text: (button.innerText || '').trim(),
      disabled: !!button.disabled,
    }))
    .filter((button) => button.text.length > 0);
  const actionButtons = document.querySelectorAll('[class*="messageActions"] button').length;
  const isStreaming = bodyText.includes('AI is writing') || bodyText.includes('AI 正在写作');
  const status = ['AWAITING_INPUT', 'RUNNING', 'BLOCKED', 'COMPLETED', 'ERROR']
    .find((value) => bodyText.includes(value)) || null;
  return {
    bodyText,
    status,
    allButtons,
    actionButtons,
    isStreaming,
    hasBriefApproval:
      bodyText.includes('Brief') &&
      bodyText.includes('Needs approval') &&
      allButtons.some((button) => /Confirm and continue|确认开始/.test(button.text)),
    hasBlueprintApproval: allButtons.some((button) => button.text === 'Review blueprint'),
    hasReviewApproval: allButtons.some((button) => button.text === 'Open review'),
  };
})()
        """.strip(),
        timeout_seconds=30,
    )
    if not isinstance(state, dict):
        raise RuntimeError(f"Unexpected Playwright state payload: {state!r}")
    return state


def confirm_brief(session) -> None:
    session.run_code(
        """
async (page) => {
  const button = page.getByRole('button', { name: /Confirm and continue|确认开始/ }).first();
  await button.waitFor({ state: 'visible', timeout: 60000 });
  await button.click();
}
        """.strip(),
        timeout_seconds=60,
    )


def open_blueprint_review(session) -> None:
    session.run_code(
        """
async (page) => {
  const button = page.getByRole('button', { name: /Review blueprint/i });
  await button.waitFor({ state: 'visible', timeout: 60000 });
  await button.click();
}
        """.strip(),
        timeout_seconds=60,
    )


def confirm_blueprint(session) -> None:
    session.run_code(
        """
async (page) => {
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible', timeout: 60000 });
  const button = dialog.getByRole('button').filter({ hasText: /Confirm|确认/ }).last();
  await button.waitFor({ state: 'visible', timeout: 60000 });
  await button.click();
}
        """.strip(),
        timeout_seconds=60,
    )


def open_review(session) -> None:
    session.run_code(
        """
async (page) => {
  const button = page.getByRole('button', { name: /Open review/i });
  await button.waitFor({ state: 'visible', timeout: 60000 });
  await button.click();
}
        """.strip(),
        timeout_seconds=60,
    )


def resolve_review(session) -> None:
    session.run_code(
        """
async (page) => {
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ state: 'visible', timeout: 60000 });

  const continueDraft = dialog.getByRole('button', { name: /Continue with current draft/i });
  if (await continueDraft.count()) {
    if (!(await continueDraft.isDisabled())) {
      await continueDraft.click();
      return;
    }
  }

  const selectAll = dialog.getByRole('button', { name: /Select all/i });
  if (await selectAll.count()) {
    await selectAll.click();
  }

  const fixSelected = dialog.getByRole('button').filter({ hasText: /Fix selected/i }).first();
  if (await fixSelected.count()) {
    if (!(await fixSelected.isDisabled())) {
      await fixSelected.click();
      return;
    }
  }

  const skipVisual = dialog.getByRole('button', { name: /Skip visual blockers/i });
  if (await skipVisual.count()) {
    if (!(await skipVisual.isDisabled())) {
      await skipVisual.click();
      return;
    }
  }

  throw new Error('Review dialog did not expose a usable continue action');
}
        """.strip(),
        timeout_seconds=60,
    )


def read_session_handle(session, page_id: str) -> dict[str, object] | None:
    raw_value = session.eval_json(
        f"window.sessionStorage.getItem({json.dumps(f'docmost.ai.create.session:{page_id}')})",
        timeout_seconds=30,
    )
    if not isinstance(raw_value, str) or not raw_value:
        return None

    try:
        parsed = json.loads(raw_value)
    except json.JSONDecodeError:
        return None

    if not isinstance(parsed, dict):
        return None

    return parsed


def fetch_agent_session_snapshot(session_id: str, token: str) -> dict[str, object] | None:
    client = requests.Session()
    client.cookies.set("authToken", token)
    response = client.get(f"{SERVER_URL}/api/agent/session/{session_id}", timeout=30)
    response.raise_for_status()
    payload = response.json()
    if payload.get("status") != "ok" or not isinstance(payload.get("session"), dict):
        return None
    return payload["session"]


def wait_for_final_agent_content(
    session,
    page_storage_key: str,
    token: str,
    marker: str,
    timeout_seconds: int = 480,
) -> str:
    del marker

    deadline = time.time() + timeout_seconds
    checkpoint_excerpt = ""
    brief_confirmed = False
    blueprint_confirmed = False
    review_resolution_count = 0
    last_state: dict[str, object] | None = None
    last_snapshot: dict[str, object] | None = None
    session_id: str | None = None

    while time.time() < deadline:
        state = get_run_state(session)
        last_state = state
        body_text = str(state.get("bodyText") or "")
        if not session_id:
            handle = read_session_handle(session, page_storage_key)
            raw_session_id = handle.get("sessionId") if isinstance(handle, dict) else None
            if isinstance(raw_session_id, str) and raw_session_id:
                session_id = raw_session_id

        snapshot = fetch_agent_session_snapshot(session_id, token) if session_id else None
        last_snapshot = snapshot
        run_state = str(snapshot.get("run_state") or "") if isinstance(snapshot, dict) else ""
        pending_decision = snapshot.get("pending_decision") if isinstance(snapshot, dict) else None
        pending_phase = (
            pending_decision.get("phase")
            if isinstance(pending_decision, dict)
            else None
        )

        if (pending_phase == "brief" or state.get("hasBriefApproval")) and not brief_confirmed:
            checkpoint_excerpt = body_text[:1200]
            confirm_brief(session)
            brief_confirmed = True
            time.sleep(2)
            continue

        if (pending_phase == "blueprint" or state.get("hasBlueprintApproval")) and not blueprint_confirmed:
            checkpoint_excerpt = body_text[:1200]
            open_blueprint_review(session)
            confirm_blueprint(session)
            blueprint_confirmed = True
            time.sleep(2)
            continue

        if (pending_phase == "review" or state.get("hasReviewApproval")) and review_resolution_count < 6:
            checkpoint_excerpt = body_text[:1200]
            open_review(session)
            resolve_review(session)
            review_resolution_count += 1
            time.sleep(2)
            continue

        if run_state == "blocked" or str(state.get("status") or "") == "BLOCKED":
            raise RuntimeError(
                "Agent flow entered a blocked state during the happy-path browser acceptance.\n"
                + json.dumps(
                    {
                        "ui": state,
                        "session": snapshot,
                    },
                    ensure_ascii=False,
                    indent=2,
                )
            )

        if (
            run_state == "completed"
            and int(state.get("actionButtons") or 0) >= 2
            and not bool(state.get("isStreaming"))
        ):
            return checkpoint_excerpt or body_text[:1200]

        time.sleep(2)

    raise TimeoutError(
        "Timed out waiting for the AI creator workbench flow to reach final content.\n"
        + json.dumps(
            {
                "ui": last_state or {},
                "session": last_snapshot or {},
            },
            ensure_ascii=False,
            indent=2,
        )
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
            and marker in markdown
            and "```mermaid" in markdown
            and "| --- |" in markdown
        ):
            return markdown
        time.sleep(3)

    raise TimeoutError("Timed out waiting for persisted markdown.\n" + last_markdown[:1600])


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

        workbench_excerpt = wait_for_final_agent_content(
            session,
            context.page_slug,
            context.token,
            marker,
        )
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
            "workbench_excerpt": workbench_excerpt,
            "browser_state": browser_state,
            "persisted_excerpt": persisted_markdown[:1600],
        }
    finally:
        session.close()


if __name__ == "__main__":
    result = run_agent_outline_e2e()
    print(json.dumps(result, ensure_ascii=True, indent=2))
