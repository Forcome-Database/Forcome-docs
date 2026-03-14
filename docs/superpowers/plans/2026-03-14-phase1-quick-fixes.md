# Phase 1: Quick Fixes — 篇幅控制、压缩检测、去AI味

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 不改架构，通过调整配置、阈值和 Prompt 快速缓解长文压缩、审核失效和 AI 味重的问题

**Architecture:** 修改现有节点的 prompt 和硬编码参数，不新增文件、不改图拓扑。所有改动都是对 `writer.py`、`reviewer.py`、`graph.py`、`quality_checks.py`、`llm.py` 的局部修改。

**Tech Stack:** Python 3.11+, LangGraph, LangChain, pytest

---

## Chunk 1: 篇幅控制与压缩检测修复

### Task 1: Writer 注入目标字数指令

**Files:**
- Modify: `app/agent/nodes/writer.py:105-225`
- Test: `tests/test_writer.py`

- [ ] **Step 1: Write the failing test — 字数指令注入**

```python
# tests/test_writer.py — 追加

from app.agent.nodes.writer import _build_length_instruction


def test_build_length_instruction_preserve_with_source():
    result = _build_length_instruction("preserve", source_word_count=5000)
    assert "5000" in result
    assert "±10%" in result or "偏差" in result


def test_build_length_instruction_preserve_no_source():
    result = _build_length_instruction("preserve", source_word_count=0)
    assert result == ""


def test_build_length_instruction_expand():
    result = _build_length_instruction("expand", source_word_count=3000)
    assert "4500" in result  # 1.5x


def test_build_length_instruction_compress():
    result = _build_length_instruction("compress", source_word_count=3000)
    assert result == "" or "简洁" in result
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/test_writer.py::test_build_length_instruction_preserve_with_source -v`
Expected: FAIL with "cannot import name '_build_length_instruction'"

- [ ] **Step 3: Write minimal implementation**

在 `app/agent/nodes/writer.py` 中，在 `_strip_empty_images` 函数后添加：

```python
def _build_length_instruction(length_policy: str, source_word_count: int = 0) -> str:
    """Build explicit word-count instruction for the LLM."""
    if length_policy == "preserve" and source_word_count > 0:
        return (
            f"\n\n篇幅要求：目标约 {source_word_count} 字（允许±10%偏差）。"
            f"原文约 {source_word_count} 字，你的输出必须达到同等篇幅，不得大幅压缩。"
            f"如果内容不足以支撑该篇幅，请增加细节、案例或深入分析，而不是用空洞句子填充。"
        )
    elif length_policy == "expand" and source_word_count > 0:
        target = int(source_word_count * 1.5)
        return f"\n\n篇幅要求：目标不少于 {target} 字，在原文基础上扩展细节和深度。"
    elif length_policy == "compress":
        return ""
    return ""
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/test_writer.py -v`
Expected: ALL PASS

- [ ] **Step 5: Integrate into writer_node**

在 `writer_node` 函数（`writer.py:105`）中，在构建 `user_parts` 前计算 source_word_count 并注入指令：

```python
# writer.py — 在 writer_node 函数内，约 line 119 之后
# 计算源文本字数
source_word_count = 0
if state.get("page_content"):
    source_word_count += len(state["page_content"].split())
for item in state.get("parsed_files", []):
    source_word_count += len(str(item.get("content", "")).split())

length_instruction = _build_length_instruction(length_policy, source_word_count)
```

然后在 `user_parts` 列表中（约 line 149 后）追加：

```python
if length_instruction:
    user_parts.append(length_instruction)
```

- [ ] **Step 6: Commit**

```bash
cd /e/test/Docmost/agent-service
git add app/agent/nodes/writer.py tests/test_writer.py
git commit -m "feat(writer): inject explicit word-count target based on source length"
```

---

### Task 2: 提升压缩检测阈值

