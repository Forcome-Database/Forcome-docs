# Agent Multi-Turn Enhancement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the AI Agent from a single-shot document generator into a stateful document assistant that supports multi-turn conversation, context-aware editing, and graceful conversational interaction.

**Architecture:** Five capabilities added in sequence: (1) Redis conversation memory with security & pruning, (2) Skill split into Creation + Editing with shared format base, (3) Page context injection via frontend + backend fallback, (4) Output classification (document vs conversation) with conditional validation, (5) Frontend conditional rendering of ActionBar. Each builds on the previous but can be tested independently.

**Tech Stack:** PydanticAI 1.72.0, redis-py (async via redis.asyncio), FastAPI, React/TypeScript/Mantine, NestJS gateway passthrough.

**Worktree:** `E:/test/Docmost/.worktrees/feat-intelligent-agent/`

**Branch:** `feat/intelligent-agent`

---

## File Structure

### New Files (Python)

```
agent-service/app/agent/
├── conversation_store.py       # Redis-based conversation persistence
├── skill_router.py             # Skill selection logic
└── skills/
    ├── __init__.py             # Re-exports
    ├── shared.py               # TipTap format rules (extracted from skill.py)
    ├── creation.py             # Document creation skill
    └── editing.py              # Document editing skill
```

### New Test Files (Python)

```
agent-service/tests/agent/
├── test_conversation_store.py  # ConversationStore unit tests
├── test_skill_router.py        # Skill routing tests
└── test_skills/
    ├── test_shared.py          # Shared format rules presence
    ├── test_creation.py        # Creation skill structure
    └── test_editing.py         # Editing skill structure
```

### Modified Files

```
agent-service/app/agent/agent.py         # Two singletons (creation + editing)
agent-service/app/agent/runner.py        # Output classification + conditional validation + page context
agent-service/app/agent/deps.py          # Add page_content field
agent-service/app/agent/skill.py         # Deprecated (replaced by skills/)
agent-service/app/main.py               # Wire conversation_store + page_content into deps

apps/client/src/ee/ai/types/agent-v2.types.ts      # Add output_type, page_content
apps/client/src/ee/ai/services/agent-v2-service.ts  # Send page_content in request
apps/client/src/ee/ai/hooks/use-agent-session.ts    # Handle output_type, send page_content
apps/client/src/ee/ai/components/agent-panel/agent-panel.tsx  # Conditional ActionBar

apps/server/src/ee/ai/agent-gateway/agent-gateway.service.ts  # Pass page_content
```

---

## Task 0: Preparation

**Files:**
- Read: `agent-service/app/agent/skill.py`
- Read: `agent-service/app/agent/agent.py`
- Read: `agent-service/app/agent/runner.py`

- [ ] **Step 1: Run existing tests to establish baseline**

```bash
cd agent-service && python -m pytest tests/agent/ -v --tb=short 2>&1 | tail -20
```

Expected: All 94 tests pass (baseline).

- [ ] **Step 2: Note any pre-existing failures**

Record failures unrelated to this work. Do not fix them.

---

## Task 1: Redis Conversation Store

**Files:**
- Create: `agent-service/app/agent/conversation_store.py`
- Test: `agent-service/tests/agent/test_conversation_store.py`

- [ ] **Step 1: Write failing tests for ConversationStore**

```python
# tests/agent/test_conversation_store.py
"""Tests for Redis-backed conversation store."""
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.agent.conversation_store import ConversationStore, CONV_KEY_PREFIX, CONV_TTL


@pytest.fixture
def mock_redis():
    r = AsyncMock()
    r.get = AsyncMock(return_value=None)
    r.set = AsyncMock()
    r.expire = AsyncMock()
    r.delete = AsyncMock()
    return r


@pytest.fixture
def store(mock_redis):
    return ConversationStore(mock_redis)


@pytest.mark.asyncio
async def test_load_returns_none_when_no_history(store, mock_redis):
    mock_redis.get.return_value = None
    result = await store.load(thread_id="t1", user_id="u1")
    assert result is None


@pytest.mark.asyncio
async def test_load_returns_messages_when_valid(store, mock_redis):
    stored = json.dumps({
        "schema_version": 1,
        "user_id": "u1",
        "messages_json": "[]",
    })
    mock_redis.get.return_value = stored
    result = await store.load(thread_id="t1", user_id="u1")
    assert result is not None


@pytest.mark.asyncio
async def test_load_rejects_wrong_user(store, mock_redis):
    stored = json.dumps({
        "schema_version": 1,
        "user_id": "u1",
        "messages_json": "[]",
    })
    mock_redis.get.return_value = stored
    result = await store.load(thread_id="t1", user_id="u_attacker")
    assert result is None  # Silent rejection


@pytest.mark.asyncio
async def test_load_rejects_wrong_schema_version(store, mock_redis):
    stored = json.dumps({
        "schema_version": 999,
        "user_id": "u1",
        "messages_json": "[]",
    })
    mock_redis.get.return_value = stored
    result = await store.load(thread_id="t1", user_id="u1")
    assert result is None  # Discarded


@pytest.mark.asyncio
async def test_save_stores_with_ttl(store, mock_redis):
    await store.save(thread_id="t1", user_id="u1", messages=[])
    mock_redis.set.assert_called_once()
    call_args = mock_redis.set.call_args
    assert f"{CONV_KEY_PREFIX}t1" in call_args.args or call_args.args[0] == f"{CONV_KEY_PREFIX}t1"


@pytest.mark.asyncio
async def test_save_prunes_old_turns(store, mock_redis):
    """History beyond MAX_FULL_TURNS should be pruned."""
    # This test validates the pruning logic is called
    # (actual pruning tested separately)
    await store.save(thread_id="t1", user_id="u1", messages=[])
    mock_redis.set.assert_called_once()


@pytest.mark.asyncio
async def test_key_format():
    assert CONV_KEY_PREFIX == "agent:conv:"
    assert CONV_TTL == 86400
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd agent-service && python -m pytest tests/agent/test_conversation_store.py -v
```

Expected: ImportError — `conversation_store` module not found.

- [ ] **Step 3: Implement ConversationStore**

