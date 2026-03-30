# Agent 思维深度增强实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Docmost Intelligent Agent 从 "Act-heavy, Think-light" 模式转变为 "Think-heavy, Act-light" 模式，通过 Skill 提示词重构、工具输出结构化和质量验证闭环三管齐下，显著提升 Agent 输出深度和质量。

**Architecture:** 四层增量改进，仅涉及 v2 Agent 系统（`agent-service/app/agent/` + 前端 `agent-panel/`）。P0 重写 Skill 提示词是核心杠杆；P1 增强思考内容展示；P2 将工具返回值从 str 改为 dict 以利用 Gemini 原生 JSON 理解；P3 在流式完成后增加质量验证与重试。

**Tech Stack:** PydanticAI v1.72.0, Gemini 3 Pro (thinking="high"), FastAPI SSE, React + Mantine

**Branch:** `feat/intelligent-agent` (worktree: `.worktrees/feat-intelligent-agent/`)

**关键约束:**
- 所有改动仅限 v2 Agent 代码，不触碰 v1 orchestrator/workers
- PydanticAI `output_validator` 在流式模式有 bug（[Issue #3393](https://github.com/pydantic/pydantic-ai/issues/3393)），P3 使用流后验证而非流中验证
- `thinking="high"` 对 Gemini 3+ 映射为 `thinking_level='HIGH'`（已验证 PydanticAI v1.72.0 源码）
- 工具返回 dict 时 Gemini 接收原生 JSON（不被包装），str 则被包装为 `{"return_value": "..."}`

---

## 文件结构总览

### P0: Skill 提示词重构（核心杠杆）
| 操作 | 文件 | 职责 |
|------|------|------|
| **重写** | `agent-service/app/agent/skill.py` | 思考优先的系统提示词 |
| **新建** | `agent-service/tests/agent/test_skill_structure.py` | 提示词结构断言 |
| **提交** | — | `feat(agent): redesign skill prompt for think-heavy pattern` |

### P1: 多阶段思考可见性（差距 1 修复 — 核心用户诉求）
| 操作 | 文件 | 职责 |
|------|------|------|
| **修改** | `agent-service/app/agent/runner.py` | 添加 thinking phase 计数器 |
| **修改** | `apps/client/src/ee/ai/types/agent-v2.types.ts` | thinking 事件增加 phase 字段 |
| **修改** | `apps/client/src/ee/ai/hooks/use-agent-session.ts` | 按 phase 分组累积 |
| **修改** | `apps/client/src/ee/ai/components/agent-panel/agent-message.tsx` | 多阶段 thinking UI |
| **提交** | — | `feat(agent): multi-phase thinking visibility` |

### P1.5: 截断检测 + MAX_TOOL_CALLS 配置化 + 质量重试（差距 2-4）
| 操作 | 文件 | 职责 |
|------|------|------|
| **修改** | `agent-service/app/agent/runner.py` | 截断检测 + 配置化 + 重试 |
| **提交** | — | 3 个独立 commit |

### P2: 工具输出结构化
| 操作 | 文件 | 职责 |
|------|------|------|
| **修改** | `agent-service/app/agent/tools/scrape_url.py` | 返回 dict |
| **修改** | `agent-service/app/agent/tools/search_web.py` | 返回 dict |
| **修改** | `agent-service/app/agent/tools/read_page.py` | 返回 dict |
| **修改** | `agent-service/app/agent/tools/extract_document.py` | 返回 dict |
| **修改** | `agent-service/app/agent/tools/describe_images.py` | 返回 dict |
| **新建** | `agent-service/tests/agent/test_tools_return_structure.py` | 返回值结构断言 |
| **修改** | `agent-service/tests/agent/tools/test_scrape_url.py` | 迁移 6 个断言至 dict 格式 |
| **修改** | `agent-service/tests/agent/tools/test_search_web.py` | 迁移 3 个断言至 dict 格式 |
| **修改** | `agent-service/tests/agent/tools/test_read_page.py` | 迁移 3 个断言至 dict 格式 |
| **修改** | `agent-service/tests/agent/tools/test_extract_document.py` | 迁移 4 个断言至 dict 格式 |
| **修改** | `agent-service/tests/agent/tools/test_describe_images.py` | 迁移 2 个断言至 dict 格式 |
| **提交** | — | `feat(agent): structured tool returns for better model reasoning` |

### P3: 质量验证闭环
| 操作 | 文件 | 职责 |
|------|------|------|
| **重写** | `agent-service/app/agent/validator.py` | 增强验证维度 + 评分 |
| **修改** | `agent-service/app/agent/runner.py` | 流后验证 → 警告/重试 |
| **修改** | `agent-service/app/agent/deps.py` | 新增 `source_word_count` 字段 |
| **新建** | `agent-service/tests/agent/test_validator_enhanced.py` | 验证器测试 |
| **提交** | — | `feat(agent): post-stream quality validation with retry` |

---

## Task 1: P0 — Skill 提示词重构

这是整个方案的核心杠杆。当前 skill.py 的 222 行中仅 3 行引导思考、189 行是格式规则和工具约束。新设计将思考框架前置（~40%），格式规范精简到中段（~30%），工具规则和关键约束放在尾部利用 recency bias（~30%）。

### 设计依据（交叉审视确认）

| 设计决策 | 支撑来源 |
|---------|---------|
| 思考框架前置 | Stanford "lost in the middle" + Augment Code "注意力分布不均" |
| 提供分析维度而非过度约束 | Anthropic Claude 4: "think thoroughly 优于手写逐步计划" |
| 任务感知长度校准替代通用压缩 | arXiv "Concise Thoughts" + Cursor GPT-5 双重控制策略 |
| 添加 few-shot 示例 | PromptingGuide.ai + Mem0 2026: 零代码最高 ROI |
| 关键约束放尾部 | recency bias 利用（支持方 Advocate 建议）|

**Files:**
- Rewrite: `agent-service/app/agent/skill.py`
- Create: `agent-service/tests/agent/test_skill_structure.py`

- [ ] **Step 1: 编写提示词结构测试**

```python
# agent-service/tests/agent/test_skill_structure.py
"""验证 Skill 提示词的结构满足 think-heavy 设计要求。"""
import pytest
import re
from app.agent.skill import TIPTAP_CREATION_SKILL


def test_skill_starts_with_thinking_framework():
    """思考框架必须在提示词的前 40% 位置。"""
    lines = TIPTAP_CREATION_SKILL.strip().split("\n")
    total = len(lines)
    # 查找 "## Output Format" 或 "## Markdown Format" — 格式规范的开始
    format_start = None
    for i, line in enumerate(lines):
        if line.startswith("## ") and ("Format" in line or "格式" in line):
            format_start = i
            break
    assert format_start is not None, "Must have a format section"
    # 思考框架应占前 40%+
    assert format_start / total >= 0.35, (
        f"Thinking framework ends at line {format_start}/{total} "
        f"({format_start/total:.0%}), should be >= 35%"
    )


def test_skill_has_analysis_dimensions():
    """必须包含显式的分析维度框架。"""
    text = TIPTAP_CREATION_SKILL
    required_dimensions = [
        "content structure",   # 内容结构分析
        "information density", # 信息密度评估
        "audience",            # 受众推断
        "image-text",          # 图文对应
    ]
    for dim in required_dimensions:
        assert dim.lower() in text.lower(), f"Missing analysis dimension: {dim}"


def test_skill_has_few_shot_example():
    """必须包含至少一个 few-shot 输出示例。"""
    assert "### Example" in TIPTAP_CREATION_SKILL or "### 示例" in TIPTAP_CREATION_SKILL


def test_skill_no_universal_compression():
    """不能包含通用压缩指令。"""
    text = TIPTAP_CREATION_SKILL
    forbidden = [
        "NEVER pad content with filler",
        "better to be concise than verbose",
    ]
    for phrase in forbidden:
        assert phrase not in text, f"Found compression bias: '{phrase}'"


def test_skill_has_task_aware_length():
    """长度指导必须是任务感知的，而非一刀切。"""
    text = TIPTAP_CREATION_SKILL
    # 应包含基于源内容的长度指导
    assert "source" in text.lower() and ("depth" in text.lower() or "completeness" in text.lower())


def test_critical_constraints_in_last_30_percent():
    """图片 URL 和禁止模式等关键约束应在后 30%（recency bias）。"""
    lines = TIPTAP_CREATION_SKILL.strip().split("\n")
    total = len(lines)
    # 查找图片 URL 相关约束
    for i, line in enumerate(lines):
        if "MUST appear" in line and "image" in line.lower():
            assert i / total >= 0.65, (
                f"Image URL constraint at line {i}/{total} ({i/total:.0%}), "
                f"should be in last 35% for recency bias"
            )
            break
    else:
        pytest.fail("Could not find 'MUST appear' + 'image' constraint line in skill")
```

- [ ] **Step 2: 运行测试确认全部失败**

Run: `cd /e/test/Docmost/.worktrees/feat-intelligent-agent/agent-service && python -m pytest tests/agent/test_skill_structure.py -v`
Expected: 全部 FAIL（当前 skill.py 不满足新结构）

- [ ] **Step 3: 重写 skill.py**

将 `agent-service/app/agent/skill.py` 完整替换为以下内容：

```python
"""TipTap 创作 Skill — Docmost Intelligent Agent 的 system_prompt。

设计原则（2026-03-27 重构）：
- 思考框架前置（~40%），利用 primacy bias
- 格式规范精简到中段（~30%）
- 工具规则 + 关键约束放尾部（~30%），利用 recency bias
- 任务感知长度校准替代通用压缩
- Few-shot 示例引导输出质量
- 参考：Anthropic 上下文工程指南、Augment Code 11 条技巧、Cursor GPT-5 策略
"""

TIPTAP_CREATION_SKILL = """\
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
   Does it flow from introduction → body → conclusion? Where are the structural gaps?

2. **Information density assessment** — What are the core facts, data points, and actionable items?
   What is filler vs substance? What deserves emphasis? What can be reorganized for clarity?

3. **Audience and purpose inference** — Who will read this? (Developer? Manager? End user?)
   What level of technical detail is appropriate? What tone fits?

4. **Image-text correspondence** (if images exist) — Which image illustrates which concept?
   Where should each image be placed to maximize comprehension? What should the alt text convey?

### Step 4: PLAN the Output Structure

Before writing, decide:
- Document outline (sections and their order)
- Key improvements over the source (list them)
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
| VPN 信息 | 服务器地址、账号、密码 |

## Step 1: 打开网络设置

打开 **设置 → 网络和 Internet → VPN**，点击 **添加 VPN 连接**。

![VPN 设置入口界面](https://docmost-url/image1.jpg)

## Step 2: 填写连接参数
...

## 常见问题

<details>
<summary>连接后无法访问内网资源？</summary>
检查 VPN 的"分割隧道"设置...
</details>
```

**Why this is good:**
- Callout block adds context the source lacked
- Table organizes prerequisites (source used scattered bullet points)
- Step-by-step with screenshots placed at relevant positions
- FAQ section adds value beyond the source
- No filler, no corporate buzzwords, every sentence carries information

## Markdown Format for TipTap

Output is auto-converted: Markdown → HTML → ProseMirror JSON → TipTap editor.

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
- NEVER skip levels: `#` → `###` is forbidden

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

## Tool Usage Strategy

### URL Tasks (user provides a URL)
1. Call `scrape_url` ONCE
2. If scraping fails → call `search_web` ONCE as fallback
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

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /e/test/Docmost/.worktrees/feat-intelligent-agent/agent-service && python -m pytest tests/agent/test_skill_structure.py -v`
Expected: 全部 PASS

- [ ] **Step 5: 提交**

```bash
cd /e/test/Docmost/.worktrees/feat-intelligent-agent
git add agent-service/app/agent/skill.py agent-service/tests/agent/test_skill_structure.py
git commit -m "feat(agent): redesign skill prompt for think-heavy pattern

Restructure TIPTAP_CREATION_SKILL from act-heavy (189/222 lines on format rules)
to think-heavy (40% thinking framework, 30% format, 30% tool rules).

Key changes:
- Add 4-dimension analysis framework (structure, density, audience, image-text)
- Add few-shot output example
- Replace universal compression bias with task-aware depth calibration
- Move critical constraints to end for recency bias
- Add pre-action reasoning guidance (explain before each tool call)

Evidence: Anthropic think-tool 54% improvement, Augment Code attention distribution,
arXiv Concise Thoughts on compression harm, Cursor GPT-5 dual-control strategy."
```

---

## Task 2: P1 — 多阶段思考可见性（核心差距修复）

### 问题

用户核心痛点：MiniMax 展示 3 个思考阶段（规划→分析→总结），我们只展示 1 个折叠块"已思考 Xs"。

### 关键发现

经验证，PydanticAI `run_stream_events()` **已经在每轮 ReAct 循环中独立发出 ThinkingPart 事件**：

```
[轮次1] PartStartEvent(ThinkingPart) → ThinkingPartDelta × N → FunctionToolCallEvent
[轮次2] PartStartEvent(ThinkingPart) → ThinkingPartDelta × N → FunctionToolCallEvent
[轮次3] PartStartEvent(ThinkingPart) → ThinkingPartDelta × N → TextPartDelta（最终内容）
```

问题在于：
1. **runner.py** 不区分不同轮次的 thinking 事件
2. **前端** 将所有 thinking chunk 拼接到一个 `thinkingRef.current` 字符串，丢失阶段边界
3. **UI** 只有一个折叠块，无法展示多个独立阶段

### 设计方案

在 runner.py 中添加 `thinking_phase` 计数器，当检测到新 thinking 阶段开始时（`PartStartEvent(ThinkingPart)` 对应的 SSE `thinking` 事件有 `content: ""`），递增计数器并在事件中附加 `phase` 字段。前端按 phase 分组展示。

**Files:**
- Modify: `agent-service/app/agent/runner.py` — 添加 phase 计数器
- Modify: `apps/client/src/ee/ai/types/agent-v2.types.ts` — thinking 事件增加 phase 字段
- Modify: `apps/client/src/ee/ai/hooks/use-agent-session.ts` — 按 phase 分组累积
- Modify: `apps/client/src/ee/ai/components/agent-panel/agent-message.tsx` — 多阶段 UI

- [ ] **Step 1: 修改 runner.py — 添加 thinking phase 计数器**

在 `runner.py` 的 `run_agent` 函数中，`tool_call_count` 旁添加 phase 跟踪：

```python
    tool_call_count = 0
    thinking_phase = 0  # 新增：思考阶段计数器

    # ... 在事件循环内，yield sse 之前：

            # 检测新 thinking 阶段开始（PartStartEvent(ThinkingPart) → content: ""）
            if sse and sse["type"] == "thinking" and sse.get("content") == "":
                thinking_phase += 1
                sse["phase"] = thinking_phase
            elif sse and sse["type"] == "thinking" and "chunk" in sse:
                sse["phase"] = thinking_phase  # 将当前 phase 附加到每个 chunk

            yield sse
```

- [ ] **Step 2: 修改前端类型 — thinking 事件增加 phase**

在 `agent-v2.types.ts` 中更新 thinking 事件类型：

```typescript
// 旧：
| { type: "thinking"; content?: string; chunk?: string }
// 新：
| { type: "thinking"; content?: string; chunk?: string; phase?: number }
```

AgentMessage 类型中 `thinkingContent` 改为 `thinkingPhases`：

```typescript
interface ThinkingPhase {
  phase: number;
  content: string;
}

interface AgentMessage {
  // ... 其他字段不变
  thinkingPhases?: ThinkingPhase[];  // 替换 thinkingContent?: string
}
```

- [ ] **Step 3: 修改 use-agent-session.ts — 按 phase 分组累积**

```typescript
// 旧：thinkingRef.current += event.chunk
// 新：
const thinkingPhasesRef = useRef<ThinkingPhase[]>([]);

// case "thinking" 处理:
case "thinking": {
  setStatus("thinking");
  const phase = event.phase || 1;
  // 查找或创建当前 phase
  let current = thinkingPhasesRef.current.find(p => p.phase === phase);
  if (!current) {
    current = { phase, content: "" };
    thinkingPhasesRef.current.push(current);
  }
  if (event.chunk) {
    current.content += event.chunk;
  }
  updateLastAssistant({ thinkingPhases: [...thinkingPhasesRef.current] });
  break;
}
```

- [ ] **Step 4: 修改 agent-message.tsx — 多阶段 thinking UI**

将单个折叠块替换为多阶段展示：

```tsx
// 为每个 thinking phase 渲染一个独立的折叠块
{message.thinkingPhases?.map((phase) => {
  const label = phase.phase === message.thinkingPhases!.length
    ? "最终分析"  // 最后一个阶段
    : `思考阶段 ${phase.phase}`;

  return (
    <ThinkingPhaseBlock
      key={phase.phase}
      label={label}
      content={phase.content}
      isLatest={phase.phase === message.thinkingPhases!.length}
      elapsed={phase.phase === message.thinkingPhases!.length ? elapsed : undefined}
    />
  );
})}

// ThinkingPhaseBlock 是一个简单的折叠组件：
// - 标签（"思考阶段 1" / "思考阶段 2" / "最终分析"）
// - 内容摘要（折叠时显示前 2 行）
// - 完整内容（展开时）
```

- [ ] **Step 5: 浏览器验证**

测试 AgentPanel 中的多阶段展示：
1. 文件上传任务：应看到 2-3 个思考阶段（extract 前 → describe 前 → 最终分析）
2. URL 重写任务：应看到 1-2 个思考阶段（scrape 前 → 最终分析）
3. 每个阶段独立折叠/展开
4. 折叠时显示该阶段内容的前 2 行摘要

- [ ] **Step 6: 提交**

```bash
cd /e/test/Docmost/.worktrees/feat-intelligent-agent
git add agent-service/app/agent/runner.py \
        apps/client/src/ee/ai/types/agent-v2.types.ts \
        apps/client/src/ee/ai/hooks/use-agent-session.ts \
        apps/client/src/ee/ai/components/agent-panel/agent-message.tsx
git commit -m "feat(agent): multi-phase thinking visibility

PydanticAI emits ThinkingPart events in EVERY ReAct iteration, not just
the final one. Add phase tracking in runner.py and per-phase display in
frontend, so users see separate thinking blocks for each stage:

  Phase 1: Planning (before first tool call)
  Phase 2: Analysis (between tool calls)
  Phase 3: Final synthesis (before output)

This addresses the core gap vs MiniMax's 3-phase thinking visibility."
```

---

## Task 3: P2 — 工具输出结构化

将 5 个工具的返回值从 str 改为 dict。Gemini 对 dict 返回值有原生 JSON 支持（不被 `{"return_value": ...}` 包装），模型可以直接从结构化字段中提取信息，辅助更深层推理。

### 设计依据

| 决策 | 支撑 |
|------|------|
| 返回 dict 而非 str | PydanticAI 源码确认：Google provider 用 `model_response_object()` 原生传递 dict |
| 分离摘要与全文 | Anthropic 工具设计指南："返回有意义的上下文"+"工具响应 < 25k tokens" |
| 保留 str 向后兼容 | OpenAI provider 会将 dict 序列化为 JSON 字符串，模型仍可理解 |

**Files:**
- Modify: `agent-service/app/agent/tools/scrape_url.py`
- Modify: `agent-service/app/agent/tools/search_web.py`
- Modify: `agent-service/app/agent/tools/read_page.py`
- Modify: `agent-service/app/agent/tools/extract_document.py`
- Modify: `agent-service/app/agent/tools/describe_images.py`
- Create: `agent-service/tests/agent/test_tools_return_structure.py`

- [ ] **Step 1: 编写返回值结构测试**

```python
# agent-service/tests/agent/test_tools_return_structure.py
"""验证所有 v2 工具返回结构化 dict（而非原始 str）。"""
import pytest
from unittest.mock import patch

from app.agent.deps import AgentDeps


def _make_deps(**overrides) -> AgentDeps:
    """创建测试用 AgentDeps（使用真实类，确保字段完整）。"""
    defaults = dict(
        thread_id="test", page_id="page-1", workspace_id="ws-1",
        user_id="user-1", docmost_base_url="http://localhost:3000",
        internal_secret="secret",
    )
    defaults.update(overrides)
    return AgentDeps(**defaults)


@pytest.mark.asyncio
async def test_scrape_url_returns_dict():
    from app.agent.tools.scrape_url import scrape_url_impl
    # mock 工厂函数（而非模块级变量），确保拦截实际调用
    with patch("app.agent.tools.scrape_url._get_firecrawl_fn",
               return_value=lambda url: "Hello World content " * 10):
        result = await scrape_url_impl("https://example.com")
    assert isinstance(result, dict)
    assert result["status"] == "success"
    assert "content" in result
    assert "word_count" in result
    assert result["url"] == "https://example.com"


@pytest.mark.asyncio
async def test_search_web_returns_dict():
    from app.agent.tools.search_web import search_web_impl
    with patch("app.agent.tools.search_web._get_tavily_fn",
               return_value=lambda query: "Result 1: Something relevant " * 5):
        result = await search_web_impl("test query")
    assert isinstance(result, dict)
    assert result["status"] == "success"
    assert "results" in result
    assert result["query"] == "test query"


@pytest.mark.asyncio
async def test_scrape_url_error_returns_dict():
    from app.agent.tools.scrape_url import scrape_url_impl
    result = await scrape_url_impl("not-a-url")
    assert isinstance(result, dict)
    assert result["status"] == "error"
    assert "error" in result


@pytest.mark.asyncio
async def test_extract_document_no_files_returns_dict():
    from app.agent.tools.extract_document import extract_document_impl
    deps = _make_deps(files=[])
    result = await extract_document_impl(deps)
    assert isinstance(result, dict)
    assert result["status"] == "error"
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /e/test/Docmost/.worktrees/feat-intelligent-agent/agent-service && python -m pytest tests/agent/test_tools_return_structure.py -v`
Expected: 全部 FAIL（当前工具返回 str）

- [ ] **Step 3: 改造 scrape_url.py**

```python
# agent-service/app/agent/tools/scrape_url.py
"""工具：抓取网页主要内容。"""
from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.agent.deps import AgentDeps

from pydantic_ai import RunContext


# 延迟获取底层函数引用（避免 import-time side effects）
def _get_firecrawl_fn():
    from app.tools.firecrawl_scrape import firecrawl_scrape
    return firecrawl_scrape.func if hasattr(firecrawl_scrape, "func") else firecrawl_scrape


async def scrape_url_impl(url: str) -> dict:
    """可测试的核心逻辑。返回结构化 dict。"""
    if not url.startswith(("http://", "https://")):
        return {"status": "error", "url": url, "error": f"Invalid URL format. Must start with http:// or https://."}

    try:
        fn = _get_firecrawl_fn()
        content = await asyncio.wait_for(asyncio.to_thread(fn, url), timeout=30)
        if not content or len(str(content).strip()) < 50:
            return {"status": "error", "url": url, "error": "No meaningful content extracted."}
        content_str = str(content)
        truncated = len(content_str) > 8000
        if truncated:
            content_str = content_str[:8000]
        word_count = len(content_str.split())
        return {
            "status": "success",
            "url": url,
            "content": content_str,
            "word_count": word_count,
            "truncated": truncated,
        }
    except asyncio.TimeoutError:
        return {"status": "error", "url": url, "error": "Scraping timed out after 30 seconds."}
    except Exception as e:
        return {"status": "error", "url": url, "error": f"{type(e).__name__}: {e}"}


async def scrape_url_tool(ctx: RunContext["AgentDeps"], url: str) -> dict:
    """Fetch and extract the main content from a web URL.

    Call this when the user provides a URL or you need to read a web page.
    Returns structured result with content, word count, and truncation status.

    Args:
        url: The full URL to scrape (must start with http:// or https://).
    """
    return await scrape_url_impl(url)
```

- [ ] **Step 4: 改造 search_web.py**

```python
# agent-service/app/agent/tools/search_web.py
"""工具：搜索互联网获取最新信息。"""
from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.agent.deps import AgentDeps

from pydantic_ai import RunContext


def _get_tavily_fn():
    from app.tools.tavily_search import tavily_search
    return tavily_search.func if hasattr(tavily_search, "func") else tavily_search


async def search_web_impl(query: str) -> dict:
    """可测试的核心逻辑。返回结构化 dict。"""
    try:
        fn = _get_tavily_fn()
        result_text = await asyncio.wait_for(asyncio.to_thread(fn, query), timeout=15)
        if not result_text or len(str(result_text).strip()) < 20:
            return {"status": "no_results", "query": query, "results": "", "message": "No results found."}
        return {
            "status": "success",
            "query": query,
            "results": str(result_text),
        }
    except asyncio.TimeoutError:
        return {"status": "error", "query": query, "error": "Search timed out after 15 seconds."}
    except Exception as e:
        return {"status": "error", "query": query, "error": f"{type(e).__name__}: {e}"}


async def search_web_tool(ctx: RunContext["AgentDeps"], query: str) -> dict:
    """Search the internet for current information on a topic.

    Call this when you need facts, references, or up-to-date information
    not available in uploaded documents. Uses Tavily (LLM-optimized search).

    Args:
        query: The search query (be specific for better results).
    """
    return await search_web_impl(query)
```

- [ ] **Step 5: 改造 read_page.py**

```python
# agent-service/app/agent/tools/read_page.py
"""工具：读取 Docmost 已有页面内容。"""
from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.agent.deps import AgentDeps

from pydantic_ai import RunContext


async def read_page_impl(page_id: str) -> dict:
    """可测试的核心逻辑。签名保持最小化（不传无用参数）。"""
    try:
        from app.tools.docmost_api import docmost_page_read
        fn = docmost_page_read.func if hasattr(docmost_page_read, "func") else docmost_page_read
        content = await asyncio.wait_for(asyncio.to_thread(fn, page_id), timeout=10)
        if not content or len(str(content).strip()) < 10:
            return {"status": "error", "page_id": page_id, "error": "Page is empty or not found."}
        content_str = str(content)
        truncated = len(content_str) > 8000
        if truncated:
            content_str = content_str[:8000]
        return {
            "status": "success",
            "page_id": page_id,
            "content": content_str,
            "word_count": len(content_str.split()),
            "truncated": truncated,
        }
    except asyncio.TimeoutError:
        return {"status": "error", "page_id": page_id, "error": "Page read timed out."}
    except Exception as e:
        return {"status": "error", "page_id": page_id, "error": f"{type(e).__name__}: {e}"}


async def read_page_tool(ctx: RunContext["AgentDeps"], page_id: str = "") -> dict:
    """Read the content of an existing Docmost page.

    Call this when you need to reference or incorporate content from another page.
    If page_id is empty, reads the current page.

    Args:
        page_id: The page ID to read. Defaults to current page if empty.
    """
    pid = page_id or ctx.deps.page_id or ""
    if not pid:
        return {"status": "error", "page_id": "", "error": "No page_id provided and no current page available."}
    return await read_page_impl(pid)
```

- [ ] **Step 6: 改造 extract_document.py**

将 `extract_document_impl` 的返回值从拼接字符串改为结构化 dict：

```python
# 修改 extract_document_impl 的返回部分（第 135-161 行）
# 旧代码:
#   return f"{summary}{image_section}\n\n[Document Content]\n\n{content}"
# 新代码:

        return {
            "status": "success",
            "title": doc_title or "Untitled",
            "word_count": word_count,
            "images": image_metadata,  # [{ref, url, width, height, size_kb}, ...]
            "content": content,
            "instructions": (
                "Call `describe_images` next to understand what each image shows, "
                "then place each image after the text it illustrates. "
                "Every image URL above MUST appear in your final Markdown output."
            ) if image_metadata else None,
        }
```

同时修改错误返回（第 27、163-166 行）：
```python
    if not deps.files:
        return {"status": "error", "error": "No files were uploaded. Ask the user to upload a document."}
    # ...
    except asyncio.TimeoutError:
        return {"status": "error", "error": "Document extraction timed out after 120 seconds."}
    except Exception as e:
        return {"status": "error", "error": f"Failed to extract document: {type(e).__name__}: {e}"}
```

- [ ] **Step 7: 改造 describe_images.py — 完整替换 `describe_images_impl`**

```python
# agent-service/app/agent/tools/describe_images.py
# 完整替换 describe_images_impl 函数（第 20-58 行）

async def describe_images_impl(deps: "AgentDeps") -> dict:
    """可测试的核心逻辑。返回结构化 dict。"""
    if not deps.uploaded_image_urls:
        return {"status": "error", "error": "No images uploaded. Call extract_document first."}

    image_payloads = getattr(deps, "image_payloads", None) or []
    if not image_payloads:
        return {"status": "error", "error": "No image data available. Call extract_document first."}

    try:
        from app.tools.vlm_understand import vlm_describe_batch

        images_for_vlm = [(img.b64, img.mime_type) for img in image_payloads]
        loop = asyncio.get_running_loop()
        descriptions = await loop.run_in_executor(None, vlm_describe_batch, images_for_vlm)

        # 将 list[str] 描述与已上传 URL 对齐，构建 list[dict]
        url_items = list(deps.uploaded_image_urls.items())
        structured = []
        for i, desc in enumerate(descriptions):
            ref, url = url_items[i] if i < len(url_items) else (f"image{i+1}", "?")
            structured.append({"ref": ref, "url": url, "description": desc})

        return {
            "status": "success",
            "image_count": len(structured),
            "descriptions": structured,
        }
    except Exception as e:
        logger.warning(f"describe_images failed: {e}")
        return {"status": "error", "error": f"{type(e).__name__}: {e}"}
```

同时更新函数签名的返回类型注解（第 61 行）：
```python
async def describe_images_tool(ctx: RunContext["AgentDeps"]) -> dict:
```

- [ ] **Step 8: 运行新测试确认通过**

Run: `cd /e/test/Docmost/.worktrees/feat-intelligent-agent/agent-service && python -m pytest tests/agent/test_tools_return_structure.py -v`
Expected: 全部 PASS

- [ ] **Step 9: 迁移已有工具测试断言（关键！否则全量测试会回归）**

已有 5 个测试文件的断言检查 str 返回值，必须同步迁移至 dict 格式：

**`tests/agent/tools/test_scrape_url.py` — 6 个断言迁移：**
```python
# 旧: assert "[Web Content" in result → 新:
assert result["status"] == "success"
# 旧: assert "Page content" in result → 新:
assert "Page content" in result["content"]
# 旧: assert "[Error]" in result → 新:
assert result["status"] == "error"
# 旧: assert "[Truncated" in result → 新:
assert result["truncated"] is True
# 旧: assert len(result) < 12000 → 新:
assert len(result["content"]) < 12000
```

**`tests/agent/tools/test_search_web.py` — 3 个断言迁移：**
```python
# 旧: assert "[Search Results" in result → 新:
assert result["status"] == "success"
# 旧: assert "Title" in result → 新:
assert "Title" in result["results"]
# 旧: assert "[No Results]" in result → 新:
assert result["status"] == "no_results"
```

**`tests/agent/tools/test_read_page.py` — 3 个断言迁移：**
```python
# 旧: assert "[Page:" in result → 新:
assert result["status"] == "success"
# 旧: assert "Page Title" in result → 新:
assert "Page Title" in result["content"]
# 旧: assert "[Truncated" in result → 新:
assert result["truncated"] is True
```

**`tests/agent/tools/test_extract_document.py` — 4 个断言迁移：**
```python
# 旧: assert "[No Files]" in result → 新:
assert result["status"] == "error"
# 旧: assert "[Document Content]" in result → 新:
assert result["status"] == "success"
# 旧: assert "Test" in result → 新:
assert "Test" in result["content"]
# 旧: assert "[Error]" in result → 新:
assert result["status"] == "error"
```

**`tests/agent/tools/test_describe_images.py` — 2 个断言迁移：**
```python
# 旧: assert "Clash配置" in result → 新 (result 现在是 dict):
assert any("Clash配置" in d["description"] for d in result["descriptions"])
# 旧: assert "代理" in result → 新:
assert any("代理" in d["description"] for d in result["descriptions"])
```

- [ ] **Step 10: 运行全量已有测试确认无回归**

Run: `cd /e/test/Docmost/.worktrees/feat-intelligent-agent/agent-service && python -m pytest tests/agent/ -v`
Expected: 全部 PASS

- [ ] **Step 10: 提交**

```bash
cd /e/test/Docmost/.worktrees/feat-intelligent-agent
git add agent-service/app/agent/tools/ agent-service/tests/agent/test_tools_return_structure.py
git commit -m "feat(agent): structured dict returns for all tools

Change all 5 tools from returning str to returning dict.
Gemini receives dict as native JSON (not wrapped in return_value),
enabling better structured reasoning.

scrape_url: {status, url, content, word_count, truncated}
search_web: {status, query, results}
read_page:  {status, page_id, content, word_count, truncated}
extract_document: {status, title, word_count, images[], content, instructions}
describe_images: {status, image_count, descriptions[]}

Ref: PydanticAI Google provider model_response_object() passes dict natively,
Anthropic tool design guide recommends meaningful structured context."
```

---

## Task 4: P3 — 质量验证闭环

增强 validator.py 的检查维度，在 runner.py 流式完成后进行质量评估。若检测到关键问题（如图片缺失），发送结构化 warning 事件。

**约束：** PydanticAI `output_validator` 在流式模式有 bug（Issue #3393），因此不使用 `@agent.output_validator` 装饰器，而是保持当前的"流后验证"模式，但增强验证维度。

**Files:**
- Rewrite: `agent-service/app/agent/validator.py`
- Modify: `agent-service/app/agent/runner.py`
- Create: `agent-service/tests/agent/test_validator_enhanced.py`

- [ ] **Step 1: 编写增强验证器测试**

```python
# agent-service/tests/agent/test_validator_enhanced.py
"""测试增强后的 Agent 输出验证器。"""
from app.agent.validator import validate_agent_output, ValidationResult


def test_short_output_detected():
    result = validate_agent_output("Hello", {})
    assert not result.passed
    assert any("too short" in i.lower() for i in result.issues)


def test_missing_image_detected():
    urls = {"image1": "https://docmost/img1.jpg"}
    result = validate_agent_output("# Title\n\nSome content", urls)
    assert not result.passed
    assert any("image" in i.lower() for i in result.issues)


def test_all_images_present_passes():
    urls = {"image1": "https://docmost/img1.jpg", "image2": "https://docmost/img2.jpg"}
    output = "# Title\n\n![desc](https://docmost/img1.jpg)\n\n![desc](https://docmost/img2.jpg)"
    result = validate_agent_output(output, urls)
    assert result.passed


def test_multiple_h1_detected():
    output = "# Title 1\n\nContent\n\n# Title 2\n\nMore content" + " word" * 100
    result = validate_agent_output(output, {})
    assert not result.passed
    assert any("H1" in i for i in result.issues)


def test_ocr_noise_detected():
    output = "正常内容 " * 50 + "自 日志 设置 ? 帮助 A 关于"
    result = validate_agent_output(output, {})
    assert not result.passed
    assert any("OCR" in i for i in result.issues)


def test_compression_ratio_warning():
    """当源内容 >2000 词但输出 <500 词时，应警告压缩过度。"""
    output = "Short summary. " * 30  # ~60 words
    result = validate_agent_output(output, {}, source_word_count=3000)
    assert not result.passed
    assert any("compress" in i.lower() or "压缩" in i for i in result.issues)


def test_normal_output_passes():
    output = "# Good Title\n\n" + "This is normal content with enough depth. " * 50
    result = validate_agent_output(output, {})
    assert result.passed
    assert result.issues == []


def test_validation_result_has_score():
    output = "# Title\n\n" + "Good content. " * 100
    result = validate_agent_output(output, {})
    assert hasattr(result, "score")
    assert 0 <= result.score <= 1.0
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /e/test/Docmost/.worktrees/feat-intelligent-agent/agent-service && python -m pytest tests/agent/test_validator_enhanced.py -v`
Expected: FAIL（当前 validator 缺少 compression_ratio 检查和 score）

- [ ] **Step 3: 重写 validator.py**

```python
# agent-service/app/agent/validator.py
"""Agent 输出后验证器。

验证维度：
1. 输出长度（不能过短）
2. 图片 URL 完整性（所有上传图片必须出现）
3. OCR 噪音检测
4. 标题层级（H1 最多 1 个）
5. 压缩过度检测（输出/源 比例过低时警告）

每项检查有权重，最终产出 0-1 综合分。
"""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ValidationResult:
    """验证结果。"""
    passed: bool
    score: float  # 0.0 - 1.0 综合质量分
    issues: list[str] = field(default_factory=list)


def validate_agent_output(
    output: str,
    uploaded_image_urls: dict[str, str],
    min_length: int = 100,
    source_word_count: int = 0,
) -> ValidationResult:
    """验证 Agent 输出的质量。

    Args:
        output: Agent 生成的 Markdown 文本。
        uploaded_image_urls: extract_document 上传的图片 URL 映射。
        min_length: 输出最小字符数。
        source_word_count: 源内容词数（用于压缩比检测，0 表示未知）。

    Returns:
        ValidationResult，passed=True 且 score >= 0.6 表示可接受。
    """
    issues: list[str] = []
    deductions = 0.0  # 扣分累计

    stripped = output.strip()

    # 检查 1: 输出不能为空或过短（权重 0.3）
    if len(stripped) < min_length:
        issues.append(f"Output too short: {len(stripped)} chars (minimum {min_length})")
        deductions += 0.3

    # 检查 2: 所有上传的图片 URL 必须出现（权重 0.05/张）
    for ref, url in uploaded_image_urls.items():
        if url not in output:
            issues.append(f"Missing image: {ref} → {url}")
            deductions += 0.05

    # 检查 3: OCR 噪音检测（权重 0.1）
    ocr_patterns = ["自 日志", "? 帮助", "A 关于", "设置\n?"]
    for pattern in ocr_patterns:
        if pattern in output:
            issues.append(f"OCR noise detected: '{pattern}'")
            deductions += 0.1
            break  # 一次扣分足够

    # 检查 4: H1 最多 1 个（权重 0.1）
    lines = output.split("\n")
    h1_count = sum(1 for line in lines if line.startswith("# ") or line == "#")
    if h1_count > 1:
        issues.append(f"Multiple H1 headings: {h1_count} (maximum 1)")
        deductions += 0.1

    # 检查 5: 压缩过度检测（权重 0.2）
    if source_word_count > 0:
        output_word_count = len(stripped.split())
        ratio = output_word_count / source_word_count
        # 如果源 >2000 词但输出不到源的 25%，可能过度压缩
        if source_word_count > 2000 and ratio < 0.25:
            issues.append(
                f"Possible over-compression: {output_word_count} words output "
                f"from {source_word_count} words source (ratio: {ratio:.0%})"
            )
            deductions += 0.2
        elif source_word_count > 1000 and ratio < 0.15:
            issues.append(
                f"Severe compression: {output_word_count} words from "
                f"{source_word_count} words source (ratio: {ratio:.0%})"
            )
            deductions += 0.2

    score = max(0.0, 1.0 - deductions)
    return ValidationResult(
        passed=len(issues) == 0,
        score=round(score, 2),
        issues=issues,
    )
```

- [ ] **Step 4: 修改 runner.py 使用增强验证器**

在 `runner.py` 的后验证部分（第 123-130 行），增加 `source_word_count` 传递和 score 日志：

```python
    # 4. 后验证（在循环结束后，使用最终完整输出）
    # 注意：有意移除了旧的 `if deps.uploaded_image_urls` 前置条件，
    # 因为增强验证器现在也检查长度和压缩比等维度，即使无图片也应运行。
    if final_output:
        try:
            validation = validate_agent_output(
                final_output,
                deps.uploaded_image_urls,
                source_word_count=deps.source_word_count,  # P2 改造后由 extract_document 填充
            )
            if not validation.passed:
                logger.warning(
                    "Validation issues for thread %s (score=%.2f): %s",
                    deps.thread_id, validation.score, validation.issues,
                )
                yield {"type": "warning", "issues": validation.issues, "score": validation.score}
        except Exception as e:
            logger.warning("Post-validation failed for thread %s: %s", deps.thread_id, e)
```

**同时修改 `deps.py`**，新增 `source_word_count` 字段：

```python
# agent-service/app/agent/deps.py — 在 image_payloads 后添加：
    # extract_document 工具填充的源内容词数（供 validator 检测压缩比）
    source_word_count: int = 0
```

**同时修改 `extract_document.py`**，在成功提取后保存词数到 deps：

```python
# 在 extract_document_impl 返回 dict 之前添加：
        deps.source_word_count = word_count
```

- [ ] **Step 5: 运行测试确认通过**

Run: `cd /e/test/Docmost/.worktrees/feat-intelligent-agent/agent-service && python -m pytest tests/agent/test_validator_enhanced.py -v`
Expected: 全部 PASS

- [ ] **Step 6: 运行全量测试确认无回归**

Run: `cd /e/test/Docmost/.worktrees/feat-intelligent-agent/agent-service && python -m pytest tests/agent/ -v`
Expected: 全部 PASS

- [ ] **Step 7: 提交**

```bash
cd /e/test/Docmost/.worktrees/feat-intelligent-agent
git add agent-service/app/agent/validator.py agent-service/app/agent/runner.py agent-service/tests/agent/test_validator_enhanced.py
git commit -m "feat(agent): enhanced post-stream quality validation

Add compression detection (output/source word ratio), scoring (0-1),
and structured warning events with score field.

Cannot use PydanticAI output_validator in streaming mode (Issue #3393),
so enhanced the existing post-stream validation pattern instead."
```

---

## Task 5: Gemini 截断检测（差距 3）

Gemini 3 Pro 存在已知的静默截断问题（GitHub gemini-cli#2104）。当输出达到 max_tokens 限制时可能静默停止生成。

### 设计

在 runner.py 中，利用 `AgentRunResultEvent.result.response.finish_reason` 检测截断。PydanticAI 将 Gemini 的 `MAX_TOKENS` 映射为归一化值 `'length'`（已验证源码 `google.py:149`）。

**Files:**
- Modify: `agent-service/app/agent/runner.py`

- [ ] **Step 1: 在 runner.py 的 AgentRunResultEvent 处理中添加截断检测**

```python
            # AgentRunResultEvent 包含权威的最终输出
            if isinstance(event, AgentRunResultEvent):
                if hasattr(event.result, "output"):
                    authoritative_output = event.result.output
                # 截断检测：Gemini MAX_TOKENS → PydanticAI 'length'
                try:
                    resp = event.result.response
                    if resp and resp.finish_reason == "length":
                        yield {
                            "type": "warning",
                            "issues": ["输出可能不完整：已达到模型 token 上限，内容可能被截断。"],
                        }
                except Exception:
                    pass  # response 不可用时静默跳过
                continue
```

- [ ] **Step 2: 提交**

```bash
cd /e/test/Docmost/.worktrees/feat-intelligent-agent
git add agent-service/app/agent/runner.py
git commit -m "feat(agent): detect Gemini output truncation via finish_reason

When Gemini hits max_tokens, PydanticAI maps MAX_TOKENS to finish_reason='length'.
Emit a warning event so the frontend can inform the user.

Ref: gemini-cli#2104 (silent truncation), google.py:149 (_FINISH_REASON_MAP)"
```

---

## Task 6: MAX_TOOL_CALLS 配置化（差距 4）

当前 `MAX_TOOL_CALLS = 10` 是硬代码。新 Skill 按任务类型定义不同工具次数（URL: 1-2, 研究: 1-3），但全局上限应可配置。

**Files:**
- Modify: `agent-service/app/agent/runner.py`

- [ ] **Step 1: 改为从环境变量读取**

```python
import os

# 单次 run 最大工具调用次数，可通过环境变量覆盖。
MAX_TOOL_CALLS = int(os.environ.get("AGENT_MAX_TOOL_CALLS", "10"))
```

- [ ] **Step 2: 提交**

```bash
cd /e/test/Docmost/.worktrees/feat-intelligent-agent
git add agent-service/app/agent/runner.py
git commit -m "feat(agent): make MAX_TOOL_CALLS configurable via env var

Read from AGENT_MAX_TOOL_CALLS env var, default 10. Allows tuning
tool call limits per deployment without code changes."
```

---

## Task 7: 质量重试兜底（差距 2）

当 P3 验证检测到**关键问题**（score < 0.4，如多张图片缺失）时，进行一次非流式重试。

### 约束
- PydanticAI `output_validator` 在流式模式有 bug（Issue #3393），不能用
- 但 `agent.run()`（非流式）可以正常触发 `output_validator`
- 重试后需要通过 `content_clear` + 新 `content` 事件替换前端已有内容

**Files:**
- Modify: `agent-service/app/agent/runner.py`

- [ ] **Step 1: 在 runner.py 后验证部分添加重试逻辑**

在现有 validation 代码之后添加：

```python
    # 5. 关键质量问题时尝试一次非流式重试
    if final_output and validation and validation.score < 0.4 and deps.uploaded_image_urls:
        logger.warning("Critical quality issues (score=%.2f), attempting retry for thread %s",
                       validation.score, deps.thread_id)
        yield {"type": "retrying", "reason": "检测到关键质量问题，正在重新生成..."}
        try:
            retry_prompt = (
                f"{prompt}\n\n"
                f"[IMPORTANT: Your previous output had these issues: {'; '.join(validation.issues)}. "
                f"Fix them in this attempt. Ensure ALL image URLs appear in the output.]"
            )
            retry_result = await agent.run(
                retry_prompt, deps=deps,
                message_history=message_history,
            )
            retry_output = retry_result.output
            retry_validation = validate_agent_output(
                retry_output, deps.uploaded_image_urls,
                source_word_count=deps.source_word_count,
            )
            if retry_validation.score > validation.score:
                # 重试结果更好，替换输出
                yield {"type": "content_clear"}
                # 分块发送重试内容
                chunk_size = 200
                for i in range(0, len(retry_output), chunk_size):
                    yield {"type": "content", "chunk": retry_output[i:i+chunk_size]}
                final_output = retry_output
                logger.info("Retry improved score: %.2f → %.2f for thread %s",
                           validation.score, retry_validation.score, deps.thread_id)
        except Exception as e:
            logger.warning("Retry failed for thread %s: %s", deps.thread_id, e)
```

- [ ] **Step 2: 前端确认 content_clear 事件已处理**

检查 `use-agent-session.ts` 是否已有 `content_clear` 处理。如果已有：

```typescript
case "content_clear":
  contentRef.current = "";
  updateLastAssistant({ content: "" });
  break;
```

则无需修改。如果没有，需要添加。

- [ ] **Step 3: 提交**

```bash
cd /e/test/Docmost/.worktrees/feat-intelligent-agent
git add agent-service/app/agent/runner.py
git commit -m "feat(agent): quality retry for critical validation failures

When post-stream validation score < 0.4 (e.g., multiple missing images),
attempt one non-streaming retry with explicit fix instructions.
If retry improves the score, replace output via content_clear + re-stream.

Uses agent.run() (non-streaming) to avoid PydanticAI Issue #3393."
```

---

## Task 8: 冒烟测试验证

端到端验证所有改动协同工作。

- [ ] **Step 1: 启动 Agent Service**

```bash
cd /e/test/Docmost/.worktrees/feat-intelligent-agent/agent-service
python run.py
```

- [ ] **Step 2: 测试 TC-01 URL 重写**

在 AgentPanel 中输入一个 URL，观察：
1. Agent 是否仅调用 1-2 次工具后开始深度思考
2. **是否看到多个思考阶段**（至少 2 个：工具调用前 + 最终分析）
3. 每个阶段是否可独立折叠/展开，有内容摘要
4. 输出是否有足够深度（不过度压缩）
5. 工具返回的结构化 dict 是否正常传递

- [ ] **Step 3: 测试 TC-02 文档上传**

上传一个包含图片的 DOCX/PDF，观察：
1. 应看到 **3 个思考阶段**（extract 前 → describe 前 → 最终分析）
2. 所有图片是否出现在最终输出中
3. 如果图片缺失，是否触发重试（score < 0.4 时）
4. 压缩比警告是否合理

- [ ] **Step 4: 测试 TC-03 研究创作**

输入一个研究任务，观察：
1. 搜索次数是否在 1-3 次内
2. 每次搜索前后是否有独立思考阶段
3. 输出深度是否匹配任务复杂度

- [ ] **Step 5: 测试 TC-04 截断检测**

使用一个会产生长输出的任务（如上传大文档），确认：
1. 如果输出被截断，是否看到截断警告
2. 警告文案是否清晰

- [ ] **Step 6: 记录测试结果并提交**

```bash
cd /e/test/Docmost/.worktrees/feat-intelligent-agent
git add -A
git commit -m "test: smoke test results for thinking depth enhancement"
```

---

## 附录 A: 新旧 Skill 提示词对比

| 维度 | 旧 (222 行) | 新 (~170 行) |
|------|------------|-------------|
| 思考引导 | 3 行 (1.4%) | ~65 行 (38%) |
| 格式规范 | 95 行 (43%) | ~50 行 (29%) |
| 工具规则 | 25 行 (11%) | ~25 行 (15%) |
| 质量约束 | 62 行 (28%) | ~20 行 (12%) |
| 深度校准 | 5 行（通用压缩） | ~12 行（任务感知） |
| Few-shot | 0 | 1 个完整示例 |

## 附录 B: 工具返回值对比

| 工具 | 旧返回 | 新返回 | Gemini 接收方式 |
|------|--------|--------|----------------|
| scrape_url | `"[Web Content from url]\n..."` | `{status, url, content, word_count, truncated}` | 原生 JSON dict |
| search_web | `"[Search Results for 'q']\n..."` | `{status, query, results}` | 原生 JSON dict |
| read_page | `"[Page: id]\n..."` | `{status, page_id, content, word_count, truncated}` | 原生 JSON dict |
| extract_document | 拼接文本块 | `{status, title, word_count, images[], content, instructions}` | 原生 JSON dict |
| describe_images | `"[Image Descriptions]\n..."` | `{status, image_count, descriptions[]}` | 原生 JSON dict |

## 附录 C: 交叉审视来源索引

| 来源 | 用于 | URL |
|------|------|-----|
| Anthropic 上下文工程 | P0 提示词设计 | https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents |
| Anthropic think tool | P0 pre-action reasoning | https://www.anthropic.com/engineering/claude-think-tool |
| Anthropic 工具设计 | P2 结构化返回 | https://www.anthropic.com/engineering/writing-tools-for-agents |
| Stanford lost-in-middle | P0 提示词布局 | https://cs.stanford.edu/~nfliu/papers/lost-in-the-middle.arxiv2023.pdf |
| Augment Code 11 tips | P0 注意力分布 | https://www.augmentcode.com/blog/how-to-build-your-agent-11-prompting-techniques-for-better-ai-agents |
| arXiv Concise Thoughts | P0 压缩危害 | https://arxiv.org/abs/2407.19825 |
| Cursor GPT-5 guide | P0 双重控制 | https://cookbook.openai.com/examples/gpt-5/gpt-5_prompting_guide |
| PromptingGuide few-shot | P0 示例设计 | https://www.promptingguide.ai/techniques/fewshot |
| arXiv Verbosity≠Veracity | P0 冗长风险 | https://arxiv.org/html/2411.07858v1 |
| PydanticAI Issue #3393 | P3 流式约束 | https://github.com/pydantic/pydantic-ai/issues/3393 |
| PydanticAI Google model | P2 dict 传递 | ai.pydantic.dev/models/google/ |
| Manus 上下文工程 | 整体设计 | https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus |
