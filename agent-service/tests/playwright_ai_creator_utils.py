from __future__ import annotations

import base64
import json
import re
import shutil
import subprocess
import sys
import time
from contextlib import suppress
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlparse, urlsplit, urlunsplit

import jwt
import psycopg
import requests


REPO_ROOT = Path(__file__).resolve().parents[2]
ENV_PATH = REPO_ROOT / ".env"
CLIENT_URL = "http://localhost:5173"
SERVER_URL = "http://localhost:3000"


@dataclass
class SmokeContext:
    token: str
    space_slug: str
    page_slug: str
    page_id: str


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for line in ENV_PATH.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key] = value.strip().strip('"')
    return env


def clean_database_url(url: str) -> str:
    parts = urlsplit(url)
    query = [
        (key, value)
        for key, value in parse_qsl(parts.query, keep_blank_values=True)
        if key.lower() != "schema"
    ]
    return urlunsplit(
        (parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment)
    )


def build_smoke_context(page_title_prefix: str) -> SmokeContext:
    env = load_env()
    db_url = clean_database_url(env["DATABASE_URL"])

    with psycopg.connect(db_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                select id, email, workspace_id
                from users
                where deleted_at is null
                order by created_at asc
                limit 1
                """
            )
            user_id, email, workspace_id = cur.fetchone()
            cur.execute(
                """
                select id, slug
                from spaces
                where workspace_id = %s and deleted_at is null
                order by created_at asc
                limit 1
                """,
                (workspace_id,),
            )
            space_id, space_slug = cur.fetchone()

    payload = {
        "sub": str(user_id),
        "email": str(email),
        "workspaceId": str(workspace_id),
        "type": "access",
        "exp": datetime.now(timezone.utc) + timedelta(days=7),
    }
    token = jwt.encode(payload, env["APP_SECRET"], algorithm="HS256")

    session = requests.Session()
    session.cookies.set("authToken", token)
    response = session.post(
        f"{SERVER_URL}/api/pages/create",
        json={
            "title": f"{page_title_prefix} " + datetime.now().strftime("%Y%m%d-%H%M%S"),
            "spaceId": str(space_id),
            "content": "# Browser Smoke\n\nInitial content.",
            "format": "markdown",
        },
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()["data"]

    return SmokeContext(
        token=token,
        space_slug=str(space_slug),
        page_slug=str(payload["slugId"]),
        page_id=str(payload["id"]),
    )


def _get_agent_service_module_path() -> Path:
    return REPO_ROOT / "agent-service"


def seed_agent_session(snapshot) -> object:
    agent_service_path = str(_get_agent_service_module_path())
    if agent_service_path not in sys.path:
        sys.path.insert(0, agent_service_path)

    from app.orchestrator.session_store import session_store

    if hasattr(snapshot, "model_dump"):
        data = snapshot.model_dump()
        session_id = snapshot.session_id
        thread_id = snapshot.thread_id
    elif isinstance(snapshot, dict):
        data = dict(snapshot)
        session_id = str(data["session_id"])
        thread_id = str(data["thread_id"])
    else:
        raise TypeError(f"Unsupported snapshot type: {type(snapshot)!r}")

    session_store.delete_session(session_id)
    return session_store.upsert_session(
        session_id=session_id,
        thread_id=thread_id,
        **{
            key: value
            for key, value in data.items()
            if key not in {"session_id", "thread_id"}
        },
    )


def clear_agent_session(session_id: str) -> None:
    agent_service_path = str(_get_agent_service_module_path())
    if agent_service_path not in sys.path:
        sys.path.insert(0, agent_service_path)

    from app.orchestrator.session_store import session_store

    with suppress(Exception):
        session_store.delete_session(session_id)


def fetch_page_markdown(page_id: str, token: str) -> str:
    session = requests.Session()
    session.cookies.set("authToken", token)
    response = session.post(
        f"{SERVER_URL}/api/pages/info",
        json={"pageId": page_id, "format": "markdown"},
        timeout=30,
    )
    response.raise_for_status()
    payload = response.json()
    data = payload["data"] if isinstance(payload, dict) and "data" in payload else payload
    return str(data.get("content") or "")


def resolve_client_url() -> str:
    log_path = REPO_ROOT / "output" / "client-dev.log"
    if log_path.exists():
        text = log_path.read_text(encoding="utf-8", errors="ignore")
        urls = re.findall(r"http://[0-9A-Za-z\.\-]+:5173", text)
        network_urls = [
            url for url in urls if "localhost" not in url and "127.0.0.1" not in url
        ]
        if network_urls:
            return network_urls[0]
        if urls:
            return urls[0]
    return CLIENT_URL


class PlaywrightCliSession:
    def __init__(self, session_name: str, npx_path: str):
        self.session_name = session_name
        self.command_prefix = [
            npx_path,
            "--yes",
            "@playwright/cli",
            "-s",
            session_name,
        ]

    def _run(
        self,
        *args: str,
        timeout_seconds: int = 60,
        check: bool = True,
    ) -> str:
        command = [*self.command_prefix, *args]
        completed = subprocess.run(
            command,
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout_seconds,
            check=False,
        )
        if check and completed.returncode != 0:
            raise RuntimeError(
                f"Playwright CLI command failed: {' '.join(command)}\n"
                f"stdout:\n{completed.stdout}\n"
                f"stderr:\n{completed.stderr}"
            )
        return completed.stdout

    def close(self) -> None:
        self._run("close", timeout_seconds=30, check=False)

    def open(self, url: str) -> None:
        self._run("open", url, "--headed", timeout_seconds=60)

    def goto(self, url: str) -> None:
        self._run("goto", url, timeout_seconds=60)

    def reload(self) -> None:
        self._run("reload", timeout_seconds=60)

    def cookie_set(self, name: str, value: str, domain: str) -> None:
        self._run(
            "cookie-set",
            name,
            value,
            "--domain",
            domain,
            "--path",
            "/",
            timeout_seconds=30,
        )

    def localstorage_set(self, key: str, value: str) -> None:
        self._run("localstorage-set", key, value, timeout_seconds=30)

    def run_code(self, code: str, timeout_seconds: int = 60) -> str:
        normalized = " ".join(line.strip() for line in code.splitlines() if line.strip())
        return self._run("run-code", normalized, timeout_seconds=timeout_seconds)

    def eval_json(self, expression: str, timeout_seconds: int = 60) -> object:
        self.run_code(
            f"""
async (page) => {{
  const result = await page.evaluate(() => {expression});
  await page.evaluate((value) => {{
    document.documentElement.setAttribute('data-playwright-json', JSON.stringify(value));
  }}, result);
}}
            """.strip(),
            timeout_seconds=timeout_seconds,
        )
        output = self._run(
            "eval",
            "document.documentElement.getAttribute('data-playwright-json')",
            timeout_seconds=timeout_seconds,
        )
        match = re.search(
            r"### Result\s*(.*?)\s*(?:### Ran Playwright code|### Page|$)",
            output,
            re.DOTALL,
        )
        if not match:
            raise RuntimeError(f"Could not parse Playwright eval output:\n{output}")
        result_text = match.group(1).strip()
        if not result_text:
            return None
        raw_json = json.loads(result_text)
        if raw_json is None:
            return None
        return json.loads(raw_json)


def create_authenticated_session(
    session_name_prefix: str,
    context: SmokeContext,
    *,
    agent_mode: bool,
    auto_insert: bool,
) -> tuple[PlaywrightCliSession, str, str]:
    npx_path = shutil.which("npx")
    if not npx_path:
        raise RuntimeError("npx is required to run the Playwright CLI browser validation.")

    client_url = resolve_client_url()
    client_host = urlparse(client_url).hostname
    if not client_host:
        raise RuntimeError(f"Could not resolve client host from {client_url}")

    session = PlaywrightCliSession(
        f"{session_name_prefix}-{datetime.now().strftime('%Y%m%d%H%M%S')}",
        npx_path,
    )
    page_url = f"{client_url}/s/{context.space_slug}/p/{context.page_slug}"

    session.close()
    session.open("about:blank")
    session.cookie_set("authToken", context.token, client_host)
    session.goto(page_url)
    session.localstorage_set("aiAgentMode", "true" if agent_mode else "false")
    session.localstorage_set("aiAutoInsert", "true" if auto_insert else "false")
    session.reload()

    return session, client_url, page_url


def write_session_storage_handle(
    session: PlaywrightCliSession,
    page_slug: str,
    session_id: str,
    task_id: str | None = None,
) -> None:
    session.run_code(
        f"""
async (page) => {{
  await page.evaluate((payload) => {{
    window.sessionStorage.setItem(
      {json.dumps(f"docmost.ai.create.session:{page_slug}")},
      JSON.stringify(payload),
    );
  }}, {{
    sessionId: {json.dumps(session_id)},
    taskId: {json.dumps(task_id)},
  }});
}}
        """.strip(),
        timeout_seconds=30,
    )


def upload_files_to_ai_creator(
    session: PlaywrightCliSession,
    file_paths: list[str],
    timeout_seconds: int = 30,
) -> None:
    serialized_paths = json.dumps(file_paths)
    session.run_code(
        f"""
async (page) => {{
  const input = page.locator('input[type="file"]').first();
  await input.setInputFiles({serialized_paths});
}}
        """.strip(),
        timeout_seconds=timeout_seconds,
    )


def wait_for_editor_ready(session: PlaywrightCliSession, timeout_seconds: int = 45) -> None:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        state = session.eval_json(
            "({ ready: !!document.querySelector('.editor-container .ProseMirror') })",
            timeout_seconds=20,
        )
        if isinstance(state, dict) and state.get("ready"):
            return
        time.sleep(1)
    raise TimeoutError("Timed out waiting for the editor to become available.")


def open_ai_creator(session: PlaywrightCliSession, timeout_seconds: int = 30) -> None:
    state = session.eval_json(
        f"""
(async () => {{
  const button = document.querySelector('main button:has(svg.tabler-icon-sparkles)');
  if (!button) {{
    return {{ opened: false, reason: 'button_not_found' }};
  }}

  button.click();
  const deadline = Date.now() + {timeout_seconds * 1000};
  while (Date.now() < deadline) {{
    if (document.querySelector('textarea[data-ai-input]')) {{
      return {{ opened: true }};
    }}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }}

  return {{
    opened: false,
    reason: 'textarea_not_visible',
    bodyText: (document.body?.innerText || '').slice(0, 1200),
  }};
}})()
        """.strip(),
        timeout_seconds=timeout_seconds,
    )
    if not isinstance(state, dict) or not state.get("opened"):
        raise RuntimeError(f"Failed to open AI Creator: {state!r}")


def click_button_by_text(
    session: PlaywrightCliSession,
    pattern: str,
    *,
    timeout_seconds: int = 60,
    within_dialog: bool = False,
) -> None:
    scope_expr = "document.querySelector('[role=\"dialog\"]') || document" if within_dialog else "document"
    state = session.eval_json(
        f"""
(async () => {{
  const regex = new RegExp({json.dumps(pattern)}, 'i');
  const deadline = Date.now() + {timeout_seconds * 1000};

  const isVisible = (element) => {{
    if (!(element instanceof HTMLElement)) {{
      return false;
    }}
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility !== 'hidden' &&
      style.display !== 'none'
    );
  }};

  const fireClick = (button) => {{
    ['mousedown', 'mouseup', 'click'].forEach((type) => {{
      button.dispatchEvent(new MouseEvent(type, {{
        bubbles: true,
        cancelable: true,
        view: window,
      }}));
    }});
  }};

  while (Date.now() < deadline) {{
    const scope = {scope_expr};
    const buttons = Array.from(scope.querySelectorAll('button'));
    const button = buttons.find((candidate) => {{
      const text = (candidate.innerText || candidate.textContent || '').trim();
      return regex.test(text) && isVisible(candidate) && !candidate.disabled;
    }});

    if (button) {{
      fireClick(button);
      return {{
        clicked: true,
        text: (button.innerText || button.textContent || '').trim(),
      }};
    }}

    await new Promise((resolve) => setTimeout(resolve, 100));
  }}

  return {{
    clicked: false,
    bodyText: (document.body?.innerText || '').slice(0, 1600),
  }};
}})()
        """.strip(),
        timeout_seconds=timeout_seconds,
    )
    if not isinstance(state, dict) or not state.get("clicked"):
        raise RuntimeError(f"Failed to click button matching /{pattern}/: {state!r}")


def set_prompt_and_send(session: PlaywrightCliSession, prompt: str) -> None:
    payload = base64.urlsafe_b64encode(prompt.encode("utf-8")).decode("ascii")
    session.run_code(
        f"""
