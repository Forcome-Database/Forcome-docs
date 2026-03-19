# AI Creator v3 — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor AI Creator from a 3-column chat-based workbench to a lightweight command panel with inline review, solving 5 critical UX problems (UI clutter, section incoherence, chat/document disconnect, selection rewriting conflicts, content loss on re-optimize).

**Architecture:** Three-channel routing (selection rewriting via existing ai-menu in NestJS, document optimization via new agent-service endpoint, creation from scratch via simplified prompt chain). Command paradigm replaces chat paradigm. Snapshot+Undo for content safety (v1), inline diff decorations for visual review (v2).

**Tech Stack:** PydanticAI (Python agent-service), NestJS 11 + Fastify (gateway), React 18 + Mantine 8 + Jotai (frontend), TipTap 3 / ProseMirror (editor), MineRU (PDF parsing), Vitest (frontend tests), pytest (backend tests), Chrome E2E (browser verification).

**Spec:** `docs/superpowers/specs/2026-03-20-ai-creator-v3-redesign.md`

---

## File Map

### New files

**Backend (Python agent-service):**
- `agent-service/app/orchestrator/engine_v3.py` — Simplified 2-layer orchestrator (~400 lines)
- `agent-service/app/orchestrator/tools/change_summary.py` — Deterministic change summary generator
- `agent-service/app/orchestrator/tools/heartbeat.py` — SSE heartbeat loop utility
- `agent-service/tests/orchestrator/test_engine_v3.py` — Engine v3 unit tests
- `agent-service/tests/orchestrator/test_change_summary.py` — Change summary tests
- `apps/client/src/ee/ai/utils/editor-diff.ts` — v2: Frontend ProseMirror diff computation
- `agent-service/tests/integration/test_api_v3.py` — API integration tests

**Backend (NestJS gateway):**
- `apps/server/src/ee/ai/dto/document-optimize.dto.ts` — DocumentOptimizeDto
- `apps/server/src/ee/ai/dto/document-create.dto.ts` — DocumentCreateDto

**Frontend:**
- `apps/client/src/ee/ai/components/ai-command-panel/AiCommandPanel.tsx` — Main command panel
- `apps/client/src/ee/ai/components/ai-command-panel/QuickActions.tsx` — 6-grid quick actions
- `apps/client/src/ee/ai/components/ai-command-panel/CommandInput.tsx` — Input box + toolbar
- `apps/client/src/ee/ai/components/ai-command-panel/RecentOps.tsx` — Operation history
- `apps/client/src/ee/ai/components/ai-command-panel/AiRunningOverlay.tsx` — Running state UI
- `apps/client/src/ee/ai/components/ai-review-sidebar/ReviewSidebar.tsx` — v1 review panel
- `apps/client/src/ee/ai/components/ai-review-sidebar/ChangeList.tsx` — v2: change list with accept/reject
- `apps/client/src/ee/ai/components/ai-review/DiffDecorationPlugin.ts` — v2: ProseMirror plugin
- `apps/client/src/ee/ai/hooks/useAiCommand.ts` — Command panel hook
- `apps/client/src/ee/ai/hooks/useAiReview.ts` — Review mode hook
- `apps/client/src/ee/ai/hooks/useAiStream.ts` — Generic SSE stream hook
- `apps/client/src/ee/ai/services/ai-document-service.ts` — Document optimize/create API calls
- `apps/client/src/ee/ai/types/command.types.ts` — v3 type definitions

**Tests:**
- `apps/client/src/ee/ai/components/__tests__/AiCommandPanel.test.tsx`
- `apps/client/src/ee/ai/components/__tests__/ReviewSidebar.test.tsx`
- `apps/client/src/ee/ai/components/__tests__/ai-menu-isolation.test.tsx`
- `apps/client/src/ee/ai/hooks/__tests__/useAiCommand.test.ts`

### Modified files

**Backend:**
- `agent-service/app/main.py` — Add new `/agent/document/optimize` and `/agent/document/create` endpoints
- `agent-service/app/orchestrator/engine.py` — Import engine_v3 (coexist with old `run()`)
- `apps/server/src/ee/ai/ai.controller.ts` — Add `POST /api/ai/document/optimize` and `/create` routes
- `apps/server/src/ee/ai/ai.module.ts` — Register new routes

**Frontend:**
- `apps/client/src/features/editor/page-editor.tsx` — Mount AiCommandPanel (feature flag)
- `apps/client/src/ee/ai/components/editor/ai-menu/ai-menu.tsx` — Decouple from ai-creator atoms
- `apps/client/src/ee/ai/components/ai-creator/ai-creator-atoms.ts` — Add new atoms
- `.env.example` — Add `VITE_AI_CREATOR_V3`

### Files to delete (Phase 5)

- `apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx`
- `apps/client/src/ee/ai/components/ai-creator/ai-creator-messages.tsx`
- `apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.tsx`
- `apps/client/src/ee/ai/components/ai-creator/document-tree/DocumentTreePanel.tsx`
- `apps/client/src/ee/ai/components/ai-creator/live-draft/`
- `apps/client/src/ee/ai/components/ai-creator/blueprint/BlueprintModal.tsx`
- `apps/client/src/ee/ai/components/ai-creator/review/ReviewModal.tsx`
- `apps/client/src/ee/ai/components/ai-creator/smart-brief/SmartBriefCard.tsx`
- `apps/client/src/ee/ai/components/ai-creator/ai-creator-agent-steps.tsx`
- `agent-service/app/orchestrator/tools/create_blueprint.py`
- `agent-service/app/orchestrator/tools/write_tools.py`
- `agent-service/app/orchestrator/tools/evaluate.py`
- `agent-service/app/orchestrator/tools/fix_tools.py`
- `agent-service/app/workers/section_writer.py`
- `agent-service/app/workers/section_revision.py`
- `agent-service/app/workers/evaluator.py`
- `agent-service/app/workers/consistency_checker.py`
- `agent-service/app/workers/fixer.py`

---

## Phase 0: Preparation

### Task 1: Create feature branch and verify baseline

**Files:**
- No code changes

- [ ] **Step 1: Create feature branch**

```bash
git checkout master
git pull origin master
git checkout -b feat/ai-creator-v3
```

- [ ] **Step 2: Run existing backend tests to establish baseline**

Run: `cd agent-service && python -m pytest tests/ -q --tb=short 2>&1 | tail -20`
Expected: All existing tests pass (note any pre-existing failures).

- [ ] **Step 3: Run existing frontend build to verify no errors**

Run: `cd apps/client && pnpm build 2>&1 | tail -10`
Expected: Build succeeds.

- [ ] **Step 4: Add feature flag to .env.example**

Add to `.env.example`:
```
# AI Creator v3 (set to true to enable new command panel)
VITE_AI_CREATOR_V3=false
```

- [ ] **Step 5: Commit**

```bash
git add .env.example
git commit -m "$(cat <<'EOF'
chore: create ai-creator-v3 feature branch and add feature flag
EOF
)"
```

---

## Phase 1: Backend Simplification

### Task 2: Implement change summary generator

**Files:**
- Create: `agent-service/app/orchestrator/tools/change_summary.py`
- Test: `agent-service/tests/orchestrator/test_change_summary.py`

- [ ] **Step 1: Write the failing tests**

```python
# agent-service/tests/orchestrator/test_change_summary.py
import pytest
from app.orchestrator.tools.change_summary import generate_change_summary, ChangeSummary


class TestChangeSummary:
    def test_counts_text_changes(self):
        original = "Line one\nLine two\nLine three"
        optimized = "Line one modified\nLine two\nLine three changed"
        summary = generate_change_summary(original, optimized)
        assert isinstance(summary, ChangeSummary)
        assert summary.text_changes > 0

    def test_detects_full_image_preservation(self):
        original = "Text\n\n![img1](https://cdn/a.png)\n\nMore\n\n![img2](https://cdn/b.png)"
        optimized = "Changed text\n\n![img1](https://cdn/a.png)\n\nChanged more\n\n![img2](https://cdn/b.png)"
        summary = generate_change_summary(original, optimized)
        assert summary.images_total == 2
        assert summary.images_kept == 2
        assert summary.images_lost == []

    def test_detects_image_loss(self):
        original = "Text\n\n![img1](https://cdn/a.png)\n\n![img2](https://cdn/b.png)"
        optimized = "Changed text\n\n![img1](https://cdn/a.png)"
        summary = generate_change_summary(original, optimized)
        assert summary.images_kept == 1
        assert summary.images_lost == ["https://cdn/b.png"]

    def test_detects_heading_structure_preserved(self):
        original = "# Title\n## Section A\n## Section B"
        optimized = "# Title\n## Section A\n## Section B"
        summary = generate_change_summary(original, optimized)
        assert summary.structure_preserved is True

    def test_detects_heading_structure_changed(self):
        original = "# Title\n## Section A\n## Section B"
        optimized = "# Title\n## Section A\n## New Section"
        summary = generate_change_summary(original, optimized)
        assert summary.structure_preserved is False

    def test_detects_mermaid_preserved(self):
        original = "Text\n\n```mermaid\nflowchart LR\nA-->B\n```\n\nMore"
        optimized = "Changed\n\n```mermaid\nflowchart LR\nA-->B\n```\n\nChanged more"
        summary = generate_change_summary(original, optimized)
        assert summary.mermaid_preserved is True

    def test_handles_empty_original(self):
        summary = generate_change_summary("", "New content here")
        assert summary.text_changes > 0
        assert summary.images_total == 0

    def test_handles_image_with_title(self):
        original = '![alt](https://cdn/a.png "title")\n\nText'
        optimized = '![alt](https://cdn/a.png "title")\n\nChanged'
        summary = generate_change_summary(original, optimized)
        assert summary.images_kept == 1
```