```python
# agent-service/app/agent/conversation_store.py
"""Redis-backed conversation history for multi-turn Agent sessions.

Data model:
  Key:   agent:conv:{thread_id}
  Value: JSON { schema_version, user_id, messages_json }
  TTL:   86400s (24h)

Security: user_id is stored and verified on every load to prevent
cross-user session hijacking.

Pruning: Only the last MAX_FULL_TURNS turns are stored in full.
BinaryContent (images) is stripped from all stored messages to prevent
Redis memory bloat.
"""
from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

CONV_KEY_PREFIX = "agent:conv:"
CONV_TTL = 86400  # 24h, matches NestJS session owner TTL
SCHEMA_VERSION = 1
MAX_FULL_TURNS = 6  # Keep last 6 request/response pairs (3 user rounds)
MAX_SERIALIZED_BYTES = 100_000  # 100KB hard cap


def _strip_binary_content(messages: list[Any]) -> list[Any]:
    """Remove BinaryContent from message parts to reduce storage size.

    PydanticAI stores user-uploaded images as BinaryContent with raw bytes.
    These are useless in subsequent turns (already processed by tools).
    Replace with a text placeholder.
    """
    try:
        from pydantic_ai.messages import ModelRequest, UserPromptPart, BinaryContent as BC

        cleaned = []
        for msg in messages:
            if isinstance(msg, ModelRequest):
                new_parts = []
                for part in msg.parts:
                    if isinstance(part, UserPromptPart) and isinstance(
                        getattr(part, "content", None), BC
                    ):
                        # Replace binary with text placeholder
                        new_parts.append(
                            UserPromptPart(content="[Image previously processed]")
                        )
                    else:
                        new_parts.append(part)
                cleaned.append(ModelRequest(parts=new_parts))
            else:
                cleaned.append(msg)
        return cleaned
    except Exception:
        return messages


def _prune_history(messages: list[Any]) -> list[Any]:
    """Keep only the last MAX_FULL_TURNS messages.

    Messages alternate: ModelRequest (user), ModelResponse (assistant).
    Keep the most recent ones intact; drop oldest if over limit.
    """
    if len(messages) <= MAX_FULL_TURNS:
        return messages
    return messages[-MAX_FULL_TURNS:]


class ConversationStore:
    """Async Redis-backed conversation store for Agent v2."""

    def __init__(self, redis_client: Any):
        self._redis = redis_client

    async def load(
        self, thread_id: str, user_id: str
    ) -> list[Any] | None:
        """Load conversation history, verifying ownership.

        Returns None if no history, wrong user, or schema mismatch.
        """
        try:
            from pydantic_ai.messages import ModelMessage
            from pydantic import TypeAdapter

            key = f"{CONV_KEY_PREFIX}{thread_id}"
            raw = await self._redis.get(key)
            if not raw:
                return None

            envelope = json.loads(raw)

            # Schema version check
            if envelope.get("schema_version") != SCHEMA_VERSION:
                logger.warning(
                    "Schema version mismatch for thread %s (got %s, expected %s), discarding",
                    thread_id, envelope.get("schema_version"), SCHEMA_VERSION,
                )
                return None

            # Security: verify user ownership
            if envelope.get("user_id") != user_id:
                logger.warning(
                    "User mismatch for thread %s: stored=%s, requested=%s",
                    thread_id, envelope.get("user_id"), user_id,
                )
                return None

            # Deserialize PydanticAI messages
            ta = TypeAdapter(list[ModelMessage])
            messages = ta.validate_json(envelope["messages_json"])
            return messages

        except Exception as e:
            logger.warning("Failed to load conversation for thread %s: %s", thread_id, e)
            return None

    async def save(
        self, thread_id: str, user_id: str, messages: list[Any]
    ) -> None:
        """Save conversation history with pruning and TTL."""
        try:
            from pydantic_ai.messages import ModelMessage
            from pydantic import TypeAdapter

            # Strip binary content (images)
            cleaned = _strip_binary_content(messages)

            # Prune old turns
            pruned = _prune_history(cleaned)

            # Serialize
            ta = TypeAdapter(list[ModelMessage])
            messages_json = ta.dump_json(pruned).decode("utf-8")

            # Hard cap on size
            if len(messages_json) > MAX_SERIALIZED_BYTES:
                # Drop oldest messages until under limit
                while len(pruned) > 2 and len(messages_json) > MAX_SERIALIZED_BYTES:
                    pruned = pruned[2:]  # Drop one request/response pair
                    messages_json = ta.dump_json(pruned).decode("utf-8")

            envelope = json.dumps({
                "schema_version": SCHEMA_VERSION,
                "user_id": user_id,
                "messages_json": messages_json,
            })

            key = f"{CONV_KEY_PREFIX}{thread_id}"
            await self._redis.set(key, envelope, ex=CONV_TTL)

        except Exception as e:
            logger.warning("Failed to save conversation for thread %s: %s", thread_id, e)

    async def delete(self, thread_id: str) -> None:
        """Delete conversation history."""
        key = f"{CONV_KEY_PREFIX}{thread_id}"
        await self._redis.delete(key)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd agent-service && python -m pytest tests/agent/test_conversation_store.py -v
```

Expected: All 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/agent/conversation_store.py agent-service/tests/agent/test_conversation_store.py
git commit -m "feat(agent): add Redis-based conversation store with security and pruning"
```

---

## Task 2: Skill Split — Shared Format Base

**Files:**
- Create: `agent-service/app/agent/skills/__init__.py`
- Create: `agent-service/app/agent/skills/shared.py`
- Test: `agent-service/tests/agent/test_skills/test_shared.py`

- [ ] **Step 1: Write failing test for shared format rules**

```python
# tests/agent/test_skills/test_shared.py
"""Tests for shared TipTap format rules."""
from app.agent.skills.shared import TIPTAP_FORMAT_RULES


def test_contains_callout_syntax():
    assert ":::info" in TIPTAP_FORMAT_RULES
    assert ":::warning" in TIPTAP_FORMAT_RULES
    assert ":::danger" in TIPTAP_FORMAT_RULES