async (page) => {{
  await page.evaluate((encoded) => {{
    const normalizeBase64 = (value) => {{
      const padded = value + '='.repeat((4 - (value.length % 4 || 4)) % 4);
      return padded.replace(/-/g, '+').replace(/_/g, '/');
    }};
    const prompt = decodeURIComponent(escape(atob(normalizeBase64(encoded))));
    const textarea = document.querySelector('textarea[data-ai-input]');
    if (!textarea) {{
      throw new Error('Prompt textarea not found');
    }}
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    )?.set;
    if (!setter) {{
      throw new Error('Textarea value setter not found');
    }}
    setter.call(textarea, prompt);
    textarea.dispatchEvent(new Event('input', {{ bubbles: true }}));
    textarea.dispatchEvent(new Event('change', {{ bubbles: true }}));
  }}, "{payload}");
  await page.evaluate(() => {{
    const textarea = document.querySelector('textarea[data-ai-input]');
    if (!textarea) {{
      throw new Error('Prompt textarea not found');
    }}
    const rect = textarea.getBoundingClientRect();
    const buttons = Array.from(document.querySelectorAll('button'))
      .filter((button) => !button.disabled)
      .filter((button) => {{
        const box = button.getBoundingClientRect();
        return (
          box.y >= rect.y &&
          box.y <= rect.y + rect.height + 90 &&
          box.x >= rect.x + rect.width - 120 &&
          box.width >= 20 &&
          box.width <= 48 &&
          box.height >= 20 &&
          box.height <= 48
        );
      }});
    if (!buttons.length) {{
      throw new Error('Could not locate the AI Creator send button');
    }}
    buttons.sort((left, right) => right.getBoundingClientRect().x - left.getBoundingClientRect().x);
    buttons[0].click();
  }});
}}
        """.strip(),
        timeout_seconds=60,
    )


def click_insert_to_editor(session: PlaywrightCliSession) -> None:
    state = session.eval_json(
        """