- [ ] **Step 2: Run tests to verify RED**

Run: `cd agent-service && python -m pytest tests/orchestrator/test_change_summary.py -q`
Expected: FAIL (module does not exist).

- [ ] **Step 3: Implement change_summary.py**

```python
# agent-service/app/orchestrator/tools/change_summary.py
from __future__ import annotations

import difflib
import re
from dataclasses import dataclass, field


@dataclass
class ChangeSummary:
    text_changes: int = 0
    images_total: int = 0
    images_kept: int = 0
    images_lost: list[str] = field(default_factory=list)
    structure_preserved: bool = True
    mermaid_preserved: bool = True


_IMAGE_PATTERN = re.compile(r'!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)')
_HEADING_PATTERN = re.compile(r'^(#{1,6})\s+(.+)$', re.MULTILINE)
_MERMAID_PATTERN = re.compile(r'```mermaid\n(.*?)```', re.DOTALL)


def generate_change_summary(
    original: str,
    optimized: str,
    asset_map: object | None = None,
) -> ChangeSummary:
    old_lines = original.splitlines()
    new_lines = optimized.splitlines()
    diff = list(difflib.unified_diff(old_lines, new_lines, lineterm=""))

    additions = sum(1 for l in diff if l.startswith("+") and not l.startswith("+++"))
    deletions = sum(1 for l in diff if l.startswith("-") and not l.startswith("---"))

    original_images = set(_IMAGE_PATTERN.findall(original))
    optimized_images = set(_IMAGE_PATTERN.findall(optimized))
    kept = original_images & optimized_images
    lost = sorted(original_images - optimized_images)

    old_headings = _HEADING_PATTERN.findall(original)
    new_headings = _HEADING_PATTERN.findall(optimized)

    old_mermaid = _MERMAID_PATTERN.findall(original)
    new_mermaid = _MERMAID_PATTERN.findall(optimized)

    return ChangeSummary(
        text_changes=additions + deletions,
        images_total=len(original_images),
        images_kept=len(kept),
        images_lost=lost,
        structure_preserved=old_headings == new_headings,
        mermaid_preserved=old_mermaid == new_mermaid,
    )
```

- [ ] **Step 4: Run tests to verify GREEN**

Run: `cd agent-service && python -m pytest tests/orchestrator/test_change_summary.py -v`
Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/orchestrator/tools/change_summary.py agent-service/tests/orchestrator/test_change_summary.py
git commit -m "$(cat <<'EOF'
feat(ai-v3): add deterministic change summary generator
EOF
)"
```

### Task 3: Implement engine_v3 with handle_document

**Files:**
- Create: `agent-service/app/orchestrator/engine_v3.py`
- Test: `agent-service/tests/orchestrator/test_engine_v3.py`

- [ ] **Step 1: Write the failing tests**

```python
# agent-service/tests/orchestrator/test_engine_v3.py
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from app.orchestrator.engine_v3 import EngineV3, DocumentRequest, SSEEvent


@pytest.fixture
def engine():
    return EngineV3()