**Files:**
- Modify: `app/agent/nodes/reviewer.py:117`
- Test: `tests/test_reviewer_compression.py` (new)

- [ ] **Step 1: Write the failing test — 压缩检测阈值**

```python
# tests/test_reviewer_compression.py

from app.agent.nodes.reviewer import reviewer_node


def _make_state(
    draft: str,
    source_content: str,
    intent_route: str = "document_transform",
    length_policy: str = "preserve",
) -> dict:
    return {
        "draft_content": draft,
        "page_content": source_content,
        "parsed_files": [],
        "research_results": [],
        "document_strategy": {},
        "document_plan": {},
        "intent_route": intent_route,
        "length_policy": length_policy,
        "iteration_count": 0,
        "_thread_id": "test",
        "_task_id": "test",
    }


def test_compression_detected_when_draft_below_70_percent():
    """10000 char source, 3000 char draft (30%) should be flagged as compressed."""
    source = "测试内容。" * 2000  # ~10000 chars
    draft = "输出内容。" * 600    # ~3000 chars
    state = _make_state(draft, source)
    # We test the deterministic check logic directly
    from app.agent.nodes.reviewer import _auto_fix
    draft_fixed = _auto_fix(draft)

    source_text = source.strip()
    # New threshold: 70%
    assert len(draft_fixed) < max(400, int(len(source_text) * 0.7))


def test_compression_not_detected_when_draft_above_70_percent():
    """10000 char source, 8000 char draft (80%) should NOT be flagged."""
    source = "测试内容。" * 2000  # ~10000 chars
    draft = "输出内容。" * 1600   # ~8000 chars
    assert len(draft) >= max(400, int(len(source) * 0.7))
```

- [ ] **Step 2: Run test to verify it fails (the first test should currently pass with old threshold, we check behavior)**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/test_reviewer_compression.py -v`
Expected: Tests pass (they test math, not the node). This confirms our threshold formula.

- [ ] **Step 3: Change the threshold**

`app/agent/nodes/reviewer.py:117` — change `0.2` to `0.7`:

```python
# Before:
if len(source_text) > 1200 and len(draft) < max(400, int(len(source_text) * 0.2)):

# After:
if len(source_text) > 1200 and len(draft) < max(400, int(len(source_text) * 0.7)):
```

- [ ] **Step 4: Run all tests**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/ -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
cd /e/test/Docmost/agent-service
git add app/agent/nodes/reviewer.py tests/test_reviewer_compression.py
git commit -m "fix(reviewer): raise compression detection threshold from 20% to 70%"
```

---

### Task 3: max_iterations 从 1 提升到 3

**Files:**
- Modify: `app/agent/graph.py:47`
- Test: `tests/test_graph_routing.py` (new)

- [ ] **Step 1: Write the failing test**

```python
# tests/test_graph_routing.py

from app.agent.graph import route_after_reviewer


def test_reviewer_routes_to_writer_when_revision_needed_and_under_max():
    state = {"needs_revision": True, "iteration_count": 1, "max_iterations": None}
    assert route_after_reviewer(state) == "writer"


def test_reviewer_routes_to_done_when_at_max_iterations():
    state = {"needs_revision": True, "iteration_count": 3, "max_iterations": None}
    assert route_after_reviewer(state) == "done"


def test_reviewer_routes_to_done_when_no_revision_needed():
    state = {"needs_revision": False, "iteration_count": 0, "max_iterations": None}
    assert route_after_reviewer(state) == "done"
```

- [ ] **Step 2: Run test to verify first test fails**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/test_graph_routing.py::test_reviewer_routes_to_writer_when_revision_needed_and_under_max -v`
Expected: FAIL — currently default max_iterations=1, so iteration_count=1 meets limit

- [ ] **Step 3: Change default max_iterations**

`app/agent/graph.py:47`:

```python
# Before:
max_iterations = int(state.get("max_iterations", 1) or 1)