(async () => {
  const groups = Array.from(document.querySelectorAll('[class*="messageActions"]'));
  const lastGroup = groups.at(-1);
  if (!lastGroup) {
    return { clicked: false, reason: 'message_action_group_not_found' };
  }

  const buttons = Array.from(lastGroup.querySelectorAll('button'));
  if (buttons.length < 2) {
    return { clicked: false, reason: 'insert_action_not_found' };
  }

  buttons[1].click();
  return { clicked: true };
})()
        """.strip(),
        timeout_seconds=30,
    )
    if not isinstance(state, dict) or not state.get("clicked"):
        raise RuntimeError(f"Failed to click insert-to-editor action: {state!r}")


def wait_for_editor_artifacts(
    session: PlaywrightCliSession,
    marker: str,
    timeout_seconds: int = 120,
    require_marker: bool = True,
) -> dict[str, object]:
    deadline = time.time() + timeout_seconds
    last_state: dict[str, object] = {}

    while time.time() < deadline:
        state = session.eval_json(
            """
(() => {
  const editor = document.querySelector('.editor-container .ProseMirror');
  const editorText = editor ? editor.innerText : '';
  return {
    editorText,
    hasTable: !!document.querySelector('.editor-container .ProseMirror table'),
    hasMermaidSvg: !!document.querySelector('.editor-container .ProseMirror .mermaid svg'),
    codeBlocks: document.querySelectorAll('.editor-container .ProseMirror pre').length,
  };
})()
            """.strip(),
            timeout_seconds=30,
        )
        if not isinstance(state, dict):
            raise RuntimeError(f"Unexpected editor state payload: {state!r}")
        last_state = state
        editor_text = str(state.get("editorText") or "")
        has_table = bool(state.get("hasTable"))
        has_mermaid = bool(state.get("hasMermaidSvg")) or int(state.get("codeBlocks") or 0) > 0
        has_marker = marker in editor_text
        if (has_marker or not require_marker) and has_table and has_mermaid:
            return {
                "has_marker": has_marker,
                "has_table": has_table,
                "has_mermaid": has_mermaid,
            }
        time.sleep(2)

    raise TimeoutError(
        "Timed out waiting for browser artifacts: "
        + json.dumps(last_state, ensure_ascii=False)
    )