class TestHandleDocumentOptimize:
    @pytest.mark.asyncio
    async def test_returns_content_and_done_events(self, engine):
        request = DocumentRequest(
            instruction="优化措辞",
            original_content="原始文本内容",
            page_id="page-1",
        )
        with patch.object(engine, '_stream_llm', new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = "优化后的文本内容"
            events = []
            async for event in engine.handle_document(request):
                events.append(event)

        event_types = [e.type for e in events]
        assert "step_start" in event_types
        assert "content" in event_types or "step_done" in event_types
        assert event_types[-1] == "done"

    @pytest.mark.asyncio
    async def test_includes_change_summary_when_original_provided(self, engine):
        request = DocumentRequest(
            instruction="优化",
            original_content="原始内容",
            page_id="page-1",
        )
        with patch.object(engine, '_stream_llm', new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = "优化内容"
            events = []
            async for event in engine.handle_document(request):
                events.append(event)

        summary_events = [e for e in events if e.type == "change_summary"]
        assert len(summary_events) == 1
        assert summary_events[0].data["images_total"] >= 0

    @pytest.mark.asyncio
    async def test_parses_files_when_provided(self, engine):
        request = DocumentRequest(
            instruction="优化文档",
            files=[{"name": "test.pdf", "mimetype": "application/pdf", "content_b64": "dGVzdA=="}],
            page_id="page-1",
        )
        with patch.object(engine, '_stream_llm', new_callable=AsyncMock) as mock_llm, \
             patch('app.orchestrator.engine_v3.parse_assets', new_callable=AsyncMock) as mock_parse:
            mock_llm.return_value = "生成内容"
            mock_parse.return_value = MagicMock(full_text="parsed text", images=[], source_word_count=100)
            events = []
            async for event in engine.handle_document(request):
                events.append(event)

        mock_parse.assert_called_once()
        step_events = [e for e in events if e.type == "step_start" and e.data.get("step") == "parsing"]
        assert len(step_events) == 1

    @pytest.mark.asyncio
    async def test_handles_parse_failure_gracefully(self, engine):
        request = DocumentRequest(
            instruction="优化",
            files=[{"name": "bad.pdf", "mimetype": "application/pdf", "content_b64": "bad"}],
            page_id="page-1",
        )
        with patch.object(engine, '_stream_llm', new_callable=AsyncMock) as mock_llm, \
             patch('app.orchestrator.engine_v3.parse_assets', side_effect=RuntimeError("MineRU failed")):
            mock_llm.return_value = "降级生成"
            events = []
            async for event in engine.handle_document(request):
                events.append(event)

        error_events = [e for e in events if e.type == "step_error"]
        assert len(error_events) == 1
        assert events[-1].type == "done"  # Still completes


class TestHandleDocumentCreate:
    @pytest.mark.asyncio
    async def test_create_streams_content(self, engine):
        request = DocumentRequest(
            instruction="写一篇采购流程文档",
            page_id="page-1",
            need_brief=False,
        )
        with patch.object(engine, '_stream_llm', new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = "# 采购流程\n\n内容..."
            events = []
            async for event in engine.handle_document(request):
                events.append(event)

        assert events[-1].type == "done"
        assert events[-1].data.get("content")


class TestDocumentPromptStrategy:
    def test_system_prompt_includes_image_protection(self, engine):
        prompt = engine._build_system_prompt("优化", "custom system", None)
        assert "保留所有图片引用" in prompt or "![" in prompt

    def test_system_prompt_includes_workspace_prompt(self, engine):
        prompt = engine._build_system_prompt("优化", "你是专业的文档编辑", None)
        assert "专业的文档编辑" in prompt
```

- [ ] **Step 2: Run tests to verify RED**

Run: `cd agent-service && python -m pytest tests/orchestrator/test_engine_v3.py -q`
Expected: FAIL (module does not exist).

- [ ] **Step 3: Implement engine_v3.py**

```python
# agent-service/app/orchestrator/engine_v3.py
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

from app.orchestrator.llm_factory import create_llm
from app.orchestrator.tools.change_summary import generate_change_summary


@dataclass
class SSEEvent:
    type: str
    data: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {"type": self.type, **self.data}


@dataclass
class DocumentRequest:
    instruction: str
    page_id: str = ""
    original_content: str = ""
    files: list[dict] | None = None
    template_id: str | None = None
    template_prompt: str = ""
    system_prompt: str = ""
    need_brief: bool = False
    diff_mode: bool = False
    editor_json: dict | None = None
    workspace_id: str = ""


DOCUMENT_OPTIMIZE_SYSTEM = """你是一个专业的文档优化助手。

规则：
1. 保留所有图片引用（![desc](url)），不要修改、删除或重新排列图片
2. 保留文档的整体结构（标题层级、列表、表格）
3. 只修改文字内容，优化措辞和表达
4. 如果原文包含 Mermaid 代码块（```mermaid），保持不变
5. 如果原文包含代码块，保持不变（除非用户明确要求修改）
6. 输出完整的优化后文档，不要省略任何部分
7. 不要添加原文没有的图片或图表
8. 保留所有 HTML 注释（<!-- ... -->）不变
"""


class EngineV3:
    def __init__(self) -> None:
        self._llm = None

    def _build_system_prompt(
        self,
        instruction: str,
        workspace_system_prompt: str,
        template_prompt: str | None,
    ) -> str:
        parts = [DOCUMENT_OPTIMIZE_SYSTEM]
        if workspace_system_prompt:
            parts.append(f"\n{workspace_system_prompt}")
        if template_prompt:
            parts.append(f"\n{template_prompt}")
        return "\n".join(parts)

    def _build_user_prompt(
        self,
        instruction: str,
        content: str,
    ) -> str:
        return f"[用户指令]\n{instruction}\n\n[文档内容]\n{content}"

    async def _stream_llm(self, system: str, prompt: str) -> str:
        """Override in tests. Real implementation uses PydanticAI streaming."""
        raise NotImplementedError("Must be implemented with real LLM")

    async def handle_document(
        self,
        request: DocumentRequest,
    ) -> AsyncIterator[SSEEvent]:
        asset_map = None

        # Step 1: Parse files if provided
        if request.files:
            yield SSEEvent(type="step_start", data={"step": "parsing"})
            try:
                from app.orchestrator.tools.parse_assets import parse_assets_tool
                asset_map = await parse_assets_tool(
                    files=request.files,
                    page_id=request.page_id,
                    workspace_id=request.workspace_id,
                )
                yield SSEEvent(
                    type="step_done",
                    data={
                        "step": "parsing",
                        "summary": f"解析完成: {asset_map.source_word_count} 字, {len(getattr(asset_map, 'images', []))} 张图片",
                    },
                )
            except Exception as e:
                yield SSEEvent(
                    type="step_error",
                    data={"step": "parsing", "error": f"文件解析失败: {str(e)[:200]}"},
                )

        # Step 2: Build prompt
        content = ""
        if asset_map and hasattr(asset_map, "full_text"):
            content = asset_map.full_text
        elif request.original_content:
            content = request.original_content

        system_prompt = self._build_system_prompt(
            request.instruction,
            request.system_prompt,
            request.template_prompt,
        )
        user_prompt = self._build_user_prompt(request.instruction, content)

        # Step 3: Stream LLM generation
        yield SSEEvent(type="step_start", data={"step": "generating"})
        full_content = await self._stream_llm(system_prompt, user_prompt)
        yield SSEEvent(type="step_done", data={"step": "generating"})

        # Step 4: Change summary (when original content is available)
        if request.original_content:
            summary = generate_change_summary(request.original_content, full_content, asset_map)
            yield SSEEvent(type="change_summary", data={
                "text_changes": summary.text_changes,
                "images_total": summary.images_total,
                "images_kept": summary.images_kept,
                "images_lost": summary.images_lost,
                "structure_preserved": summary.structure_preserved,
                "mermaid_preserved": summary.mermaid_preserved,
            })

        yield SSEEvent(type="done", data={"content": full_content})
```

- [ ] **Step 4: Run tests to verify GREEN**

Run: `cd agent-service && python -m pytest tests/orchestrator/test_engine_v3.py -v`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/orchestrator/engine_v3.py agent-service/tests/orchestrator/test_engine_v3.py
git commit -m "$(cat <<'EOF'
feat(ai-v3): add simplified 2-layer orchestrator engine
EOF
)"
```

### Task 4: Add FastAPI endpoints for document optimize and create

**Files:**
- Modify: `agent-service/app/main.py`
- Test: `agent-service/tests/integration/test_api_v3.py`

- [ ] **Step 1: Write the failing test**

```python
# agent-service/tests/integration/test_api_v3.py
import pytest
from httpx import AsyncClient
from app.main import app


@pytest.fixture
async def client():
    async with AsyncClient(app=app, base_url="http://test") as c:
        yield c


class TestDocumentOptimizeEndpoint:
    @pytest.mark.asyncio
    async def test_returns_sse_content_type(self, client):
        resp = await client.post(
            "/agent/document/optimize",
            json={"instruction": "优化措辞", "original_content": "测试内容"},
            headers={"X-Internal-Secret": "test-secret"},
        )
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers.get("content-type", "")


class TestDocumentCreateEndpoint:
    @pytest.mark.asyncio
    async def test_returns_sse_stream(self, client):
        resp = await client.post(
            "/agent/document/create",
            json={"instruction": "写一篇文档"},
            headers={"X-Internal-Secret": "test-secret"},
        )
        assert resp.status_code == 200
```

- [ ] **Step 2: Run tests to verify RED**

Run: `cd agent-service && python -m pytest tests/integration/test_api_v3.py -q`
Expected: FAIL (endpoints do not exist).

- [ ] **Step 3: Add endpoints to main.py**

Add after the existing `/agent/run` endpoint (around line 212 of `main.py`):

```python
@app.post("/agent/document/optimize", dependencies=[Depends(verify_internal_secret)])
async def optimize_document(request: Request):
    """V3: Document optimization endpoint with SSE streaming."""
    body = await request.json()
    doc_request = DocumentRequest(
        instruction=body.get("instruction", ""),
        original_content=body.get("original_content", ""),
        page_id=body.get("page_id", ""),
        files=body.get("files"),
        template_prompt=body.get("template_prompt", ""),
        system_prompt=body.get("system_prompt", ""),
        workspace_id=body.get("workspace_id", ""),
        diff_mode=body.get("diff_mode", False),
        editor_json=body.get("editor_json"),
    )
    engine = EngineV3()
    queue: asyncio.Queue = asyncio.Queue()

    async def _run():
        try:
            async for event in engine.handle_document(doc_request):
                await queue.put(event.to_dict())
        except Exception as e:
            await queue.put({"type": "error", "message": str(e)[:500]})
        finally:
            await queue.put(None)

    asyncio.create_task(_run())

    async def _event_generator():
        while True:
            event = await queue.get()
            if event is None:
                break
            yield {"data": json.dumps(event, ensure_ascii=False)}

    return EventSourceResponse(_event_generator())


@app.post("/agent/document/create", dependencies=[Depends(verify_internal_secret)])
async def create_document(request: Request):
    """V3: Document creation endpoint with SSE streaming."""
    body = await request.json()
    doc_request = DocumentRequest(
        instruction=body.get("instruction", ""),
        page_id=body.get("page_id", ""),
        files=body.get("files"),
        template_prompt=body.get("template_prompt", ""),
        system_prompt=body.get("system_prompt", ""),
        need_brief=body.get("need_brief", False),
        workspace_id=body.get("workspace_id", ""),
    )
    engine = EngineV3()
    queue: asyncio.Queue = asyncio.Queue()

    async def _run():
        try:
            async for event in engine.handle_document(doc_request):
                await queue.put(event.to_dict())
        except Exception as e:
            await queue.put({"type": "error", "message": str(e)[:500]})
        finally:
            await queue.put(None)

    asyncio.create_task(_run())

    async def _event_generator():
        while True:
            event = await queue.get()
            if event is None:
                break
            yield {"data": json.dumps(event, ensure_ascii=False)}

    return EventSourceResponse(_event_generator())
```

- [ ] **Step 4: Run tests to verify GREEN**

Run: `cd agent-service && python -m pytest tests/integration/test_api_v3.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/main.py agent-service/tests/integration/test_api_v3.py
git commit -m "$(cat <<'EOF'
feat(ai-v3): add document optimize and create FastAPI endpoints
EOF
)"
```

### Task 5: Add NestJS gateway routes

**Files:**
- Create: `apps/server/src/ee/ai/dto/document-optimize.dto.ts`
- Create: `apps/server/src/ee/ai/dto/document-create.dto.ts`
- Modify: `apps/server/src/ee/ai/ai.controller.ts`

- [ ] **Step 1: Create DTOs**

```typescript
// apps/server/src/ee/ai/dto/document-optimize.dto.ts
import { IsString, IsOptional, IsBoolean, IsObject, IsArray } from 'class-validator';

export class DocumentOptimizeDto {
  @IsString()
  pageId: string;

  @IsString()
  instruction: string;

  @IsOptional()
  @IsString()
  originalContent?: string;

  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsString()
  systemPrompt?: string;

  @IsOptional()
  @IsBoolean()
  diffMode?: boolean;

  @IsOptional()
  @IsObject()
  editorJson?: Record<string, unknown>;
}
```

```typescript
// apps/server/src/ee/ai/dto/document-create.dto.ts
import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class DocumentCreateDto {
  @IsString()
  pageId: string;

  @IsString()
  instruction: string;

  @IsOptional()
  @IsString()
  templateId?: string;

  @IsOptional()
  @IsString()
  systemPrompt?: string;

  @IsOptional()
  @IsBoolean()
  needBrief?: boolean;
}
```

- [ ] **Step 2: Add routes to AiController**

Add after line 399 of `apps/server/src/ee/ai/ai.controller.ts`:

```typescript
@Post('document/optimize')
async optimizeDocument(
  @Body() dto: DocumentOptimizeDto,
  @Req() req: FastifyRequest,
  @Res() res: FastifyReply,
) {
  const user = req.user;
  const workspace = req.raw['workspace'];

  // Resolve template prompt if templateId provided
  let templatePrompt = '';
  if (dto.templateId) {
    const template = await this.aiTemplateService.findById(dto.templateId);
    templatePrompt = template?.prompt || '';
  }

  // Get workspace system prompt
  const systemPrompt = dto.systemPrompt || workspace?.settings?.ai?.systemPrompt || '';

  // Forward to agent service
  const payload = {
    instruction: dto.instruction,
    original_content: dto.originalContent || '',
    page_id: dto.pageId,
    template_prompt: templatePrompt,
    system_prompt: systemPrompt,
    workspace_id: workspace?.id || '',
    diff_mode: dto.diffMode || false,
    editor_json: dto.editorJson || null,
  };

  await this.agentGatewayService.proxyAgentStream(
    '/agent/document/optimize',
    payload,
    req,
    res,
  );
}

@Post('document/create')
async createDocument(
  @Body() dto: DocumentCreateDto,
  @Req() req: FastifyRequest,
  @Res() res: FastifyReply,
) {
  const workspace = req.raw['workspace'];

  let templatePrompt = '';
  if (dto.templateId) {
    const template = await this.aiTemplateService.findById(dto.templateId);
    templatePrompt = template?.prompt || '';
  }

  const systemPrompt = dto.systemPrompt || workspace?.settings?.ai?.systemPrompt || '';

  const payload = {
    instruction: dto.instruction,
    page_id: dto.pageId,
    template_prompt: templatePrompt,
    system_prompt: systemPrompt,
    need_brief: dto.needBrief || false,
    workspace_id: workspace?.id || '',
  };

  await this.agentGatewayService.proxyAgentStream(
    '/agent/document/create',
    payload,
    req,
    res,
  );
}
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `cd apps/server && pnpm build 2>&1 | tail -10`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/ee/ai/dto/document-optimize.dto.ts apps/server/src/ee/ai/dto/document-create.dto.ts apps/server/src/ee/ai/ai.controller.ts
git commit -m "$(cat <<'EOF'
feat(ai-v3): add NestJS gateway routes for document optimize and create
EOF
)"
```

---

## Phase 2: Frontend Command Panel

### Task 6: Create v3 type definitions and new atoms

**Files:**
- Create: `apps/client/src/ee/ai/types/command.types.ts`
- Modify: `apps/client/src/ee/ai/components/ai-creator/ai-creator-atoms.ts`

- [ ] **Step 1: Create type definitions**

```typescript
// apps/client/src/ee/ai/types/command.types.ts

export interface ChangeSummary {
  text_changes: number;
  images_total: number;
  images_kept: number;
  images_lost: string[];
  structure_preserved: boolean;
  mermaid_preserved: boolean;
}

export interface EditorSnapshot {
  bodyJson: Record<string, unknown>;
  titleText: string;
  timestamp: number;
}

export interface RecentOp {
  id: string;
  type: 'optimize' | 'create' | 'selection_rewrite' | 'translate' | 'expand' | 'shorten' | 'tone' | 'summarize';
  summary: string;
  status: 'accepted' | 'rejected' | 'pending';
  timestamp: number;
}

export interface BlockChange {
  id: string;
  type: 'modified' | 'added' | 'deleted';
  blockType: string;
  path: string;
  oldText: string;
  newText: string;
  position: { from: number; to: number };
  accepted: boolean | null;
}

export type AiPanelMode = 'command' | 'review' | 'running' | 'hidden';

export type AiSessionState =
  | { mode: 'idle'; recentOps: RecentOp[] }
  | { mode: 'running'; operation: 'optimize' | 'create'; recentOps: RecentOp[] }
  | { mode: 'review'; snapshot: EditorSnapshot; changeSummary: ChangeSummary; pendingChanges?: BlockChange[]; recentOps: RecentOp[] }
  | { mode: 'error'; error: string; snapshot?: EditorSnapshot; recentOps: RecentOp[] };

export interface QuickAction {
  id: string;
  icon: string;
  label: string;
  instruction: string;
}

export const QUICK_ACTIONS: QuickAction[] = [
  { id: 'optimize', icon: '📝', label: '优化全文', instruction: 'Improve the writing quality of this document. Keep all images, tables, and code blocks unchanged.' },
  { id: 'translate', icon: '🌐', label: '翻译', instruction: 'Translate this document to {language}' },
  { id: 'expand', icon: '📏', label: '扩写', instruction: 'Expand this document with more details and examples' },
  { id: 'shorten', icon: '✂️', label: '缩写', instruction: 'Make this document more concise while keeping key points' },
  { id: 'tone', icon: '🎯', label: '调整语气', instruction: 'Rewrite this document in a {tone} tone' },
  { id: 'summarize', icon: '📋', label: '生成摘要', instruction: 'Generate a concise summary for this document' },
];
```

- [ ] **Step 2: Add new atoms**

Add to `apps/client/src/ee/ai/components/ai-creator/ai-creator-atoms.ts`:

```typescript
import { atom } from 'jotai';
import type { AiPanelMode } from '../../types/command.types';

export const aiPanelModeAtom = atom<AiPanelMode>('command');
```

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/ee/ai/types/command.types.ts apps/client/src/ee/ai/components/ai-creator/ai-creator-atoms.ts
git commit -m "$(cat <<'EOF'
feat(ai-v3): add v3 type definitions and panel mode atom
EOF
)"
```

### Task 7: Create useAiStream hook

**Files:**
- Create: `apps/client/src/ee/ai/hooks/useAiStream.ts`

- [ ] **Step 1: Implement SSE stream hook**

```typescript
// apps/client/src/ee/ai/hooks/useAiStream.ts
import { useRef, useCallback } from 'react';

export interface SSEEvent {
  type: string;
  [key: string]: unknown;
}

interface UseAiStreamOptions {
  onEvent: (event: SSEEvent) => void;
  onError: (error: string) => void;
  onComplete: () => void;
  heartbeatTimeout?: number;
}

export function useAiStream() {
  const abortRef = useRef<AbortController | null>(null);
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = useCallback(async (
    url: string,
    body: Record<string, unknown>,
    options: UseAiStreamOptions,
  ) => {
    const { onEvent, onError, onComplete, heartbeatTimeout = 30000 } = options;

    abortRef.current = new AbortController();
    let lastEventTime = Date.now();

    // Heartbeat watchdog
    watchdogRef.current = setInterval(() => {
      if (Date.now() - lastEventTime > heartbeatTimeout) {
        cleanup();
        onError('连接超时，请重试');
      }
    }, 5000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            lastEventTime = Date.now();
            try {
              const event = JSON.parse(line.slice(6)) as SSEEvent;
              if (event.type !== 'heartbeat') {
                onEvent(event);
              }
            } catch {
              // Skip malformed events
            }
          }
        }
      }

      onComplete();
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return;
      onError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      cleanup();
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    cleanup();
  }, []);

  function cleanup() {
    if (watchdogRef.current) {
      clearInterval(watchdogRef.current);
      watchdogRef.current = null;
    }
  }

  return { start, cancel };
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/client/src/ee/ai/hooks/useAiStream.ts
git commit -m "$(cat <<'EOF'
feat(ai-v3): add generic SSE stream hook with heartbeat watchdog
EOF
)"
```

### Task 8: Create useAiCommand hook

**Files:**
- Create: `apps/client/src/ee/ai/hooks/useAiCommand.ts`
- Create: `apps/client/src/ee/ai/services/ai-document-service.ts`

- [ ] **Step 1: Create document service**

```typescript
// apps/client/src/ee/ai/services/ai-document-service.ts
const API_BASE = '/api/ai';