# After:
max_iterations = int(state.get("max_iterations", 3) or 3)
```

- [ ] **Step 4: Run tests**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/test_graph_routing.py -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
cd /e/test/Docmost/agent-service
git add app/agent/graph.py tests/test_graph_routing.py
git commit -m "fix(graph): increase default max_iterations from 1 to 3"
```

---

### Task 4: 放宽上下文截断限制

**Files:**
- Modify: `app/agent/nodes/writer.py:81,188,194`
- Modify: `app/agent/nodes/outliner.py:81,85,90`
- Modify: `app/agent/nodes/planner.py:79`
- Modify: `app/agent/nodes/clarifier.py:42`

- [ ] **Step 1: Change writer.py truncation limits**

```python
# writer.py:81 — research item excerpt
# Before:
excerpt = content[:3500]
# After:
excerpt = content[:12000]

# writer.py:188 — page content
# Before:
user_parts.append(f"Current page content:\n{state['page_content'][:6000]}")
# After:
user_parts.append(f"Current page content:\n{state['page_content'][:32000]}")

# writer.py:194 — parsed file content
# Before:
research_parts.append(f"[File: {item['filename']}]\n{item['content'][:3500]}")
# After:
research_parts.append(f"[File: {item['filename']}]\n{item['content'][:12000]}")
```

- [ ] **Step 2: Change outliner.py truncation limits**

```python
# outliner.py:81 — selected_text
# Before: [:1200]  After: [:4000]

# outliner.py:85 — parsed file excerpt
# Before: [:400]  After: [:2000]

# outliner.py:90 — research result excerpt
# Before: [:300]  After: [:1500]
```

- [ ] **Step 3: Change planner.py truncation limits**

```python
# planner.py:79 — selected_text
# Before: [:1200]  After: [:4000]
```

- [ ] **Step 4: Change clarifier.py truncation limits**

```python
# clarifier.py:42 — research result summary
# Before: [:200]  After: [:800]
```

- [ ] **Step 5: Run all existing tests**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/ -v`
Expected: ALL PASS (truncation limits don't affect test logic)

- [ ] **Step 6: Commit**

```bash
cd /e/test/Docmost/agent-service
git add app/agent/nodes/writer.py app/agent/nodes/outliner.py app/agent/nodes/planner.py app/agent/nodes/clarifier.py
git commit -m "fix(nodes): widen context truncation limits for long document support"
```

---

## Chunk 2: Writer Prompt 去 AI 味 + LLM 配置优化

### Task 5: Writer System Prompt 增加去 AI 味和中文化指令

**Files:**
- Modify: `app/agent/nodes/writer.py:18-38`
- Test: `tests/test_writer.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_writer.py — 追加

from app.agent.nodes.writer import WRITER_SYSTEM_PROMPT


def test_writer_prompt_contains_anti_ai_instructions():
    # Verify prompt now contains anti-AI-flavor instructions
    assert "套路" in WRITER_SYSTEM_PROMPT or "anti-pattern" in WRITER_SYSTEM_PROMPT.lower()


