# AI Creator v2 — 用户反馈问题清单（供交叉验证）

## 背景

AI Creator v2 从 PydanticAI 架构重构后，用户反馈以下问题。已在本轮实施中修复，需要交叉验证修复是否正确完整。

---

## 用户原话汇总

### 顶层问题

1. **v1 能力丢失**：v1 LangGraph Agent 的图片生成、文档仿写、反 AI 味写作等能力在 v2 中完全丢失
2. **设计未对齐**：Phase 0-5 设计文档中的 L2/L3 流程与实际实现严重偏离
3. **关键 bug**：finalize 崩溃（已修）、交互超时、评审修复流程断裂

**核心架构问题**：v1 用单一 Writer 接收全部上下文（用户指令+完整文档+研究结果+图片），v2 拆分为章节级独立写作，每个 SectionWriter 丢失了用户原始请求、系统提示词、完整素材等关键上下文。

---

### P0 — 流程崩溃/卡死

**A1**: `wait_for_response()` 无超时，前端断开时 orchestrator 永远卡死
- 文件: `agent-service/app/orchestrator/tools/user_interaction.py`
- 修复要求: `wait_for_response(thread_id, timeout=600)` 添加 `asyncio.wait_for` 包装；`engine.py` 中所有 `wait_for_response` 调用增加 try/except，超时时 emit error 事件并 cleanup

**A2**: `evaluate_with_llm()` 返回的 issue `section_id=None`，导致修复时无法定位章节
- 文件: `agent-service/app/workers/evaluator.py`
- 修复要求: LLM prompt 中要求返回 `section_title`（而非 section_id，因为 LLM 不知道 ID）；解析时通过 `section_title` 在 `blueprint.sections` 中查找对应的 `section.id`；找不到则标记为全局 issue（`section_id=None`）

**A3**: `nanobana_imggen.invoke()` 和 `docmost_upload.invoke()` 是 LangChain Tool 的同步方法，不能直接在 async 函数中调用
- 文件: `agent-service/app/workers/section_writer.py` → `generate_section_visuals()`
- 修复要求: 用 `asyncio.get_event_loop().run_in_executor(None, tool.invoke, args)` 包装；添加 try/except：工具不可用时 graceful skip（emit warning 事件，不崩溃）

---

### P1 — 设计未对齐 & v1 能力丢失

**B1**: `_execute_level3()` 从未调用 `research_tool()`
- 文件: `agent-service/app/orchestrator/engine.py` → `_execute_level3()`
- 设计文档要求: Phase 3 L3 Flow Step 2: "If research is needed (topic requires facts/data), call research tool"
- 修复要求: 在 parse_assets 之后、generate_brief 之前插入研究步骤；触发条件：无上传文件（asset_map 为空或无 text 类型素材）

**B2**: `ask_user` 事件格式错误（`"brief": ...` 而非 `"data": ...`）且无 `wait_for_response()`；写作用 `simple_edit`，完全不知道上传文档内容（asset_map 未传入）；Blueprint 生成了但写作步骤没用
- 文件: `agent-service/app/orchestrator/engine.py` → `_execute_level2()`
- 修复要求: L2 按设计应该没有 Blueprint 阶段，只有 Brief → 单次写作；Brief 事件改为 `"type": "await_input", "phase": "brief", "data": brief.model_dump()`；添加 `wait_for_response()` 等待用户确认 Brief；写作步骤改为将 asset_map 完整内容注入到 `simple_edit` 的 prompt 中

**B3**: v1 Writer 有但 v2 丢失的关键上下文：1. `user_message` — 用户原始请求（v2 的 SectionWriter 从不知道用户要求什么！）2. `system_prompt` — 工作区系统提示词 3. `template_prompt` — 模板提示词 4. `intent_route` — 创作意图（create/transform/edit）
- 文件: `agent-service/app/workers/section_writer.py`, `agent-service/app/orchestrator/tools/write_tools.py`, `agent-service/app/orchestrator/engine.py`
- 修复要求: `write_section()` 签名增加这四个参数，`build_section_context()` 同步增加，`write_tools.py` 和 `engine.py` 全链路传递