export interface DocumentOptimizeParams {
  pageId: string;
  instruction: string;
  originalContent?: string;
  templateId?: string;
  diffMode?: boolean;
}

export interface DocumentCreateParams {
  pageId: string;
  instruction: string;
  templateId?: string;
  needBrief?: boolean;
}

export function getDocumentOptimizeUrl(): string {
  return `${API_BASE}/document/optimize`;
}

export function getDocumentCreateUrl(): string {
  return `${API_BASE}/document/create`;
}
```

- [ ] **Step 2: Create useAiCommand hook**

```typescript
// apps/client/src/ee/ai/hooks/useAiCommand.ts
import { useState, useCallback, useRef } from 'react';
import { useAtom } from 'jotai';
import { aiPanelModeAtom } from '../components/ai-creator/ai-creator-atoms';
import { useAiStream, type SSEEvent } from './useAiStream';
import { getDocumentOptimizeUrl, getDocumentCreateUrl } from '../services/ai-document-service';
import type {
  AiSessionState, ChangeSummary, EditorSnapshot, RecentOp,
} from '../types/command.types';

const RECENT_OPS_KEY = (pageId: string) => `docmost.ai.recentOps:${pageId}`;
const MAX_RECENT_OPS = 20;

function loadRecentOps(pageId: string): RecentOp[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_OPS_KEY(pageId)) || '[]');
  } catch {
    return [];
  }
}