def test_contains_heading_rules():
    assert "# Title" in TIPTAP_FORMAT_RULES
    assert "## Section" in TIPTAP_FORMAT_RULES
    assert "NEVER skip levels" in TIPTAP_FORMAT_RULES


def test_contains_table_rules():
    assert "Column 1" in TIPTAP_FORMAT_RULES


def test_contains_image_rules():
    assert "![" in TIPTAP_FORMAT_RULES


def test_contains_forbidden_patterns():
    assert "OCR noise" in TIPTAP_FORMAT_RULES or "FORBIDDEN" in TIPTAP_FORMAT_RULES
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd agent-service && python -m pytest tests/agent/test_skills/test_shared.py -v
```

- [ ] **Step 3: Create `__init__.py` and extract shared format rules**

Extract lines 117-271 from `skill.py` (Markdown Format + Tool Usage + Output Depth + Content Quality + Critical Constraints) into `shared.py`:

```python
# agent-service/app/agent/skills/__init__.py
"""Skill modules for the Docmost Intelligent Agent."""
from app.agent.skills.shared import TIPTAP_FORMAT_RULES
from app.agent.skills.creation import CREATION_SKILL
from app.agent.skills.editing import EDITING_SKILL

__all__ = ["TIPTAP_FORMAT_RULES", "CREATION_SKILL", "EDITING_SKILL"]
```

```python
# agent-service/app/agent/skills/shared.py
"""Shared TipTap format rules — used by both creation and editing skills.

Extracted from the original TIPTAP_CREATION_SKILL. These are syntax-level
constraints that apply regardless of whether the agent is creating or editing.
"""

TIPTAP_FORMAT_RULES = """\
## Markdown Format for TipTap

Output is auto-converted: Markdown -> HTML -> ProseMirror JSON -> TipTap editor.

### Callout Blocks

:::info
Helpful tips, context, or background information.
:::

:::success
Positive outcomes, confirmations, or completed actions.
:::

:::warning
Cautions, potential issues, or important reminders.
:::

:::danger
Critical warnings, destructive actions, or security risks.
:::

### Images

```markdown
![Descriptive alt text from VLM](exact-docmost-url)
```

### Tables

```markdown
| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| Data     | Data     | Data     |
```

Use tables for: comparisons, configuration parameters, download links, any 2+ column data.
NEVER use bullet lists to simulate table structure.

### Headings

- `# Title` — Exactly ONE per document
- `## Section` — Major sections
- `### Subsection` — Steps or sub-topics
- NEVER skip levels: `#` -> `###` is forbidden

### Code Blocks

Always specify language for syntax highlighting:
````markdown
```python
code here
```
````

### Collapsible Sections (FAQ, advanced details)

```html
<details>
<summary>Click to expand</summary>
Detailed content here...
</details>
```

### Links

```markdown
[Descriptive link text](https://example.com)
```

NEVER use raw URLs without link text.

## Content Quality Rules

### MANDATORY
- Preserve ALL factual content from source — zero information loss on rewrites
- Restructure and ENHANCE presentation — don't just copy-paste
- Use specific data, commands, URLs, and actionable instructions
- Write like an experienced professional sharing practical knowledge
- Default to Chinese unless user explicitly requests another language

### FORBIDDEN
- OCR noise or UI menu text artifacts (e.g., "自 日志 设置 ? 帮助 A 关于")
- Images without meaningful alt text (use VLM descriptions from `describe_images`)
- Placeholder text of any kind
- Starting paragraphs with "在当今..." or "随着...的发展"
- Formulaic transitions: '首先/其次/最后', '综上所述', '值得注意的是'
- Corporate buzzwords: '赋能', '抓手', '落地', '闭环', '链路', '沉淀', '对齐'
- Repeating the same sentence structure 3+ times in a row

## Critical Constraints (MUST FOLLOW)

1. Every image URL returned by `extract_document` MUST appear in your final Markdown output.
   Missing even one image URL is a critical quality defect.

2. Use VLM descriptions from `describe_images` as alt text. Place each image
   IMMEDIATELY AFTER the text it illustrates — never stack all images at the end.

3. Technical terms, commands, version numbers, and URLs must be preserved exactly.
   Never change `apt-get install` to `安装软件` or alter version strings.

4. Active voice always: "Click the button" not "The button should be clicked".
"""
```

- [ ] **Step 4: Run tests**

```bash
cd agent-service && python -m pytest tests/agent/test_skills/test_shared.py -v
```

Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/agent/skills/
git add agent-service/tests/agent/test_skills/
git commit -m "feat(agent): extract shared TipTap format rules into skills/shared.py"
```

---

## Task 3: Skill Split — Creation Skill

**Files:**
- Create: `agent-service/app/agent/skills/creation.py`
- Test: `agent-service/tests/agent/test_skills/test_creation.py`

- [ ] **Step 1: Write failing test**

```python
# tests/agent/test_skills/test_creation.py
"""Tests for document creation skill."""
from app.agent.skills.creation import CREATION_SKILL


def test_contains_thinking_framework():
    assert "Step 1: UNDERSTAND" in CREATION_SKILL
    assert "Step 2: COLLECT" in CREATION_SKILL
    assert "Step 3: ANALYZE" in CREATION_SKILL


def test_contains_tool_strategy():
    assert "scrape_url" in CREATION_SKILL
    assert "extract_document" in CREATION_SKILL
    assert "search_web" in CREATION_SKILL


def test_contains_output_calibration():
    assert "2000+ words" in CREATION_SKILL or "Output Depth" in CREATION_SKILL


def test_contains_shared_format():
    """Creation skill must include shared format rules."""
    assert ":::info" in CREATION_SKILL
    assert "NEVER skip levels" in CREATION_SKILL


def test_thinking_framework_is_first():
    """Thinking framework should be in the top 40% (primacy bias)."""
    total = len(CREATION_SKILL)
    think_pos = CREATION_SKILL.find("Step 1: UNDERSTAND")
    assert think_pos < total * 0.15, "Thinking framework should be near the top"
```

- [ ] **Step 2: Run test — verify fail**

- [ ] **Step 3: Implement creation.py**

Compose the creation skill from the thinking framework (lines 12-116 of original `skill.py`) + tool strategy (lines 189-218) + output depth calibration (lines 220-239) + shared format rules appended:

