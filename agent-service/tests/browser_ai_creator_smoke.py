from __future__ import annotations

import json
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import jwt
import psycopg
import requests
from DrissionPage import Chromium


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


def build_smoke_context() -> SmokeContext:
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
            "title": "AI Browser Smoke " + datetime.now().strftime("%Y%m%d-%H%M%S"),
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


def find_ai_creator_button(tab) -> object:
    deadline = time.time() + 20
    while time.time() < deadline:
        buttons = tab.eles("xpath://button")
        header_buttons = []
        for button in buttons:
            try:
                x, y = button.rect.viewport_location
                width, height = button.rect.size
            except Exception:
                continue
            if 35 <= y <= 95:
                header_buttons.append((x, y, width, height, button))

        share_entry = next(
            (entry for entry in header_buttons if "分享" in entry[4].text),
            None,
        )
        if not share_entry:
            time.sleep(1)
            continue

        share_x, share_y = share_entry[0], share_entry[1]
        action_icons = [
            entry
            for entry in header_buttons
            if entry[0] > share_x
            and abs(entry[1] - share_y) <= 8
            and entry[2] <= 40
            and entry[3] <= 40
        ]
        action_icons.sort(key=lambda item: item[0])
        if action_icons:
            return action_icons[0][4]
        time.sleep(1)

    raise RuntimeError("Could not locate AI Creator button in page header.")


def wait_for_response(tab, timeout_seconds: int = 90) -> str:
    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        body_text = tab.ele("tag:body").text
        if any(
            marker in body_text
            for marker in (
                "Planning the document structure",
                "Reviewing document quality",
                "AI Assistant",
                "AI 正在写作",
                "需要进一步了解",
                "提交回答",
                "Outline",
                "Proposal",
            )
        ) and "Create a short technical note" in body_text:
            return body_text
        time.sleep(1)
    raise TimeoutError("Timed out waiting for AI Creator response activity.")


def run_browser_smoke() -> dict[str, str]:
    context = build_smoke_context()
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
        tab.run_js(
            """
            localStorage.setItem('aiAgentMode', 'true');
            localStorage.setItem('aiAutoInsert', 'false');
            """
        )
        time.sleep(1)
        page_url = f"{CLIENT_URL}/s/{context.space_slug}/p/{context.page_slug}"
        tab.get(page_url)
        tab.wait(3)

        ai_button = find_ai_creator_button(tab)
        ai_button.click()
        tab.wait.ele_displayed("text=AI Assistant", timeout=15)

        textarea = tab.ele("css:textarea[data-ai-input]")
        prompt = (
            "Create a short technical note comparing two API approaches. "
            "Use a markdown table and a mermaid flowchart."
        )
        textarea.input(prompt + "\n", clear=True)

        body_text = wait_for_response(tab)
        return {
            "page_url": page_url,
            "page_id": context.page_id,
            "result_excerpt": body_text[:1200],
        }
    finally:
        browser.quit()


if __name__ == "__main__":
    result = run_browser_smoke()
    print(json.dumps(result, ensure_ascii=False, indent=2))