function saveRecentOps(pageId: string, ops: RecentOp[]) {
  localStorage.setItem(RECENT_OPS_KEY(pageId), JSON.stringify(ops.slice(0, MAX_RECENT_OPS)));
}

interface UseAiCommandOptions {
  pageId: string;
  editor: any;
  titleEditor?: any;
}

export function useAiCommand({ pageId, editor, titleEditor }: UseAiCommandOptions) {
  const [, setPanelMode] = useAtom(aiPanelModeAtom);
  const [sessionState, setSessionState] = useState<AiSessionState>({
    mode: 'idle',
    recentOps: loadRecentOps(pageId),
  });
  const snapshotRef = useRef<EditorSnapshot | null>(null);
  const contentRef = useRef<string>('');
  const { start, cancel: cancelStream } = useAiStream();

  const submitOptimize = useCallback(async (instruction: string, templateId?: string) => {
    if (!editor) return;

    // Save snapshot
    snapshotRef.current = {
      bodyJson: editor.getJSON(),
      titleText: titleEditor?.getText() || '',
      timestamp: Date.now(),
    };

    // Lock editor
    editor.setEditable(false);
    setPanelMode('running');
    setSessionState(prev => ({
      mode: 'running',
      operation: 'optimize' as const,
      recentOps: prev.recentOps,
    }));
    contentRef.current = '';

    // Start SSE stream
    await start(getDocumentOptimizeUrl(), {
      pageId,
      instruction,
      originalContent: editor.storage?.markdown?.getMarkdown?.() || '',
      templateId,
    }, {
      onEvent: (event: SSEEvent) => {
        if (event.type === 'content') {
          contentRef.current += (event.chunk as string) || '';
        }
        if (event.type === 'change_summary') {
          const summary = event as unknown as ChangeSummary;
          setSessionState(prev => ({
            mode: 'review',
            snapshot: snapshotRef.current!,
            changeSummary: summary,
            recentOps: prev.recentOps,
          }));
        }
      },
      onError: (error: string) => {
        // Restore snapshot on error
        if (snapshotRef.current) {
          editor.commands.setContent(snapshotRef.current.bodyJson);
        }
        editor.setEditable(true);
        setPanelMode('command');
        setSessionState(prev => ({
          mode: 'error',
          error,
          snapshot: snapshotRef.current || undefined,
          recentOps: prev.recentOps,
        }));
      },
      onComplete: () => {
        // Apply content to editor
        if (contentRef.current) {
          editor.chain().setContent(contentRef.current).run();
        }
        editor.setEditable(true);
        setPanelMode('review');
      },
    });
  }, [editor, pageId, titleEditor, start, setPanelMode]);

  const acceptChanges = useCallback(() => {
    // Content is already in editor, just record the operation
    const ops = sessionState.recentOps;
    const newOp: RecentOp = {
      id: crypto.randomUUID(),
      type: 'optimize',
      summary: `修改了 ${(sessionState as any).changeSummary?.text_changes || 0} 处`,
      status: 'accepted',
      timestamp: Date.now(),
    };
    const updatedOps = [newOp, ...ops];
    saveRecentOps(pageId, updatedOps);
    setPanelMode('command');
    setSessionState({ mode: 'idle', recentOps: updatedOps });
    snapshotRef.current = null;
  }, [sessionState, pageId, setPanelMode]);

  const rejectChanges = useCallback(() => {
    // Restore snapshot
    if (snapshotRef.current && editor) {
      editor.commands.setContent(snapshotRef.current.bodyJson);
    }
    const ops = sessionState.recentOps;
    const newOp: RecentOp = {
      id: crypto.randomUUID(),
      type: 'optimize',
      summary: '已撤销',
      status: 'rejected',
      timestamp: Date.now(),
    };
    const updatedOps = [newOp, ...ops];
    saveRecentOps(pageId, updatedOps);
    setPanelMode('command');
    setSessionState({ mode: 'idle', recentOps: updatedOps });
    snapshotRef.current = null;
  }, [sessionState, editor, pageId, setPanelMode]);

  const cancel = useCallback(() => {
    cancelStream();
    if (snapshotRef.current && editor) {
      editor.commands.setContent(snapshotRef.current.bodyJson);
    }
    editor?.setEditable(true);
    setPanelMode('command');
    setSessionState(prev => ({ mode: 'idle', recentOps: prev.recentOps }));
  }, [cancelStream, editor, setPanelMode]);

  return {
    sessionState,
    submitOptimize,
    acceptChanges,
    rejectChanges,
    cancel,
    addRecentOp: (op: RecentOp) => {
      const ops = [op, ...sessionState.recentOps];
      saveRecentOps(pageId, ops);
      setSessionState(prev => ({ ...prev, recentOps: ops }));
    },
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/ee/ai/hooks/useAiCommand.ts apps/client/src/ee/ai/services/ai-document-service.ts
git commit -m "$(cat <<'EOF'
feat(ai-v3): add useAiCommand hook with snapshot and SSE streaming
EOF
)"
```

### Task 9: Create AiCommandPanel component

**Files:**
- Create: `apps/client/src/ee/ai/components/ai-command-panel/AiCommandPanel.tsx`
- Create: `apps/client/src/ee/ai/components/ai-command-panel/QuickActions.tsx`
- Create: `apps/client/src/ee/ai/components/ai-command-panel/CommandInput.tsx`
- Create: `apps/client/src/ee/ai/components/ai-command-panel/RecentOps.tsx`

> Note: These are Mantine 8 components following Docmost's existing style patterns (see `ai-creator.module.css` for reference colors and spacing).

- [ ] **Step 1: Create QuickActions component**

```typescript
// apps/client/src/ee/ai/components/ai-command-panel/QuickActions.tsx
import { SimpleGrid, Paper, Text, Stack } from '@mantine/core';
import { QUICK_ACTIONS, type QuickAction } from '../../types/command.types';

interface QuickActionsProps {
  onAction: (action: QuickAction) => void;
  disabled?: boolean;
}

export function QuickActions({ onAction, disabled }: QuickActionsProps) {
  return (
    <Stack gap={8}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={500}>快捷操作</Text>
      <SimpleGrid cols={2} spacing={6}>
        {QUICK_ACTIONS.map((action) => (
          <Paper
            key={action.id}
            p="xs"
            radius="md"
            withBorder
            style={{ cursor: disabled ? 'not-allowed' : 'pointer', textAlign: 'center', opacity: disabled ? 0.5 : 1 }}
            onClick={() => !disabled && onAction(action)}
          >
            <Text size="lg">{action.icon}</Text>
            <Text size="xs" c="dimmed">{action.label}</Text>
          </Paper>
        ))}
      </SimpleGrid>
    </Stack>
  );
}
```

- [ ] **Step 2: Create RecentOps, CommandInput, and main AiCommandPanel**

These follow the same Mantine pattern. Implement each with proper props and Docmost styling. The main `AiCommandPanel.tsx` composes all sub-components and connects to `useAiCommand`.

- [ ] **Step 3: Verify build**

Run: `cd apps/client && pnpm build 2>&1 | tail -10`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-command-panel/
git commit -m "$(cat <<'EOF'
feat(ai-v3): add AiCommandPanel with quick actions, input, and recent ops
EOF
)"
```

### Task 10: Create ReviewSidebar component

**Files:**
- Create: `apps/client/src/ee/ai/components/ai-review-sidebar/ReviewSidebar.tsx`

- [ ] **Step 1: Implement ReviewSidebar**

```typescript
// apps/client/src/ee/ai/components/ai-review-sidebar/ReviewSidebar.tsx
import { Stack, Paper, Text, Button, Group, Badge, Divider } from '@mantine/core';
import type { ChangeSummary } from '../../types/command.types';

interface ReviewSidebarProps {
  changeSummary: ChangeSummary;
  onAccept: () => void;
  onReject: () => void;
  onReoptimize: () => void;
}

export function ReviewSidebar({ changeSummary, onAccept, onReject, onReoptimize }: ReviewSidebarProps) {
  const imagesOk = changeSummary.images_kept === changeSummary.images_total;

  return (
    <Stack gap="md" p="md">
      <Text size="sm" fw={600}>📋 变更摘要</Text>

      <Paper p="sm" radius="md" withBorder>
        <Stack gap={4}>
          <Group justify="space-between">
            <Text size="xs">文字修改</Text>
            <Badge size="sm" variant="light">{changeSummary.text_changes} 处</Badge>
          </Group>
          <Group justify="space-between">
            <Text size="xs">图片状态</Text>
            <Badge size="sm" variant="light" color={imagesOk ? 'teal' : 'red'}>
              {changeSummary.images_kept}/{changeSummary.images_total} 保留 {imagesOk ? '✓' : '⚠'}
            </Badge>
          </Group>
          <Group justify="space-between">
            <Text size="xs">结构保留</Text>
            <Badge size="sm" variant="light" color={changeSummary.structure_preserved ? 'teal' : 'orange'}>
              {changeSummary.structure_preserved ? '✓' : '已调整'}
            </Badge>
          </Group>
          {changeSummary.mermaid_preserved === false && (
            <Group justify="space-between">
              <Text size="xs">Mermaid 图表</Text>
              <Badge size="sm" variant="light" color="red">⚠ 已变更</Badge>
            </Group>
          )}
        </Stack>
      </Paper>

      {!imagesOk && (
        <Paper p="xs" radius="md" bg="red.0" c="red.7">
          <Text size="xs">⚠ 部分图片丢失: {changeSummary.images_lost.length} 张</Text>
        </Paper>
      )}

      <Divider />

      <Stack gap="xs">
        <Button fullWidth color="teal" onClick={onAccept}>✅ 接受修改</Button>
        <Button fullWidth variant="light" onClick={onReject}>↩️ 撤销（恢复原文）</Button>
        <Button fullWidth variant="subtle" onClick={onReoptimize}>🔄 重新优化</Button>
      </Stack>

      <Text size="xs" c="dimmed" ta="center">💡 也可用 Ctrl+Z 撤销</Text>
    </Stack>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-review-sidebar/
git commit -m "$(cat <<'EOF'
feat(ai-v3): add ReviewSidebar with change summary display
EOF
)"
```

### Task 11: Mount command panel with feature flag

**Files:**
- Modify: `apps/client/src/features/editor/page-editor.tsx`

- [ ] **Step 1: Add feature flag and conditional rendering**

In `page-editor.tsx`, add conditional rendering:

```typescript
// At the top, import
import { AiCommandPanel } from '@/ee/ai/components/ai-command-panel/AiCommandPanel';

// In the component, add feature flag check
const useV3 = import.meta.env.VITE_AI_CREATOR_V3 === 'true';

// In the JSX, where the current AI panel is mounted, add:
{useV3 ? (
  <AiCommandPanel pageId={pageId} editor={editor} titleEditor={titleEditor} />
) : (
  <AiCreatorPanel /> // existing panel
)}
```

- [ ] **Step 2: Verify build and manual check**

Run: `cd apps/client && pnpm build 2>&1 | tail -10`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/features/editor/page-editor.tsx
git commit -m "$(cat <<'EOF'
feat(ai-v3): mount command panel with VITE_AI_CREATOR_V3 feature flag
EOF
)"
```

### Task 12: Browser verification — TC-01 to TC-04

> Use `mcp__claude-in-chrome__*` tools to verify in real Chrome browser.

- [ ] **Step 1: Start dev server**

Run: `pnpm dev` (in background)

- [ ] **Step 2: Set feature flag and rebuild**

Set `VITE_AI_CREATOR_V3=true` in `.env`, restart dev server.

- [ ] **Step 3: Execute TC-01 (Command panel renders)**

Open Chrome → navigate to a page with content → verify:
- Right-side AI command panel visible (300px width)
- 6 quick action buttons in 2x3 grid
- Input box at bottom with toolbar
- Panel collapsible

- [ ] **Step 4: Execute TC-02 (Document optimization — plain text)**

Click [优化全文] → verify:
- Panel shows "running" state
- After completion: ReviewSidebar appears with change summary
- Click [撤销] → content restored

- [ ] **Step 5: Execute TC-03 (Document optimization — with images)**

On a page with images → click [优化全文] → verify:
- Change summary shows "X/X 保留 ✓"
- Images still present in editor

- [ ] **Step 6: Screenshot and record results**

Use `mcp__claude-in-chrome__screenshot_mcp` to capture each state.

- [ ] **Step 7: Commit verification results**

```bash
git commit --allow-empty -m "$(cat <<'EOF'
test: Phase 2 browser verification TC-01 to TC-04 passed
EOF
)"
```

---

## Phase 3: ai-menu Decoupling

### Task 13: Decouple ai-menu from ai-creator atoms

**Files:**
- Modify: `apps/client/src/ee/ai/components/editor/ai-menu/ai-menu.tsx`
- Test: `apps/client/src/ee/ai/components/__tests__/ai-menu-isolation.test.tsx`

- [ ] **Step 1: Audit current ai-menu atom dependencies**

Read `ai-menu.tsx` and identify all imports from `ai-creator-atoms.ts` or `ai-creator-*.ts`. These must be removed or replaced.

- [ ] **Step 2: Remove shared atom dependencies**

In `ai-menu.tsx`:
- Remove imports of `aiCreatorSelectionAtom`, `aiCreatorSelectionRangeAtom`
- Use ai-menu's own local state for selection
- After successful operation (replace/insert), write to `recentOps` via `addRecentOp()` from a shared utility

- [ ] **Step 3: Write isolation test**

```typescript
// apps/client/src/ee/ai/components/__tests__/ai-menu-isolation.test.tsx
import { describe, it, expect } from 'vitest';