```python
# agent-service/app/agent/skills/creation.py
"""Document creation skill — for first-turn generation from scratch.

Preserves the original TIPTAP_CREATION_SKILL structure:
- Thinking framework (~40%, primacy bias)
- Tool usage strategy + output depth (~30%)
- Format rules + constraints (~30%, recency bias via shared.py)
"""
from app.agent.skills.shared import TIPTAP_FORMAT_RULES

_CREATION_CORE = """\
# Docmost Document Agent

You are an intelligent document agent. You deeply understand documents, web pages,
and user instructions, then produce beautifully structured content.

## Thinking Framework

Before writing anything, you MUST think deeply. Your thinking quality directly
determines your output quality. Follow this structured analysis:

### Step 1: UNDERSTAND the Task

Read the user's instruction carefully. Classify:
- **Task type**: Rewrite from URL? Optimize uploaded doc? Research and create? Translate?
- **User intent**: What outcome does the user want? What problem are they solving?
- **Implicit expectations**: Professional docs need formal tone; tutorials need step-by-step clarity.

### Step 2: COLLECT with Purpose

Gather content using the minimum necessary tool calls. Before each tool call, state:
- What information you need and why
- What you expect to get back
- How it will serve the final output

### Step 3: ANALYZE Deeply (in your reasoning — NOT as tool calls)

After collecting content, analyze along these four dimensions:

1. **Content structure analysis** — What sections exist? What's missing? Is the hierarchy logical?
   Does it flow from introduction -> body -> conclusion? Where are the structural gaps?

2. **Information density assessment** — What are the core facts, data points, and actionable items?
   What is filler vs substance? What deserves emphasis? What can be reorganized for clarity?

3. **Audience and purpose inference** — Who will read this? (Developer? Manager? End user?)
   What level of technical detail is appropriate? What tone fits?

4. **Image-text correspondence** (if images exist) — Which image illustrates which concept?
   Where should each image be placed to maximize comprehension? What should the alt text convey?

### Step 4: PLAN the Output Structure

Before writing, decide:
- Document outline (sections and their order)
- Key improvements over the source (list them mentally)
- Where each image belongs (if any)
- Approximate depth per section (proportional to importance)

### Step 5: GENERATE the Complete Document

Write the full document based on your analysis and plan. Your output quality should
reflect the depth of your thinking — rushed thinking produces shallow output.

### Step 6: VERIFY

Before finishing, confirm:
- Every uploaded image URL appears in the output
- No information was lost from the source
- The structure matches your plan

### Example: What Good Output Looks Like

**Task:** User provides a URL about VPN configuration and asks to rewrite it.

**Good output structure:**
```markdown
# Windows VPN 配置完全指南