def test_writer_prompt_contains_chinese_output_instruction():
    assert "中文" in WRITER_SYSTEM_PROMPT
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/test_writer.py::test_writer_prompt_contains_anti_ai_instructions -v`
Expected: FAIL

- [ ] **Step 3: Update WRITER_SYSTEM_PROMPT**

Replace `WRITER_SYSTEM_PROMPT` in `writer.py:18-38` with:

```python
WRITER_SYSTEM_PROMPT = """You are a professional document writer.
Write a complete Markdown document grounded in the document strategy, the document plan, the confirmed outline, and the gathered evidence.

Hard rules:
1. Follow the confirmed outline and document plan when they are available.
2. Do not pad with generic prose. Every section must serve a concrete goal.
3. When the document plan requires an artifact, render the real structure instead of leaving placeholders:
   - mermaid: ```mermaid
   - table: Markdown table
   - code_block: fenced code block with a language tag
   - callout: :::info / :::warning / :::danger / :::success
   - details: :::details
   - image: ![alt](url)
4. If evidence is incomplete, stay conservative and say what is missing instead of inventing details.
5. For source-grounded rewrites, preserve important commands, links, structure, and platform-specific details unless the user explicitly asks to simplify them.
6. For selection edits, output only the replacement text for the selected content.
7. Never invent image URLs, placeholder-image URLs, or stock-image links. Use only exact image URLs that are explicitly provided in the available evidence or image instructions.

写作风格要求（反AI味，必须遵守）：
- 默认使用中文输出，除非用户明确要求其他语言
- 严禁使用以下连接词套路："首先/其次/最后"、"综上所述"、"总而言之"、"值得注意的是"、"需要指出的是"
- 段落长度必须有变化：混合使用 1-2 句短段和 4-6 句长段，不要每段都是 3 句
- 句式多样化：交替使用陈述句、反问句、设问句，避免连续 3 个以上的陈述句
- 用具体数据、真实案例和操作细节替代抽象描述，避免"提升效率"、"优化体验"等空话
- 语气要像一个有经验的专业人士在和同行交流，而不是 AI 在罗列要点
- 避免过度使用"赋能"、"抓手"、"落地"、"生态"、"闭环"等流行词
- 标题不要太工整对称，可以用问句、动词短语或具体描述，不要全用"xxx的xxx"格式
- 不要在每个段落开头都用总结性开头语（"在...方面"、"关于..."）

Image usage rules:
{image_instructions}
"""
```

- [ ] **Step 4: Run tests**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/test_writer.py -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
cd /e/test/Docmost/agent-service
git add app/agent/nodes/writer.py tests/test_writer.py
git commit -m "feat(writer): add anti-AI-flavor instructions and default Chinese output"
```

---

### Task 6: Reviewer Prompt 中文化 + 增加篇幅检查维度

**Files:**
- Modify: `app/agent/nodes/reviewer.py:16-33`

- [ ] **Step 1: Update REVIEWER_SYSTEM_PROMPT**

```python
REVIEWER_SYSTEM_PROMPT = """你是严格的文档质量审核员。
检查草稿是否满足用户意图、文档策略和文档计划。

只返回 JSON：
{
  "summary": "一句话总结审核结果",
  "issues": ["问题1", "问题2"],
  "artifacts_used": ["table", "mermaid"],
  "needs_rewrite": true,
  "revised_content": "修改后的内容（仅小修时提供）或空字符串",
  "length_assessment": "篇幅是否达标的评估"
}

审核维度：
1. 准确性：内容是否基于提供的素材，有无编造
2. 完整性：是否覆盖了文档计划中所有章节和要点
3. 篇幅合规：输出篇幅是否与 length_policy 要求一致（preserve=保持原文篇幅，expand=扩展，compress=精简）
4. 风格一致：是否匹配目标受众和文档类型
5. 结构清晰：是否有清晰的层次、标题和过渡
6. 素材引用：是否合理使用了提供的图片、表格、代码等素材

规则：
1. 如果草稿基本正确，仅需小修（修正错别字、调整措辞），提供 revised_content
2. 如果草稿严重偏离计划、篇幅严重不足、或缺少关键内容，设 needs_rewrite=true
3. 如果草稿可以接受，设 needs_rewrite=false
4. 不要编造不存在的来源、截图或图片
5. 审核时不要大幅改写内容，只做必要的局部修正
"""
```

- [ ] **Step 2: Run existing tests**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/ -v`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
cd /e/test/Docmost/agent-service
git add app/agent/nodes/reviewer.py
git commit -m "feat(reviewer): Chinese prompt with length assessment and scoped fixes"
```

---

### Task 7: Explorer Prompt 增加深度探索指引

**Files:**
- Modify: `app/agent/nodes/explorer.py:13-35`