describe('ai-menu isolation', () => {
  it('does not import from ai-creator-atoms', async () => {
    const source = await import.meta.glob(
      '../editor/ai-menu/ai-menu.tsx',
      { as: 'raw', eager: true }
    );
    const content = Object.values(source)[0] as string;
    expect(content).not.toContain('aiCreatorSelectionAtom');
    expect(content).not.toContain('aiCreatorAutoInsertAtom');
    expect(content).not.toContain('agentModeAtom');
  });
});
```

- [ ] **Step 4: Run test**

Run: `cd apps/client && pnpm vitest run src/ee/ai/components/__tests__/ai-menu-isolation.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/ee/ai/components/editor/ai-menu/ apps/client/src/ee/ai/components/__tests__/ai-menu-isolation.test.tsx
git commit -m "$(cat <<'EOF'
refactor(ai-v3): decouple ai-menu from ai-creator atoms and state
EOF
)"
```

### Task 14: Browser verification — TC-05, TC-06

- [ ] **Step 1: Execute TC-05 (Selection rewriting independence)**

Select text → Bubble Menu → Ask AI → 润色 → Replace → Verify:
- Command panel's RecentOps shows the operation
- No chat bubbles appear in command panel
- No state contamination

- [ ] **Step 2: Execute TC-06 (Consecutive selection rewrites)**

Three consecutive selection rewrites → verify no conflicts, all in RecentOps.

- [ ] **Step 3: Commit**

```bash
git commit --allow-empty -m "$(cat <<'EOF'
test: Phase 3 browser verification TC-05, TC-06 passed
EOF
)"
```

---

## Phase 4: Creation from Scratch

### Task 15: Implement creation flow in command panel

**Files:**
- Modify: `apps/client/src/ee/ai/hooks/useAiCommand.ts` — add `submitCreate()`
- Modify: `apps/client/src/ee/ai/components/ai-command-panel/AiCommandPanel.tsx` — detect blank page

- [ ] **Step 1: Add submitCreate to useAiCommand**

```typescript
const submitCreate = useCallback(async (instruction: string, templateId?: string, needBrief = false) => {
  if (!editor) return;

  setPanelMode('running');
  setSessionState(prev => ({ mode: 'running', operation: 'create', recentOps: prev.recentOps }));
  contentRef.current = '';

  await start(getDocumentCreateUrl(), {
    pageId,
    instruction,
    templateId,
    needBrief,
  }, {
    onEvent: (event: SSEEvent) => {
      if (event.type === 'content') {
        const chunk = (event.chunk as string) || '';
        contentRef.current += chunk;
        // Stream into editor
        // TODO: use markdownToHtml + insertContent for streaming
      }
    },
    onError: (error: string) => {
      setPanelMode('command');
      setSessionState(prev => ({ mode: 'error', error, recentOps: prev.recentOps }));
    },
    onComplete: () => {
      if (contentRef.current) {
        editor.chain().setContent(contentRef.current).run();
      }
      setPanelMode('command');
      const ops = sessionState.recentOps;
      const newOp: RecentOp = {
        id: crypto.randomUUID(),
        type: 'create',
        summary: '已创建文档',
        status: 'accepted',
        timestamp: Date.now(),
      };
      const updatedOps = [newOp, ...ops];
      saveRecentOps(pageId, updatedOps);
      setSessionState({ mode: 'idle', recentOps: updatedOps });
    },
  });
}, [editor, pageId, start, setPanelMode, sessionState]);
```

- [ ] **Step 2: Detect blank page in AiCommandPanel**

```typescript
const isBlankPage = !editor?.getText()?.trim();
// If blank page, submitCreate instead of submitOptimize
```

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/ee/ai/hooks/useAiCommand.ts apps/client/src/ee/ai/components/ai-command-panel/AiCommandPanel.tsx
git commit -m "$(cat <<'EOF'
feat(ai-v3): add creation from scratch flow with blank page detection
EOF
)"
```