**B4**: v1 有的反 AI 味写作规则在 v2 中完全丢失，需恢复:
```
- 默认使用中文输出，除非用户明确要求其他语言
- 严禁使用："首先/其次/最后"、"综上所述"、"值得注意的是"
- 段落长度有变化：混合短段（1-2句）和长段（4-6句）
- 句式多样化：交替使用陈述句、反问句、设问句
- 用具体数据、案例和操作细节替代抽象描述
- 语气像有经验的专业人士交流，不是 AI 罗列要点
- 避免"赋能"、"抓手"、"落地"等流行词
- 标题可以用问句、动词短语，不要全用"xxx的xxx"格式
```
- 文件: `agent-service/app/workers/section_writer.py` → `SECTION_WRITER_SYSTEM`，以及 `agent-service/app/orchestrator/tools/simple_edit.py` 的系统 prompt

**B5**: v1 有的源文档保留模式（仿写/改排版能力）在 v2 丢失。当 `intent_route == "document_transform"` 时，Writer 收到特别指令："Treat every gathered source as primary material"、"Keep platform-specific details, commands, and links intact"、自动检查输出长度不低于源文档的 70%
- 文件: `agent-service/app/workers/section_writer.py`, `agent-service/app/orchestrator/tools/simple_edit.py`
- 修复要求: `build_section_context()` 和 L2 `simple_edit` prompt 中，当 `intent_route == "document_transform"` 时添加源保留指令

**B6**: 只在 `wc < budget * 0.8` 时重试，超标（如 2x）不管
- 文件: `agent-service/app/workers/section_writer.py` → `write_section()`
- 修复要求: 增加超标重试条件 `wc > budget * 1.3 and attempt < max_retries`；max_retries 从 1 增加到 2

**B7**: Blueprint 有 `title` 字段但最终输出从未包含 H1 标题
- 文件: `agent-service/app/orchestrator/engine.py`, `agent-service/app/orchestrator/tools/finalize.py`
- 修复要求: `_execute_level3()` 在 merged_sections 列表开头插入文档标题 `{"title": blueprint.title, "level": 1, "content": ""}`

**B8**: auto_fix 修所有 auto_fixable 问题（忽略用户选择），无修复反馈事件
- 文件: `agent-service/app/orchestrator/tools/fix_tools.py`
- 修复要求: auto_fix 只对 `selected_issue_ids` 中的 auto_fixable 问题执行；每修一个 issue 后 emit `{"type": "step_done", "step": "fix_issue", "result_summary": "Fixed: {issue.description[:60]}"}`

**B9**: `run_consistency_checks()` 返回 issues 但从未合并到 review_report
- 文件: `agent-service/app/orchestrator/engine.py`
- 修复要求: consistency_issues 转换为 ReviewIssue 格式，合并到 `review_report.issues`，更新 `review_report.user_decision_needed`

---

## 修改文件清单

| 文件 | 涉及问题 |
|------|----------|
| `agent-service/app/orchestrator/engine.py` | A1, B1, B2, B3, B7, B9 |
| `agent-service/app/workers/section_writer.py` | A3, B3, B4, B5, B6 |
| `agent-service/app/orchestrator/tools/simple_edit.py` | B2, B4, B5 |
| `agent-service/app/orchestrator/tools/user_interaction.py` | A1 |
| `agent-service/app/workers/evaluator.py` | A2 |
| `agent-service/app/orchestrator/tools/fix_tools.py` | B8 |
| `agent-service/app/orchestrator/tools/finalize.py` | B7 |
| `agent-service/app/orchestrator/tools/write_tools.py` | B3 |

## 验证要点

对每个问题，验证：
1. 修复是否存在于对应文件中
2. 修复逻辑是否与"修复要求"一致
3. 是否引入新的 bug（如参数缺失、导入遗漏、逻辑矛盾）
4. 全链路参数传递是否完整（特别是 B3 的四个参数从 engine → write_tools → section_writer）
