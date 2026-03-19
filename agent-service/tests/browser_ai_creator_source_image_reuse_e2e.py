from __future__ import annotations

import json
import time
from datetime import datetime

from playwright_ai_creator_utils import (
    build_smoke_context,
    clear_agent_session,
    click_insert_to_editor,
    create_authenticated_session,
    fetch_page_markdown,
    open_ai_creator,
    seed_agent_session,
    wait_for_editor_ready,
    write_session_storage_handle,
)


def build_blueprint_snapshot(session_id: str) -> dict[str, object]:
    blueprint = {
        "title": "Login PRD",
        "total_word_budget": 800,
        "style_guide": "Be concrete and source-aware.",
        "visual_plan_summary": "Prefer source figures before generating new images.",
        "sections": [
            {
                "id": "s1",
                "title": "Login overview",
                "level": 2,
                "word_budget": 400,
                "description": "Explain the primary login path and why the source figure should be reused.",
                "assets": ["img-source-1"],
                "visuals": [
                    {
                        "type": "reuse_image",
                        "description": "Reuse the uploaded login flow diagram",
                        "source_asset_id": "img-source-1",
                        "position": "before_section",
                    }
                ],
                "visual_candidates": [
                    {
                        "asset_id": "img-source-1",
                        "score": 0.95,
                        "caption": "Uploaded login flow diagram",
                        "source": "login-source.pdf",
                        "source_page": 1,
                        "source_heading": "Figure 1",
                        "rationale": "The diagram already matches the section's success path requirements.",
                    },
                    {
                        "asset_id": "img-source-2",
                        "score": 0.67,
                        "caption": "Fallback architecture screenshot",
                        "source": "login-source.pdf",
                        "source_page": 3,
                        "source_heading": "Appendix",
                        "rationale": "Less aligned because it focuses on backend architecture rather than the user flow.",
                    },
                ],
                "must_cover": ["happy path", "entry point"],
            }
        ],
    }
    brief = {
        "audience": "Product, engineering, QA",
        "goal": "Create a source-aware login PRD",
        "target_length": 800,
        "style": "Professional",
        "tone": "Concise",
        "structure_strategy": "ai_recommend",
        "image_strategy": "prefer_source_then_generate",
        "constraints": [],
    }
    return {
        "session_id": session_id,
        "thread_id": session_id,
        "run_state": "awaiting_input",
        "phase": "blueprint",
        "brief": brief,
        "blueprint": blueprint,
        "pending_decision": {
            "phase": "blueprint",
            "data": {
                "type": "blueprint",
                "blueprint": blueprint,
            },
        },
    }


def build_completed_snapshot(session_id: str) -> dict[str, object]:
    markdown = """
## Source Figure Reuse

![Uploaded login flow](/api/files/browser-source-reused-login.png)

The workbench reused the approved source image exactly once for this section.

## Generated Fallback

![Generated fallback](/api/files/browser-generated-fallback-login.png)

The source asset was unavailable during materialization, so the writer emitted a single generated fallback image.
""".strip()

    return {
        "session_id": session_id,
        "thread_id": session_id,
        "run_state": "completed",
        "phase": "done",
        "draft_markdown": markdown,
        "draft_sections": [
            {
                "node_id": "section:s1",
                "section_id": "s1",
                "title": "Source Figure Reuse",
                "level": 2,
                "content": "The approved source figure is inserted once.",
                "write_attempts": 1,
                "image_status": "source_reused",
                "source_image_asset_id": "img-source-1",
            },
            {
                "node_id": "section:s2",
                "section_id": "s2",
                "title": "Generated Fallback",
                "level": 2,
                "content": "Fallback generation happened once after the source asset was unavailable.",
                "write_attempts": 2,
                "image_status": "generated_fallback",
                "source_image_asset_id": "img-source-2",
                "degraded_reason": "source asset unavailable",
            },
        ],
    }


def open_blueprint_modal(session) -> None:
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


def wait_for_blueprint_candidate_ui(session, timeout_seconds: int = 90) -> dict[str, object]:
    deadline = time.time() + timeout_seconds
    last_state: dict[str, object] = {}

    while time.time() < deadline:
        state = session.eval_json(
            """
(() => {
  const bodyText = document.body?.innerText || '';
  const buttons = Array.from(document.querySelectorAll('button'))
    .map((button) => (button.innerText || '').trim())
    .filter(Boolean);
  return {
    bodyText,
    buttons,
    hasBlueprintApproval: buttons.includes('Review blueprint'),
  };
})()
            """.strip(),
            timeout_seconds=30,
        )
        if not isinstance(state, dict):
            raise RuntimeError(f"Unexpected blueprint UI state payload: {state!r}")
        last_state = state
        if bool(state.get("hasBlueprintApproval")):
            return state
        time.sleep(1)

    raise TimeoutError(
        "Timed out waiting for blueprint approval UI.\n"
        + json.dumps(last_state, ensure_ascii=False, indent=2)
    )