### Task 16: Browser verification — TC-07, TC-08

- [ ] **Step 1: Execute TC-07 (Blank page creation)**
- [ ] **Step 2: Execute TC-08 (Creation with file upload)**
- [ ] **Step 3: Commit**

---

## Phase 5: Cleanup Old Code

### Task 17: Remove deprecated frontend components

**Files:**
- Delete: All files listed in "Files to delete" section above

- [ ] **Step 1: Remove old panel components**

Delete the listed files. Update any imports that reference them.

- [ ] **Step 2: Remove deprecated atoms**

Remove `aiCreatorAutoInsertAtom`, `agentModeAtom` from `ai-creator-atoms.ts` (if not used elsewhere).

- [ ] **Step 3: Verify build**

Run: `cd apps/client && pnpm build 2>&1 | tail -10`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(ai-v3): remove deprecated AI Creator v2 components
EOF
)"
```

### Task 18: Remove deprecated backend code

- [ ] **Step 1: Remove backend files**

Delete: `section_writer.py`, `section_revision.py`, `create_blueprint.py`, `write_tools.py`, `evaluate.py`, `fix_tools.py`, `evaluator.py`, `consistency_checker.py`, `fixer.py`

- [ ] **Step 2: Verify backend tests still pass**

Run: `cd agent-service && python -m pytest tests/ -q --tb=short 2>&1 | tail -20`
Expected: Pre-existing tests for deleted modules will fail. Remove those test files too.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor(ai-v3): remove deprecated backend orchestrator components (~2240 lines)
EOF
)"
```

### Task 19: Browser regression — TC-09

- [ ] **Step 1: Execute TC-01 through TC-08 again**
- [ ] **Step 2: Check console for errors**
- [ ] **Step 3: Commit**

---

## Phase 6: v2 Inline Diff

### Task 20: Implement frontend diff computation

**Files:**
- Create: `apps/client/src/ee/ai/components/ai-review/DiffDecorationPlugin.ts`
- Create: `apps/client/src/ee/ai/components/ai-review-sidebar/ChangeList.tsx`

- [ ] **Step 1: Implement computeEditorDiff**

The diff is computed entirely on the frontend using ProseMirror Node comparison (as specified in spec section 13.8).

- [ ] **Step 2: Implement DiffDecorationPlugin**

ProseMirror Plugin using `Decoration.inline` for deletions and `Decoration.widget` for insertions and accept/reject buttons (as specified in spec section 7.3).

- [ ] **Step 3: Implement ChangeList component**

Mantine-based list of changes with progress bar, per-change accept/reject buttons, and click-to-jump functionality.

- [ ] **Step 4: Integrate with useAiReview hook**

```typescript
// apps/client/src/ee/ai/hooks/useAiReview.ts
export function useAiReview(editor: any, changes: BlockChange[]) {
  // Register DiffDecorationPlugin
  // Track accepted/rejected via Map
  // acceptChange(id), rejectChange(id), acceptAll(), rejectAll()
  // applyDecisions() → batch apply and remove plugin
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/ee/ai/components/ai-review/ apps/client/src/ee/ai/hooks/useAiReview.ts
git commit -m "$(cat <<'EOF'
feat(ai-v3): add v2 inline diff decorations and review UI
EOF
)"
```

### Task 21: Browser verification — TC-11 to TC-14

- [ ] **Step 1: Execute TC-11 (Inline diff basic)**
- [ ] **Step 2: Execute TC-12 (Per-change accept/reject)**
- [ ] **Step 3: Execute TC-13 (Change list jump-to)**
- [ ] **Step 4: Execute TC-14 (Full reject = restore)**
- [ ] **Step 5: Commit**

---

## Notes for the Implementer

- **Never delete a file without first verifying it has no remaining imports.** Use `grep -r "filename" apps/ agent-service/` before deleting.
- **The NestJS gateway uses `http.request` (not `fetch`) for SSE.** This is non-negotiable — `fetch` buffers SSE on Node.js.
- **MineRU configuration requires `MINERU_ENABLED=true` and valid `MINERU_API_TOKEN`.** Tests should mock MineRU, not call the real API.
- **Feature flag `VITE_AI_CREATOR_V3` is build-time (Vite).** Changing it requires a rebuild, not just a page refresh.
- **Yjs collaboration**: When implementing `setContent()`, ensure `Y.UndoManager` is used for undo, not ProseMirror History (see spec section 13.2).
- **Markdown serialization**: Use the existing `prosemirrorToMarkdown()` from `@docmost/editor-ext` for `originalContent` (see spec section 13.3).

## Success Criteria

- [ ] All Phase 1-5 backend tests pass
- [ ] All Phase 2-4 frontend component tests pass
- [ ] Browser TC-01 through TC-10 pass (v1 complete)
- [ ] Browser TC-11 through TC-14 pass (v2 complete)
- [ ] engine.py v3 is under 400 lines
- [ ] No console errors in browser
- [ ] Feature flag toggle works (v3 on/off)

---

## Errata: Plan Review Fixes

> 以下修正来自 plan review，实施时以此为准。原文中的对应部分应视为被替代。

### E1: NestJS 路由归属修正（Critical）

**问题**: Task 5 将新路由加到 `AiController`，但 `AiController` 不注入 `AgentGatewayService`，且没有 `http.request` SSE 代理能力。`proxyAgentStream()` 是 `AgentGatewayController` 的私有方法。

**修正**: 新路由加到 `AgentGatewayController`（而非 `AiController`），复用其已有的 `http.request` SSE 代理基础设施。