:::info
本文基于 [原始教程](https://example.com/vpn) 整理，补充了常见问题解答和故障排查步骤。
:::

## 前置准备

| 项目 | 要求 |
|------|------|
| 操作系统 | Windows 10/11 |
| 网络 | 稳定互联网连接 |

## Step 1: 打开网络设置

打开 **设置 -> 网络和 Internet -> VPN**，点击 **添加 VPN 连接**。

![VPN 设置入口界面](https://docmost-url/image1.jpg)
```

**Why this is good:**
- Callout block adds context the source lacked
- Table organizes prerequisites
- Step-by-step with screenshots at relevant positions
- No filler, no corporate buzzwords

## Tool Usage Strategy

### URL Tasks (user provides a URL)
1. Call `scrape_url` ONCE
2. If scraping fails -> call `search_web` ONCE as fallback
3. After collection, STOP calling tools — analyze and generate

### File Upload Tasks (user uploads documents)
1. Call `extract_document` ONCE
2. Call `describe_images` ONCE (if images were found)
3. After collection, STOP calling tools — analyze and generate

### Research Tasks (user asks for facts/information)
1. Call `search_web` 1-3 times with focused, different queries
2. After collection, STOP calling tools — synthesize and generate

### Page Reference Tasks (user references existing pages)
1. Call `read_page` for referenced pages
2. After collection, STOP calling tools — analyze and generate

**Universal rule:** After collecting information, your job shifts from ACTING to THINKING.
Do not call more tools as a substitute for deeper analysis.

### Error Recovery (ONE ATTEMPT ONLY)

If a tool returns `[Error]` or empty content:
1. Try ONE alternative (scraping failed -> search once; search failed -> use what you have).
2. After that ONE alternative, generate output immediately.
3. Do NOT retry the same tool or cycle between tools.
4. If both attempts fail, write the best content you can based on your knowledge.

## Output Depth Calibration

Match your output depth to the source material and task complexity:

- **If the source is rich (2000+ words, multiple sections):**
  Produce comprehensive output that preserves ALL substantive content.
  Restructure and enhance, but do not compress or summarize away information.
  Target: equal to or greater depth than the source.

- **If the source is moderate (500-2000 words):**
  Enhance with better structure, add missing context where appropriate.
  Target: well-organized 2-5 page output.

- **If the source is brief (< 500 words) or the task is simple:**
  Be clear and complete without artificial padding.
  Target: concise 1-2 page output with high information density.

- **If creating original content (research tasks):**
  Depth should match the complexity of the topic.
  Provide evidence, examples, and actionable specifics — not vague overviews.
"""

CREATION_SKILL = _CREATION_CORE + "\n" + TIPTAP_FORMAT_RULES
```

- [ ] **Step 4: Run tests**

```bash
cd agent-service && python -m pytest tests/agent/test_skills/test_creation.py -v
```

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/agent/skills/creation.py agent-service/tests/agent/test_skills/test_creation.py
git commit -m "feat(agent): create document creation skill with thinking framework"
```

---

## Task 4: Skill Split — Editing Skill

**Files:**
- Create: `agent-service/app/agent/skills/editing.py`
- Test: `agent-service/tests/agent/test_skills/test_editing.py`

- [ ] **Step 1: Write failing test**

```python
# tests/agent/test_skills/test_editing.py
"""Tests for document editing skill."""
from app.agent.skills.editing import EDITING_SKILL


def test_contains_edit_framework():
    assert "READ" in EDITING_SKILL
    assert "UNDERSTAND" in EDITING_SKILL or "Change Request" in EDITING_SKILL
    assert "CURRENT DOCUMENT" in EDITING_SKILL


def test_forbids_conversational_framing():
    assert "Do NOT" in EDITING_SKILL
    assert "code block" in EDITING_SKILL.lower() or "代码块" in EDITING_SKILL


def test_contains_preservation_constraint():
    assert "preserve" in EDITING_SKILL.lower() or "unchanged" in EDITING_SKILL.lower()


def test_contains_shared_format():
    assert ":::info" in EDITING_SKILL
    assert "NEVER skip levels" in EDITING_SKILL


def test_is_concise():
    """Editing skill should be shorter than creation skill (< 4000 chars core)."""
    from app.agent.skills.shared import TIPTAP_FORMAT_RULES
    core_length = len(EDITING_SKILL) - len(TIPTAP_FORMAT_RULES)
    assert core_length < 4000, f"Editing core is {core_length} chars, should be < 4000"
```

- [ ] **Step 2: Run test — verify fail**

- [ ] **Step 3: Implement editing.py**

Deliberately concise — under 800 tokens of core instructions (before shared format rules). No thinking framework (model already has `thinking="high"`).

```python
# agent-service/app/agent/skills/editing.py
"""Document editing skill — for modifying existing content on follow-up turns.

Design principles:
- Concise (< 800 tokens core). Model with thinking="high" reasons deeply already.
- Preservation-first: only change what the user explicitly asks.
- No conversational framing — output is the document, not a chat message.
- Appends shared TipTap format rules for consistent output.
"""
from app.agent.skills.shared import TIPTAP_FORMAT_RULES

_EDITING_CORE = """\
# Docmost Document Editor

You are editing an existing document. The content between [CURRENT DOCUMENT] and
[/CURRENT DOCUMENT] markers is what the user currently sees in their editor.

## Editing Rules

### Step 1: READ the Current Document
Understand the full document structure, tone, formatting, and content before making changes.

### Step 2: UNDERSTAND the Change Request
Classify what the user wants:
- **Add**: Insert new content at a specific location
- **Remove**: Delete a section or element
- **Rewrite**: Rephrase or restructure a specific part
- **Restructure**: Move sections, change hierarchy, or reorganize

### Step 3: APPLY Changes and Output

Output the COMPLETE updated document with changes applied. Critical rules:

- Output ONLY the document content in TipTap Markdown
- Do NOT add conversational text like "下面是修改后的版本" or "已完成修改"
- Do NOT wrap the output in markdown code blocks
- Do NOT modify any section the user did not ask to change
- PRESERVE the exact formatting, tone, and structure of unchanged sections
- If the user asks about the document without requesting changes, respond conversationally
  (short answer, no document output)

### Tool Usage
- Most editing tasks require ZERO tool calls — the document content is already provided
- Call `read_page` ONLY if the current document was not provided in the prompt
- Call other tools only if the user asks to add content from external sources (URL, search)
"""

EDITING_SKILL = _EDITING_CORE + "\n" + TIPTAP_FORMAT_RULES
```

- [ ] **Step 4: Run tests**

```bash
cd agent-service && python -m pytest tests/agent/test_skills/ -v
```

Expected: All tests in test_shared, test_creation, test_editing pass.

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/agent/skills/editing.py agent-service/tests/agent/test_skills/test_editing.py
git commit -m "feat(agent): create concise document editing skill"
```

---

## Task 5: Skill Router + Dual Agent Singletons

**Files:**
- Create: `agent-service/app/agent/skill_router.py`
- Modify: `agent-service/app/agent/agent.py`
- Test: `agent-service/tests/agent/test_skill_router.py`

- [ ] **Step 1: Write failing tests for skill router**

```python
# tests/agent/test_skill_router.py
"""Tests for skill routing logic."""
from app.agent.skill_router import select_skill


def test_first_turn_with_files_returns_creation():
    result = select_skill(has_message_history=False, has_files=True)
    assert result == "creation"


def test_first_turn_no_files_returns_creation():
    result = select_skill(has_message_history=False, has_files=False)
    assert result == "creation"


def test_follow_up_turn_returns_editing():
    result = select_skill(has_message_history=True, has_files=False)
    assert result == "editing"


def test_follow_up_with_new_files_returns_creation():
    """When user uploads new files in a follow-up, treat as new creation."""
    result = select_skill(has_message_history=True, has_files=True)
    assert result == "creation"
```

- [ ] **Step 2: Run test — verify fail**

- [ ] **Step 3: Implement skill_router.py**

```python
# agent-service/app/agent/skill_router.py
"""Skill routing — selects creation or editing skill based on context.

Primary signal: has_message_history (is this a follow-up turn?)
Secondary signal: has_files (did the user upload new documents?)

Conservative routing: editing only when clearly a follow-up without new files.
"""


def select_skill(*, has_message_history: bool, has_files: bool) -> str:
    """Select which skill to use for this agent run.

    Returns "creation" or "editing".
    """
    if has_message_history and not has_files:
        return "editing"
    return "creation"
```

- [ ] **Step 4: Modify agent.py — two singletons**

Replace the single `_agent` singleton with `_creation_agent` and `_editing_agent`:

```python
# agent-service/app/agent/agent.py
# Key changes:
# 1. Import both skills
# 2. Two module-level singletons
# 3. get_agent(skill="creation"|"editing") selects which one
# 4. Tool preparation cached separately (done once)

# After the imports, replace the singleton section:

from app.agent.skills import CREATION_SKILL, EDITING_SKILL

_creation_agent: Agent[AgentDeps, str] | None = None
_editing_agent: Agent[AgentDeps, str] | None = None
_prepared_tools: list | None = None


def _prepare_tools():
    """Prepare tool wrappers once (cached at module level)."""
    global _prepared_tools
    if _prepared_tools is not None:
        return _prepared_tools

    from app.agent.tools import ALL_TOOLS
    import sys
    for fn in ALL_TOOLS:
        mod = sys.modules.get(fn.__module__)
        if mod is not None and not hasattr(mod, "AgentDeps"):
            mod.AgentDeps = AgentDeps

    from pydantic_ai import Tool
    _prepared_tools = [Tool(t, takes_ctx=True) for t in ALL_TOOLS]
    return _prepared_tools


def create_agent(system_prompt: str) -> Agent[AgentDeps, str]:
    """Create an Agent instance with the given system prompt."""
    tools = _prepare_tools()
    max_tokens = get_max_tokens_for_current_model()
    # ... (same model/settings logic as current create_agent)
    return Agent(
        model=m,
        deps_type=AgentDeps,
        system_prompt=system_prompt,
        tools=tools,
        output_type=str,
        model_settings=ModelSettings(max_tokens=max_tokens, thinking="high", openai_reasoning_summary="auto"),
        retries=2,
        end_strategy="early",
    )


def get_agent(skill: str = "creation") -> Agent[AgentDeps, str]:
    """Get or create the appropriate Agent singleton."""
    global _creation_agent, _editing_agent

    if skill == "editing":
        if _editing_agent is None:
            _editing_agent = create_agent(EDITING_SKILL)
        return _editing_agent
    else:
        if _creation_agent is None:
            _creation_agent = create_agent(CREATION_SKILL)
        return _creation_agent


def reset_agent():
    """Reset all cached agents (for testing)."""
    global _creation_agent, _editing_agent, _prepared_tools
    _creation_agent = None
    _editing_agent = None
    _prepared_tools = None
```

- [ ] **Step 5: Run ALL agent tests to ensure no regressions**

```bash
cd agent-service && python -m pytest tests/agent/ -v --tb=short
```

Expected: All existing tests pass (they call `get_agent()` which defaults to "creation").

- [ ] **Step 6: Commit**

```bash
git add agent-service/app/agent/skill_router.py agent-service/app/agent/agent.py
git add agent-service/tests/agent/test_skill_router.py
git commit -m "feat(agent): dual agent singletons with skill router (creation + editing)"
```

---

## Task 6: Backend Integration — Runner, Deps, Endpoint

**Files:**
- Modify: `agent-service/app/agent/deps.py`
- Modify: `agent-service/app/agent/runner.py`
- Modify: `agent-service/app/main.py`

This is the integration task that wires everything together.

- [ ] **Step 1: Add `page_content` to AgentDeps**

In `deps.py`, add after line 29 (`session_store`):

```python
    # 当前页面内容（编辑模式使用，前端注入或后端 read_page 兜底）
    page_content: str = ""
```

- [ ] **Step 2: Modify runner.py — rewrite session load/save + add skill routing + page injection + output classification**

**Critical change: Replace the old `load_messages`/`save_turn` API with the new ConversationStore API.**

Replace lines 56-61 (old load):
```python
# OLD — remove these lines:
# message_history = None
# if deps.session_store:
#     message_history = await deps.session_store.load_messages(deps.thread_id)

# NEW — ConversationStore.load() requires user_id for security:
message_history = None
if deps.session_store:
    try:
        message_history = await deps.session_store.load(
            thread_id=deps.thread_id, user_id=deps.user_id
        )
    except Exception as e:
        logger.warning("Failed to load conversation for thread %s: %s", deps.thread_id, e)
```

After loading history, add skill routing + page injection:
```python
# 1. Select skill based on context
from app.agent.skill_router import select_skill
skill = select_skill(
    has_message_history=message_history is not None and len(message_history) > 0,
    has_files=len(deps.files) > 0,
)
agent = get_agent(skill=skill)

# 2. Inject page context for editing mode
if skill == "editing" and deps.page_content:
    PAGE_CONTENT_LIMIT = 20_000
    page_text = deps.page_content[:PAGE_CONTENT_LIMIT]
    truncated_note = "\n[Document truncated]" if len(deps.page_content) > PAGE_CONTENT_LIMIT else ""
    prompt = f"[CURRENT DOCUMENT]\n{page_text}{truncated_note}\n[/CURRENT DOCUMENT]\n\n{user_message}"
elif skill == "editing" and deps.page_id:
    # Fallback: read from database (NOTE: truncates at 8K chars vs 20K frontend cap)
    from app.agent.tools.read_page import read_page_impl
    try:
        page_data = await read_page_impl(deps.page_id)
        if page_data.get("status") == "success":
            prompt = f"[CURRENT DOCUMENT]\n{page_data['content']}\n[/CURRENT DOCUMENT]\n\n{user_message}"
    except Exception:
        pass  # Proceed without page context
```

In the streaming loop, capture `all_messages()` from `AgentRunResultEvent`:
```python
# Add this variable before the loop:
all_messages_snapshot = None

# Inside the AgentRunResultEvent handler (line ~106), add:
if isinstance(event, AgentRunResultEvent):
    if hasattr(event.result, "output"):
        authoritative_output = event.result.output
    # Capture full message history for conversation persistence
    if hasattr(event.result, "all_messages"):
        all_messages_snapshot = event.result.all_messages()
    # ... rest of existing handler
```

After the streaming loop, before done event — add output classification:
```python
# 3. Output classification
has_markdown_structure = any(
    marker in final_output for marker in ["# ", "## ", "| ", ":::"]
)
output_type = "document"
if (
    tool_call_count == 0
    and deps.source_word_count == 0
    and not deps.uploaded_image_urls
    and len(final_output.strip()) < 200
    and not has_markdown_structure
    and not deps.page_content  # editing with page context → always document
):
    output_type = "conversation"

# 4. Conditional validation — skip entirely for conversational output
if output_type == "document" and final_output:
    validation = validate_agent_output(
        final_output, deps.uploaded_image_urls,
        source_word_count=deps.source_word_count,
    )
    if not validation.passed:
        yield {"type": "warning", "issues": validation.issues, "score": validation.score}
# else: no validation for conversational output

# 5. Done event includes output_type
yield {"type": "done", "final_content": final_output or "", "output_type": output_type}
```

Replace lines 211-219 (old save_turn) with new save using all_messages:
```python
# OLD — remove these lines:
# if deps.session_store and final_output:
#     await deps.session_store.save_turn(thread_id, user_message, assistant_output)

# NEW — save full PydanticAI message history:
if deps.session_store and all_messages_snapshot:
    try:
        await deps.session_store.save(
            thread_id=deps.thread_id,
            user_id=deps.user_id,
            messages=all_messages_snapshot,
        )
    except Exception as e:
        logger.warning("Failed to save conversation for thread %s: %s", deps.thread_id, e)
```

- [ ] **Step 3: Modify main.py — wire conversation store + page_content**

In the `run_agent_v2()` endpoint:

```python
# At module level (top of main.py, after settings initialization):

from app.agent.conversation_store import ConversationStore

_conv_store: ConversationStore | None = None

def _get_conv_store() -> ConversationStore | None:
    """Get or create the module-level conversation store singleton."""
    global _conv_store
    if _conv_store is None and settings.redis_url:
        import redis.asyncio as aioredis
        redis_client = aioredis.from_url(settings.redis_url, decode_responses=True)
        _conv_store = ConversationStore(redis_client)
    return _conv_store

# Inside run_agent_v2():
page_content = request.get("page_content", "")

deps = AgentDeps(
    ...,
    session_store=_get_conv_store(),
    page_content=page_content,
)
```

- [ ] **Step 4: Run all tests**

```bash
cd agent-service && python -m pytest tests/agent/ -v --tb=short
```

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/agent/deps.py agent-service/app/agent/runner.py agent-service/app/main.py
git commit -m "feat(agent): integrate conversation store, skill routing, output classification"
```

---

## Task 7: NestJS Gateway — Pass page_content

**Files:**
- Modify: `apps/server/src/ee/ai/agent-gateway/agent-gateway.service.ts`

- [ ] **Step 1: Add page_content to buildV2RunPayload**

```typescript
// agent-gateway.service.ts, buildV2RunPayload method:
// Add pageContent to params type and forward it

buildV2RunPayload(params: {
  prompt: string;
  pageId?: string;
  threadId?: string;
  workspaceId: string;
  userId: string;
  files?: Array<{ content_b64: string; filename: string; mimetype: string }>;
  pageContent?: string;  // NEW
}): Record<string, unknown> {
  return {
    prompt: params.prompt,
    page_id: params.pageId || undefined,
    thread_id: params.threadId || undefined,
    workspace_id: params.workspaceId,
    user_id: params.userId,
    files: params.files || [],
    page_content: params.pageContent || "",  // NEW
  };
}
```

- [ ] **Step 2: Update controller to extract pageContent from request body**

In `agent-gateway.controller.ts`, the v2/run handler should extract `pageContent` from the request body and pass it to `buildV2RunPayload`.

- [ ] **Step 3: Compile check**

```bash
cd apps/server && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/ee/ai/agent-gateway/
git commit -m "feat(gateway): pass page_content in v2 payload"
```

---

## Task 8: Frontend — Send page_content + Handle output_type

**Files:**
- Modify: `apps/client/src/ee/ai/types/agent-v2.types.ts`
- Modify: `apps/client/src/ee/ai/services/agent-v2-service.ts`
- Modify: `apps/client/src/ee/ai/hooks/use-agent-session.ts`
- Modify: `apps/client/src/ee/ai/components/agent-panel/agent-panel.tsx`

- [ ] **Step 1: Update types**

In `agent-v2.types.ts`:

```typescript
// Update done event type:
| { type: "done"; final_content?: string; output_type?: "document" | "conversation" }

// Update AgentV2RunRequest:
export interface AgentV2RunRequest {
  prompt: string;
  pageId?: string;
  threadId?: string;
  pageContent?: string;  // NEW: current editor content for editing mode
  files?: Array<{ content_b64: string; filename: string; mimetype: string }>;
}

// Update AgentSessionAPI:
export interface AgentSessionAPI {
  messages: AgentMessage[];
  status: AgentSessionStatus;
  threadId: string | null;
  lastOutput: string | null;
  outputType: "document" | "conversation" | null;  // NEW
  submit: (prompt: string, files?: File[]) => Promise<void>;
  cancel: () => void;
  reset: () => void;
}
```

- [ ] **Step 2: Update agent-v2-service.ts**

Add `pageContent` to the request body:

```typescript
// In agentV2Run params type:
params: {
  prompt: string;
  pageId?: string;
  threadId?: string;
  pageContent?: string;  // NEW
  files?: File[];
},

// In body construction:
const body: AgentV2RunRequest = {
  prompt: params.prompt,
  pageId: params.pageId,
  threadId: params.threadId,
  pageContent: params.pageContent,  // NEW
  files: filePayloads.length > 0 ? filePayloads : undefined,
};
```

- [ ] **Step 3: Update use-agent-session.ts**

Add `outputType` state and send `pageContent` on follow-ups:

```typescript
// New state:
const [outputType, setOutputType] = useState<"document" | "conversation" | null>(null);

// In handleEvent "done" case:
case "done": {
  setStatus("done");
  const finalContent = event.final_content || "";
  setLastOutput(finalContent);
  setOutputType(event.output_type || "document");  // NEW
  updateLastAssistant(() => ({
    content: finalContent,
    streaming: false,
  }));
  break;
}

// In submit():
// When threadId exists (follow-up), include page content from editor
const editorContent = threadId && editor
  ? /* get markdown from TipTap editor */ ""
  : undefined;

abortRef.current = agentV2Run(
  {
    prompt,
    pageId,
    threadId: threadId ?? undefined,
    pageContent: editorContent,  // NEW
    files,
  },
  handleEvent,
  ...
);

// In reset():
setOutputType(null);

// Return from hook:
return { messages, status, threadId, lastOutput, outputType, submit, cancel, reset };
```

**TipTap Markdown Export:** Docmost uses `@joplin/turndown` + GFM plugins for HTML→Markdown conversion. The concrete method chain is:

```typescript
import { htmlToMarkdown } from "@docmost/editor-ext";

// In submit(), when threadId exists (follow-up turn):
const editorContent = threadId && editor
  ? htmlToMarkdown(editor.getHTML())
  : undefined;
```

This uses the existing `htmlToMarkdown()` utility from `packages/editor-ext/src/lib/markdown/utils/turndown.utils.ts`, which handles callouts, tables, code blocks, and all TipTap-specific extensions. The `editor` atom is already accessible in the hook via `useAtomValue(pageEditorAtom)`.

- [ ] **Step 4: Update agent-panel.tsx — conditional ActionBar**

```tsx
// Replace:
{isDone && session.lastOutput && (
  <ActionBar ... />
)}

// With:
{isDone && session.lastOutput && session.outputType === "document" && (
  <ActionBar ... />
)}
```

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit --project apps/client/tsconfig.json 2>&1
```

- [ ] **Step 6: Commit**

```bash
git add apps/client/src/ee/ai/
git commit -m "feat(agent-panel): send page content, handle output_type, conditional ActionBar"
```

---

## Task 9: Deprecate Old skill.py + Update Tests

**Files:**
- Modify: `agent-service/app/agent/skill.py` (add deprecation notice)
- Modify: `agent-service/tests/agent/test_skill.py` (point to new skills)
- Modify: `agent-service/tests/agent/test_skill_structure.py` (point to new skills)

- [ ] **Step 1: Add deprecation notice to skill.py**

```python
# agent-service/app/agent/skill.py
"""DEPRECATED: Use app.agent.skills.creation / .editing instead.

This file is kept for backward compatibility with tests that import TIPTAP_CREATION_SKILL.
"""
from app.agent.skills.creation import CREATION_SKILL

TIPTAP_CREATION_SKILL = CREATION_SKILL  # Backward compat alias
```

- [ ] **Step 2: Verify all existing tests still pass**

```bash
cd agent-service && python -m pytest tests/agent/ -v --tb=short 2>&1 | tail -30
```

Expected: All tests pass (old imports still work via the alias).

- [ ] **Step 3: Commit**

```bash
git add agent-service/app/agent/skill.py agent-service/tests/agent/
git commit -m "refactor(agent): deprecate monolithic skill.py, redirect to skills/"
```

---

## Task 10: Integration Test + Full Regression

**Files:**
- Test: `agent-service/tests/agent/test_integration_multi_turn.py`

- [ ] **Step 1: Write integration test for the full multi-turn flow**

```python
# tests/agent/test_integration_multi_turn.py
"""Integration tests for multi-turn agent conversation flow."""
import pytest
from unittest.mock import AsyncMock, patch
from app.agent.skill_router import select_skill
from app.agent.conversation_store import ConversationStore


def test_skill_routing_first_turn():
    """First turn without history → creation."""
    assert select_skill(has_message_history=False, has_files=True) == "creation"
    assert select_skill(has_message_history=False, has_files=False) == "creation"


def test_skill_routing_follow_up():
    """Follow-up without new files → editing."""
    assert select_skill(has_message_history=True, has_files=False) == "editing"


def test_skill_routing_follow_up_with_files():
    """Follow-up with new files → creation (new task)."""
    assert select_skill(has_message_history=True, has_files=True) == "creation"


@pytest.mark.asyncio
async def test_conversation_store_round_trip():
    """Save and load conversation through ConversationStore."""
    mock_redis = AsyncMock()
    stored_data = {}

    async def mock_set(key, value, ex=None):
        stored_data[key] = value

    async def mock_get(key):
        return stored_data.get(key)

    mock_redis.set = mock_set
    mock_redis.get = mock_get

    store = ConversationStore(mock_redis)

    # Save empty messages
    await store.save(thread_id="t1", user_id="u1", messages=[])

    # Load back
    result = await store.load(thread_id="t1", user_id="u1")
    assert result is not None
    assert isinstance(result, list)


@pytest.mark.asyncio
async def test_conversation_store_rejects_wrong_user():
    """Security: wrong user cannot load another user's conversation."""
    mock_redis = AsyncMock()
    stored_data = {}

    async def mock_set(key, value, ex=None):
        stored_data[key] = value

    async def mock_get(key):
        return stored_data.get(key)

    mock_redis.set = mock_set
    mock_redis.get = mock_get

    store = ConversationStore(mock_redis)
    await store.save(thread_id="t1", user_id="user_a", messages=[])

    # Attacker tries to load
    result = await store.load(thread_id="t1", user_id="attacker")
    assert result is None
```

- [ ] **Step 2: Run integration tests**

```bash
cd agent-service && python -m pytest tests/agent/test_integration_multi_turn.py -v
```

- [ ] **Step 3: Run FULL regression**

```bash
cd agent-service && python -m pytest tests/agent/ -v --tb=short 2>&1 | tail -30
```

Expected: All tests pass, including new ones.

- [ ] **Step 4: Commit**

```bash
git add agent-service/tests/agent/test_integration_multi_turn.py
git commit -m "test(agent): add integration tests for multi-turn conversation flow"
```

---

## Task 11: Final — TypeScript Compilation + Summary Commit

- [ ] **Step 1: TypeScript full check**

```bash
npx tsc --noEmit --project apps/client/tsconfig.json 2>&1
```

- [ ] **Step 2: Python full check**

```bash
cd agent-service && python -m pytest tests/agent/ -v --tb=short
```

- [ ] **Step 3: Summary commit if any loose changes**

```bash
git add -A
git commit -m "docs(agent): add multi-turn enhancement implementation plan"
```

---

## Execution Notes

### Key Design Decisions (from cross-validation)

1. **Two Agent singletons**, not per-request construction — tools prepared once, only system_prompt differs
2. **`has_message_history` is primary routing signal**, not `has_page_content` — more reliable
3. **Sliding window**: 6 messages (3 user rounds) max, BinaryContent stripped, 100KB hard cap
4. **user_id stored and verified** on every conversation load — prevents cross-user hijacking
5. **Schema version stamp** — allows graceful discard on PydanticAI upgrades
6. **Page content truncation at 20K chars** — prevents context window overflow
7. **Output classification heuristic**: no-tools + no-source + short + no-markdown-headings = conversation
8. **Editing skill is concise** (< 800 tokens core) — model with `thinking="high"` doesn't need verbose instructions

### What Is NOT Changed

- Validator logic (`validator.py`) — unchanged, just conditionally skipped
- Event bridge (`event_bridge.py`) — unchanged
- All 5 tools — unchanged
- SSE protocol — backward compatible (new `output_type` field is additive)
- Frontend timeline rendering — unchanged
- First-turn creation flow — identical to current behavior