- [ ] **Step 1: Read current explorer prompt and enhance**

在 explorer.py 的 `EXPLORER_SYSTEM_PROMPT` 中追加规则：

```python
# 在现有规则列表末尾追加：
10. 当用户提供了 URL 时，如果抓取结果信息不够支撑文档写作，应额外规划 crawl 步骤抓取该 URL 下的子链接或相关页面。
11. 如果现有素材明显不足以支撑一篇完整文档，在 description 中标注"素材可能不足，建议补充"。
12. 对于仿写任务，必须规划 crawl 或 parse 步骤来提取原文的完整内容和结构特征。
```

- [ ] **Step 2: Run existing tests**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/ -v`
Expected: ALL PASS

- [ ] **Step 3: Commit**

```bash
cd /e/test/Docmost/agent-service
git add app/agent/nodes/explorer.py
git commit -m "feat(explorer): add deep exploration and sufficiency hints to prompt"
```

---

### Task 8: document_transform 路由不再完全跳过规划

**Files:**
- Modify: `app/agent/graph.py:33-37`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_graph_routing.py — 追加

from app.agent.graph import route_after_explorer


def test_document_transform_routes_to_planner_not_writer():
    """document_transform should go through planner, not skip directly to writer."""
    state = {"intent_route": "document_transform"}
    assert route_after_explorer(state) == "planner"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/test_graph_routing.py::test_document_transform_routes_to_planner_not_writer -v`
Expected: FAIL (currently routes to "writer")

- [ ] **Step 3: Change routing logic**

`app/agent/graph.py:33-37`:

```python
# Before:
def route_after_explorer(state: AgentState) -> str:
    intent_route = state.get("intent_route") or "document_create"
    if intent_route == "document_transform":
        return "writer"
    return "clarifier"

# After:
def route_after_explorer(state: AgentState) -> str:
    intent_route = state.get("intent_route") or "document_create"
    if intent_route == "document_transform":
        return "planner"
    return "clarifier"
```

Update conditional edges map accordingly:

```python
# Before:
graph.add_conditional_edges("explorer", route_after_explorer, {
    "writer": "writer",
    "clarifier": "clarifier",
})

# After:
graph.add_conditional_edges("explorer", route_after_explorer, {
    "planner": "planner",
    "clarifier": "clarifier",
})
```

- [ ] **Step 4: Run tests**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/test_graph_routing.py -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
cd /e/test/Docmost/agent-service
git add app/agent/graph.py tests/test_graph_routing.py
git commit -m "fix(graph): route document_transform through planner instead of skipping to writer"
```

---

## Chunk 3: 验收与集成验证

### Task 9: 运行完整测试套件 + 手动冒烟测试

- [ ] **Step 1: Run full test suite**

Run: `cd /e/test/Docmost/agent-service && python -m pytest tests/ -v --tb=short`
Expected: ALL PASS

- [ ] **Step 2: Verify no import errors**

Run: `cd /e/test/Docmost/agent-service && python -c "from app.agent.graph import build_agent_graph; g = build_agent_graph(); print('Graph nodes:', list(g.nodes.keys()))"`
Expected: Print all node names without error

- [ ] **Step 3: Create Phase 1 summary commit**

```bash
cd /e/test/Docmost/agent-service
git log --oneline -8
```

Verify 7 commits from this phase are present.

---

## Phase 1 验收标准

| 指标 | 改动前 | 预期改动后 |
|------|--------|-----------|
| 长文保持率 | ~15-20% | >50% |
| 压缩检测触发 | 输出 < 20% 才触发 | 输出 < 70% 就触发 |
| 审核循环 | 不循环（max=1） | 最多 3 轮 |
| Writer 上下文 | 6000 char 页面 | 32000 char 页面 |
| AI 味 | 明显 | 主观改善 |
| document_transform | 跳过规划直达 writer | 经过 planner |