```typescript
// apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts
// 在现有 @Post('run') 之后添加：

@Post('document/optimize')
async optimizeDocument(
  @Body() dto: DocumentOptimizeDto,
  @Req() req: FastifyRequest,
  @Res() res: FastifyReply,
) {
  const workspace = req.raw['workspace'];
  let templatePrompt = '';
  if (dto.templateId) {
    const template = await this.aiTemplateService.findById(dto.templateId);
    templatePrompt = template?.prompt || '';
  }
  const systemPrompt = dto.systemPrompt || workspace?.settings?.ai?.systemPrompt || '';

  const payload = {
    instruction: dto.instruction,
    original_content: dto.originalContent || '',
    page_id: dto.pageId,
    template_prompt: templatePrompt,
    system_prompt: systemPrompt,
    workspace_id: workspace?.id || '',
    diff_mode: dto.diffMode || false,
    editor_json: dto.editorJson || null,
  };

  // 复用已有的 http.request SSE 代理（非 fetch）
  return this.proxyAgentStream('/agent/document/optimize', payload, req, res);
}

@Post('document/create')
async createDocument(
  @Body() dto: DocumentCreateDto,
  @Req() req: FastifyRequest,
  @Res() res: FastifyReply,
) {
  const workspace = req.raw['workspace'];
  let templatePrompt = '';
  if (dto.templateId) {
    const template = await this.aiTemplateService.findById(dto.templateId);
    templatePrompt = template?.prompt || '';
  }
  const systemPrompt = dto.systemPrompt || workspace?.settings?.ai?.systemPrompt || '';

  const payload = {
    instruction: dto.instruction,
    page_id: dto.pageId,
    template_prompt: templatePrompt,
    system_prompt: systemPrompt,
    need_brief: dto.needBrief || false,
    workspace_id: workspace?.id || '',
  };

  return this.proxyAgentStream('/agent/document/create', payload, req, res);
}
```

前端 API URL 相应修改为 `/api/agent/document/optimize` 和 `/api/agent/document/create`（走 agent 前缀）。

### E2: `_stream_llm` 必须实现真正的流式输出（Critical）

**问题**: Plan 中 `_stream_llm` 只返回完整字符串，无法产生流式 SSE 事件，前端在整个生成期间收不到任何数据。

**修正**: `_stream_llm` 改为 async generator，逐 chunk yield：

```python
# agent-service/app/orchestrator/engine_v3.py

async def handle_document(self, request: DocumentRequest) -> AsyncIterator[SSEEvent]:
    # ... (Step 1, 2 同前) ...

    # Step 3: 真正的流式生成
    yield SSEEvent(type="step_start", data={"step": "generating"})

    from app.orchestrator.llm_factory import create_llm
    model = create_llm()  # PydanticAI model

    full_content = ""
    async with model.run_stream(user_prompt, system_prompt=system_prompt) as stream:
        async for chunk in stream.stream_text():
            full_content += chunk
            yield SSEEvent(type="content", data={"chunk": chunk})

    yield SSEEvent(type="step_done", data={"step": "generating"})
    # ... (Step 4 同前) ...
```

测试中 mock `_stream_llm` 改为 mock `create_llm` 返回一个 fake stream。

### E3: `setContent()` 必须先转 HTML（Critical）

**问题**: `contentRef.current` 是原始 markdown，TipTap `setContent()` 需要 HTML 或 JSON。

**修正**: 在 `useAiCommand.ts` 中所有 `setContent` 调用前加转换：

```typescript
import { markdownToHtml } from '@docmost/editor-ext';

// onComplete 中：
if (contentRef.current) {
  const html = markdownToHtml(contentRef.current);
  editor.chain().setContent(html).run();
}

// submitCreate 的 onComplete 中同理
```

### E4: Yjs 协作安全实现（Critical）

**问题**: 无 Y.UndoManager 使用，无 awareness 锁定。

**修正**: 在 `useAiCommand` 中添加 Yjs 安全逻辑。这需要一个新的 Task（插入为 Task 8.5）：

```typescript
// apps/client/src/ee/ai/hooks/useAiCommand.ts

import * as Y from 'yjs';

// 在 submitOptimize 中：

// 1. 广播 AI 操作状态（其他客户端看到提示并禁止编辑）
const provider = editor.storage?.collaboration?.provider;
if (provider?.awareness) {
  provider.awareness.setLocalStateField('aiOperating', {
    active: true,
    userId: currentUser.id,
    operation: 'optimize',
  });
}

// 2. 使用 Y.UndoManager 管理 undo
const ydoc = provider?.document;
if (ydoc) {
  const undoManager = new Y.UndoManager(
    ydoc.getXmlFragment('default'),
    { captureTimeout: 0 }
  );
  undoManagerRef.current = undoManager;
  undoManager.stopCapturing();  // 后续操作作为新的 undo group
}

// 在 rejectChanges 中：
if (undoManagerRef.current) {
  undoManagerRef.current.undo();  // Yjs 层面的 undo，协作安全
} else {
  // 降级：直接恢复 snapshot JSON
  editor.commands.setContent(snapshotRef.current.bodyJson);
}

// 操作结束后清除 awareness：
if (provider?.awareness) {
  provider.awareness.setLocalStateField('aiOperating', null);
}
```

### E5: 后端心跳循环（Important）

在 `handle_document` 中启动并行心跳任务：

```python
# agent-service/app/orchestrator/engine_v3.py

async def handle_document(self, request):
    heartbeat_task = asyncio.create_task(self._heartbeat(request.queue))
    try:
        # ... 正常流程 ...
        pass
    finally:
        heartbeat_task.cancel()

async def _heartbeat(self, queue: asyncio.Queue, interval: float = 10.0):
    import time
    while True:
        await asyncio.sleep(interval)
        await queue.put({"type": "heartbeat", "timestamp": time.time()})
```

注意：`handle_document` 是 async generator，心跳需在调用方（`main.py` 的 `_run` 函数）中启动。

### E6: Markdown 序列化修正（Important）

`originalContent` 的获取改为使用 `@docmost/editor-ext` 的序列化器：

```typescript
// useAiCommand.ts 中 submitOptimize：
import { prosemirrorToMarkdown } from '@docmost/editor-ext';

const originalContent = prosemirrorToMarkdown(editor.state.doc, editor.schema);
```

替代原先的 `editor.storage?.markdown?.getMarkdown?.()` 调用。

### E7: 大文档截断（Important）

在 `engine_v3.py` 的 `handle_document` Step 2 后添加：

```python
from app.utils.text import estimate_tokens

MAX_INPUT_TOKENS = 100_000

estimated = estimate_tokens(content)
if estimated > MAX_INPUT_TOKENS:
    content = content[:int(len(content) * MAX_INPUT_TOKENS / estimated * 0.8)]
    yield SSEEvent(type="warning", data={
        "message": f"文档较大（约 {estimated} tokens），已截取部分内容进行优化"
    })
```

### E8: ai-menu 解耦修正（Important）

**问题**: Plan reviewer 确认 `ai-menu.tsx` 实际上**已经不直接导入** `ai-creator-atoms.ts`。Task 13 的解耦工作基于错误前提。

**修正**: Task 13 改为：
1. **审计确认** ai-menu 确实没有 ai-creator 依赖（验证性步骤）
2. **添加 recentOps 写入**：ai-menu 操作完成后写入 localStorage recentOps
3. **行为测试**：验证 ai-menu replace/insert 操作后 recentOps 更新

### E9: stale closure 修复（Important）

`submitCreate` 的 `onComplete` 中使用 `sessionState.recentOps`，但 `sessionState` 在闭包创建时被捕获。

**修正**: 使用 `useRef` 替代直接访问 state：

```typescript
const recentOpsRef = useRef<RecentOp[]>(loadRecentOps(pageId));

// 每次 sessionState.recentOps 变化时同步到 ref
useEffect(() => {
  recentOpsRef.current = sessionState.recentOps;
}, [sessionState.recentOps]);

// onComplete 中使用 ref：
const ops = recentOpsRef.current;
```

### E10: 翻译/语气需要参数选择 UI（Important）

「翻译」和「调整语气」快捷按钮需要弹出二级选择器：

```typescript
// QuickActions.tsx 中：
const handleAction = (action: QuickAction) => {
  if (action.id === 'translate') {
    // 弹出 Mantine Select 语言选择
    openLanguageModal((lang) => {
      const instruction = action.instruction.replace('{language}', lang);
      onAction({ ...action, instruction });
    });
    return;
  }
  if (action.id === 'tone') {
    // 弹出 Mantine Select 语气选择
    openToneModal((tone) => {
      const instruction = action.instruction.replace('{tone}', tone);
      onAction({ ...action, instruction });
    });
    return;
  }
  onAction(action);
};

// 语言列表：中文, English, 日本語, 한국어, Español, Français, Deutsch, Português, Italiano, Nederlands, Svenska
// 语气列表：专业, 友好, 正式, 轻松, 学术
```

### E11: v2 File Map 修正

从 File Map 中移除后端 diff 文件（v2 diff 在前端计算）：
- ~~`agent-service/app/orchestrator/tools/diff_engine.py`~~ → 删除
- ~~`agent-service/tests/orchestrator/test_diff_engine.py`~~ → 删除

已替换为：
- `apps/client/src/ee/ai/utils/editor-diff.ts` — 前端 ProseMirror diff
- `apps/client/src/ee/ai/utils/__tests__/editor-diff.test.ts` — diff 测试