def select_source_candidate(session) -> dict[str, object]:
    session.run_code(
        """
async (page) => {
  await page.getByText('Source image candidates').waitFor({ state: 'visible', timeout: 60000 });
  const candidateButton = page.getByRole('button', { name: /Use this image|Using this image/i }).first();
  await candidateButton.waitFor({ state: 'visible', timeout: 60000 });
  await candidateButton.click();
}
        """.strip(),
        timeout_seconds=60,
    )

    state = session.eval_json(
        """
(() => {
  const bodyText = document.body?.innerText || '';
  return {
    text: bodyText,
    hasCandidateList: bodyText.includes('Source image candidates'),
    hasSelectedBadge: bodyText.includes('Selected'),
    hasUsingState: bodyText.includes('Using this image'),
  };
})()
        """.strip(),
        timeout_seconds=30,
    )
    if not isinstance(state, dict):
        raise RuntimeError(f"Unexpected candidate selection state payload: {state!r}")
    return state


def wait_for_completed_source_state(session, timeout_seconds: int = 90) -> dict[str, object]:
    deadline = time.time() + timeout_seconds
    last_state: dict[str, object] = {}

    while time.time() < deadline:
        state = session.eval_json(
            """
(() => {
  const bodyText = document.body?.innerText || '';
  const normalized = bodyText.toLowerCase();
  const actionButtons = document.querySelectorAll('[class*="messageActions"] button').length;
  return {
    bodyText,
    actionButtons,
    hasSourceReused: normalized.includes('source_reused'),
    hasGeneratedFallback: normalized.includes('generated_fallback'),
    hasDegradedReason: normalized.includes('source asset unavailable'),
  };
})()
            """.strip(),
            timeout_seconds=30,
        )
        if not isinstance(state, dict):
            raise RuntimeError(f"Unexpected completed workbench state payload: {state!r}")
        last_state = state
        if (
            bool(state.get("hasSourceReused"))
            and bool(state.get("hasGeneratedFallback"))
            and bool(state.get("hasDegradedReason"))
            and int(state.get("actionButtons") or 0) >= 2
        ):
            return state
        time.sleep(1)

    raise TimeoutError(
        "Timed out waiting for completed source-image workbench state.\n"
        + json.dumps(last_state, ensure_ascii=False, indent=2)
    )


def wait_for_persisted_source_markdown(
    page_id: str,
    token: str,
    timeout_seconds: int = 180,
) -> str:
    deadline = time.time() + timeout_seconds
    last_markdown = ""
    source_url = "/api/files/browser-source-reused-login.png"
    fallback_url = "/api/files/browser-generated-fallback-login.png"

    while time.time() < deadline:
        markdown = fetch_page_markdown(page_id, token)
        last_markdown = markdown
        if (
            markdown.count(source_url) == 1
            and markdown.count(fallback_url) == 1
            and "## Source Figure Reuse" in markdown
            and "## Generated Fallback" in markdown
        ):
            return markdown
        time.sleep(2)

    raise TimeoutError(
        "Timed out waiting for persisted source-image markdown.\n"
        + last_markdown[:1600]
    )


def run_source_image_reuse_e2e() -> dict[str, object]:
    context = build_smoke_context("PW Source Image Reuse")
    session_id = "browser-source-image-" + datetime.now().strftime("%Y%m%d-%H%M%S")
    session, client_url, page_url = create_authenticated_session(
        "docmost-source-image",
        context,
        agent_mode=True,
        auto_insert=False,
    )

    try:
        seed_agent_session(build_blueprint_snapshot(session_id))
        wait_for_editor_ready(session)
        write_session_storage_handle(session, context.page_slug, session_id)
        open_ai_creator(session)

        blueprint_state = wait_for_blueprint_candidate_ui(session)
        open_blueprint_modal(session)
        candidate_state = select_source_candidate(session)
        if not bool(candidate_state.get("hasCandidateList")) or not (
            bool(candidate_state.get("hasSelectedBadge"))
            or bool(candidate_state.get("hasUsingState"))
        ):
            raise RuntimeError(
                "Blueprint source-image candidate UI did not become selectable.\n"
                + json.dumps(candidate_state, ensure_ascii=False, indent=2)
            )

        seed_agent_session(build_completed_snapshot(session_id))
        session.reload()
        wait_for_editor_ready(session)
        open_ai_creator(session)

        completed_state = wait_for_completed_source_state(session)
        click_insert_to_editor(session)
        persisted_markdown = wait_for_persisted_source_markdown(context.page_id, context.token)

        return {
            "client_url": client_url,
            "page_url": page_url,
            "page_id": context.page_id,
            "session_id": session_id,
            "blueprint_excerpt": str(blueprint_state.get("bodyText") or "")[:800],
            "candidate_state": candidate_state,
            "completed_state": completed_state,
            "persisted_excerpt": persisted_markdown[:1200],
        }
    finally:
        clear_agent_session(session_id)
        session.close()


if __name__ == "__main__":
    result = run_source_image_reuse_e2e()
    print(json.dumps(result, ensure_ascii=True, indent=2))
