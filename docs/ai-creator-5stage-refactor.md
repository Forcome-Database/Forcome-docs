# AI Creator 5 阶段智能工作流重构记录

> 日期：2026-03-04
> 状态：已完成
> 设计文档：docs/plans/2026-03-04-ai-creator-optimization-design.md
> 实施计划：docs/plans/2026-03-04-ai-creator-implementation-plan.md

## 一、重构背景与目标

### 核心问题

1. **缺乏分阶段产物**：AI 一步直出完整正文，用户无法在大纲阶段纠偏方向，产出结果难以预期
2. **修订 = 追加**：新内容追加到旧内容后面，导致文档堆叠混乱，用户需要手动清理
3. **图文分离**：图片未按位置嵌入正文，文字一套、图片一套，排版割裂
4. **Agent 编排死板**：无调研-澄清-方案的自主规划流程，用户无法在中间环节介入

### 优化目标

构建 **5 阶段智能创作工作流**，使用户可以在每个关键节点进行审批和修改：

```
用户输入需求
  → ① 探索调研（Agent 自主搜索/解析/爬取）
  → ② 澄清问题（Agent 向用户提问，可智能跳过）
  → ③ 方案提议（Agent 提供 2-3 个写作方向，可智能跳过）
  → ④ 大纲审批（用户确认/编辑/对话调整大纲，必经）
  → ⑤ 正文生成（流式图文融合写入编辑器）
  → ⑥ 修订（Reviewer 自动审查，最多 3 次迭代）
```

## 二、技术方案

### 为什么选择 LangGraph interrupt + Checkpointer

评估了三种方案后，选择 **方案 B'（LangGraph interrupt + AsyncPostgresSaver）**：

| 对比项 | 方案 A（渐进改造） | 方案 B（多端点） | **方案 B'（interrupt）** |
|--------|-------------------|-----------------|------------------------|
| 阶段分离 | SSE 断开再连 | 多个独立端点 | **单图 + interrupt 暂停** |
| 状态管理 | 前端传递上下文 | Redis/DB 手动管理 | **LangGraph Checkpointer 自动持久化** |
| 会话恢复 | 前端拼装 | 手动查状态 | **thread_id 自动恢复** |
| 端点数量 | 1 个（多次调用） | 5+ 个 | **1 个 run + 1 个 resume** |
| 标准程度 | 非标 | 手动实现 | **LangGraph 官方推荐 human-in-the-loop 范式** |

核心优势：LangGraph 的 `interrupt()` 原语使图在任意节点暂停并将完整状态持久化到 PostgreSQL，前端 resume 时自动恢复上下文，避免手动传递大量中间状态。复用 Docmost 现有的 PostgreSQL 实例，无额外基础设施。

## 三、架构变更

### 3.1 Agent 图拓扑（旧 → 新对比）

**旧架构（4 节点线性链）**：

```
Planner → Researcher → Executor → Reviewer → (loop or END)
```

**新架构（6 节点 + 3 个 interrupt 点 + 条件边）**：

```
Explorer → Clarifier → Proposer → Outliner → Writer → Reviewer
  (自动)    (interrupt)  (interrupt)  (interrupt)  (流式)   (条件边)
              可跳过       可跳过       必经              ↓
                                                  needs_revision?
                                                  ├─ yes → Writer
                                                  └─ no → END
```

关键变更：
- `Planner + Researcher` 合并为 `Explorer`（调研计划 + 执行一体化）
- `Executor` 重命名为 `Writer`（基于确认大纲生成，非自由发挥）
- 新增 `Clarifier`、`Proposer`、`Outliner` 三个 human-in-the-loop 节点
- Outliner 支持循环：用户点击"重新规划"时通过条件边回到自身

### 3.2 新增 interrupt 人工介入点

| 节点 | interrupt 行为 | 是否必经 | 跳过条件 |
|------|---------------|---------|---------|
| Clarifier | `interrupt({"type": "clarify", "questions": [...]})` | 否 | LLM 判断需求已明确 |
| Proposer | `interrupt({"type": "propose", "proposals": [...]})` | 否 | 简单请求或已选模板 |
| Outliner | `interrupt({"type": "outline", "outline": "..."})` | **是** | 无（所有请求都经过大纲确认） |

interrupt 发生时，图暂停并抛出 `GraphInterrupt` 异常，SSE 流正常结束。前端收到 `await_input` 事件后渲染交互型气泡，用户操作后调用 `POST /agent/resume` 传入 `Command(resume=用户输入)`，图从暂停点恢复执行。

### 3.3 SSE 事件协议扩展

**保留的现有事件**：`step_start`、`step_done`、`content`、`image`、`error`、`done`

**新增事件**：

```json
// 首次连接时返回会话标识
{"type": "session", "thread_id": "uuid"}

// interrupt 时通知前端等待用户输入
{
  "type": "await_input",
  "phase": "clarify" | "propose" | "outline",
  "data": {
    "questions": ["..."],        // phase=clarify
    "proposals": [{"title", "description"}],  // phase=propose
    "outline": "markdown string"  // phase=outline
  }
}
```

## 四、新建/修改文件清单

### Python Agent Service（15 文件）

| 文件路径 | 操作 | 说明 |
|---------|------|------|
| `agent-service/app/agent/state.py` | 修改 | 扩展 AgentState：新增 `clarify_questions`、`user_answers`、`proposals`、`selected_proposal`、`outline`、`confirmed_outline`、`phase`、`_thread_id` 等字段 |
| `agent-service/app/agent/graph.py` | 重写 | 6 节点 StateGraph + `should_continue` / `should_regenerate_outline` 条件边 + 入口 explorer |
| `agent-service/app/agent/nodes/explorer.py` | 新增（替代 planner.py + researcher.py） | 合并调研计划和执行，新增图片上下文映射（`context`/`page_ref`/`surrounding_text`） |
| `agent-service/app/agent/nodes/clarifier.py` | 新增 | LLM 判断是否需要澄清 → 生成问题列表 → `interrupt()` 等待用户回答 |
| `agent-service/app/agent/nodes/proposer.py` | 新增 | LLM 生成 2-3 个写作方向 → `interrupt()` 等待用户选择 |
| `agent-service/app/agent/nodes/outliner.py` | 新增 | 基于素材和方案生成 Markdown 大纲 → `interrupt()`（必经） → 支持 confirm/regenerate |
| `agent-service/app/agent/nodes/writer.py` | 新增（替代 executor.py） | 基于 `confirmed_outline` 结构化生成 + 图片上下文映射插入指令 + `_strip_empty_images` 兜底 |
| `agent-service/app/agent/nodes/reviewer.py` | 修改 | 修订只回 Writer（不回 Explorer/Outliner），审查标准新增大纲一致性检查 |
| `agent-service/app/agent/nodes/planner.py` | 删除 | 逻辑合并到 explorer.py |
| `agent-service/app/agent/nodes/executor.py` | 删除 | 逻辑重构到 writer.py |
| `agent-service/app/main.py` | 重写 | lifespan 初始化 `AsyncConnectionPool` + `AsyncPostgresSaver`；新增 `POST /agent/resume` 端点；`GraphInterrupt` 异常捕获；首条 SSE 返回 `session` 事件 |
| `agent-service/app/schemas/request.py` | 修改 | `AgentRunRequest` 新增 `thread_id`；新增 `AgentResumeRequest`（`thread_id` + `resume_value`） |
| `agent-service/app/schemas/response.py` | 修改 | 新增 `AwaitInputEvent`、`SessionEvent` 类型 |
| `agent-service/app/config.py` | 修改 | 新增 `database_url` 字段，供 LangGraph Checkpointer 连接 PostgreSQL |
| `agent-service/pyproject.toml` | 修改 | 新增 `langgraph-checkpoint-postgres>=2.0`、`psycopg[binary]>=3.1`、`psycopg-pool>=3.1` |

### NestJS 网关（3 文件）

| 文件路径 | 操作 | 说明 |
|---------|------|------|
| `apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts` | 修改 | 新增 `POST resume` 路由，使用 `http.request` 代理 SSE 到 Agent `/agent/resume` |
| `apps/server/src/ee/ai/agent-gateway/dto/agent-resume.dto.ts` | 新增 | `AgentResumeDto`：`threadId: string` + `resumeValue: Record<string, any>` |
| `apps/server/src/ee/ai/ai.controller.ts` | 修改 | 普通模式两阶段 SSE 支持：第一次仅生成大纲，第二次基于确认大纲生成正文 |

### 前端 React（12 文件）

| 文件路径 | 操作 | 说明 |
|---------|------|------|
| `apps/client/src/ee/ai/components/ai-creator/ai-creator.types.ts` | 修改 | 新增 `clarify`、`propose`、`outline` 消息类型 + `questions`/`proposals`/`outline` 字段 |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-atoms.ts` | 修改 | 新增 `threadIdAtom`、`phaseAtom` Jotai 原子 |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-clarify-bubble.tsx` | 新增 | 澄清问题气泡：问题列表 + Textarea 输入 + 提交按钮 |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-propose-bubble.tsx` | 新增 | 方案选择气泡：Card 列表点选 + 可选反馈 Textarea + 确认按钮 |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-outline-bubble.tsx` | 新增 | 大纲气泡：Markdown 只读渲染（隔离 `new Marked()` 实例）+ 编辑/确认/重新规划三按钮 |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.tsx` | 修改 | 消息分发：根据 `message.type` 渲染对应的交互型气泡组件 |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-input.tsx` | 修改 | insertMode 重构：默认 overwrite，仅"续写/接着写"等关键词时 append |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx` | 修改 | 流式写入编辑器：生成中锁定 `editor.setEditable(false)` + CSS 标记 + 完成后解锁 |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-utils.ts` | 修改 | 新增 `isContinueIntent()` 关键词匹配工具函数 |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator.module.css` | 修改 | 新增交互型气泡样式 + 编辑器锁定样式（半透明背景 + 边框标记） |
| `apps/client/src/ee/ai/hooks/use-agent.ts` | 修改 | 处理 `session` 事件存 `threadId`；处理 `await_input` 事件分发气泡消息；新增 `resumeAgent` 调用逻辑 |
| `apps/client/src/ee/ai/services/agent-service.ts` | 修改 | 新增 `resumeAgent(threadId, resumeValue)` API 方法 |

## 五、关键实现细节

### 5.1 LangGraph interrupt + Checkpointer

使用 `langgraph-checkpoint-postgres` 的 `AsyncPostgresSaver` 将图状态持久化到 PostgreSQL。在 FastAPI lifespan 中初始化 `AsyncConnectionPool` 连接池并调用 `checkpointer.setup()` 创建所需表。图通过 `agent_graph_builder.compile(checkpointer=_checkpointer)` 编译。

interrupt 流程：
1. 节点调用 `interrupt(payload)` → 图暂停 → 抛出 `GraphInterrupt`
2. `run_graph()` 捕获 `GraphInterrupt`，不作为错误处理（await_input 已在节点内通过 `emit()` 发送）
3. 前端收到 `await_input` 后渲染交互组件，用户操作后调用 `POST /agent/resume`
4. Resume 端点执行 `_compiled_graph.ainvoke(Command(resume=value), config)`，图从暂停点继续

每个 SSE 连接的首条消息返回 `{"type": "session", "thread_id": "..."}` 供前端存储。

### 5.2 图片上下文映射

Explorer 节点在解析文件时，为每张图片记录原始位置上下文：

```python
image_urls.append({
    "index": img["index"],
    "url": "/api/files/xxx/doc-img-0.png",
    "desc": "系统架构图",
    "context": "出现在第 2 节「架构设计」之后",       # 位置
    "page_ref": "第 5 页",                           # 来源页码
    "surrounding_text": "如图所示，系统由三个核心模块组成..."  # 上下文
})
```

Writer 节点将这些映射注入 system prompt，指示 LLM 在对应章节位置插入 `![desc](url)`，并配合 `_strip_empty_images()` 兜底过滤空 URL、占位符 URL、非法本地路径的图片引用。

### 5.3 insertMode 重构（默认 overwrite）

旧逻辑：页面有内容且无选区时自动 append，导致修订堆叠。

新逻辑：

```typescript
function determineInsertMode(pageHasContent, hasSelection, userIntent):
  if (hasSelection) return "replace";       // 有选区 → 替换选区
  if (!pageHasContent) return "create";     // 空页面 → 创建
  if (isContinueIntent(userIntent)) return "append";  // "续写/接着写" → 追加
  return "overwrite";                       // 默认 → 替换整页
```

`isContinueIntent()` 匹配"续写"、"接着写"、"继续写"、"追加"、"下一章"、"下一节"等关键词。

### 5.4 流式写入编辑器

正文生成阶段，content chunk 通过 SSE 实时推送到前端：

1. **生成开始**：保存编辑器快照 `editor.getJSON()`，锁定 `editor.setEditable(false)`，添加 CSS 标记
2. **流式中**：累积到完整段落（遇到 `\n\n`）后批量 `markdownToHtml()` → `editor.chain().insertContent(html)`，避免逐 chunk 插入导致的节点碎片化
3. **生成完成**：移除 CSS 标记，解锁 `editor.setEditable(true)`
4. **取消时**：回滚到步骤 1 的快照 `editor.commands.setContent(snapshot)`，解锁编辑器

### 5.5 前端交互型气泡组件

三种新增气泡组件均接收 `onResume(value)` 回调，触发 `POST /api/agent/resume`：

- **ClarifyBubble**：渲染编号问题列表 + Textarea + 提交按钮。用户回答后发送 `{ answers: "..." }`
- **ProposeBubble**：渲染 Mantine Card 列表，点选高亮 + 可选反馈输入。发送 `{ selected_proposal: index, feedback?: "..." }`
- **OutlineBubble**：使用隔离的 `new Marked()` 实例渲染 Markdown（避免污染全局 marked），支持只读/编辑两种模式切换。三个操作按钮：编辑大纲（切换 Textarea）、确认生成（`{ action: "confirm", confirmed_outline: "..." }`）、重新规划（`{ action: "regenerate" }`）

## 六、踩坑记录

### 6.1 psycopg_pool 依赖缺失

**现象**：Agent 服务启动时报 `ModuleNotFoundError: No module named 'psycopg_pool'`。

**原因**：`langgraph-checkpoint-postgres` 依赖 `psycopg` 用于异步 PostgreSQL 通信，但它的连接池功能由独立包 `psycopg-pool` 提供，而 `psycopg[binary]` 并不自动安装 pool 模块。我们在 `main.py` 中使用了 `AsyncConnectionPool`，但 `pyproject.toml` 中未声明 `psycopg-pool`。

**解决方案**：在 `pyproject.toml` 的 `dependencies` 中添加 `"psycopg-pool>=3.1"`，重新安装依赖。

```toml
"psycopg[binary]>=3.1",
"psycopg-pool>=3.1",
```

### 6.2 DATABASE_URL 中 `?schema=public` 参数不兼容

**现象**：`AsyncConnectionPool` 初始化时报 `invalid URI query parameter: "schema"`。

**原因**：Docmost 主服务（Kysely）的 `DATABASE_URL` 通常带有 `?schema=public` 查询参数用于指定 PostgreSQL schema。但 `psycopg` v3 的 `conninfo` 解析器不支持自定义查询参数，只接受 libpq 标准参数（如 `sslmode`），非标参数会导致连接失败。

**解决方案**：在 `main.py` 的 lifespan 中，用 `split("?")[0]` 去除查询参数后再传给连接池：

```python
db_url = settings.database_url.split("?")[0]
_pool = AsyncConnectionPool(conninfo=db_url, open=False)
```

### 6.3 Windows ProactorEventLoop 与 psycopg async 不兼容

**现象**：Windows 上 Agent 服务启动后，第一次调用 `AsyncConnectionPool.open()` 或 Checkpointer 操作时抛出 `NotImplementedError` 或 `RuntimeError: Event loop is closed`。

**原因**：Python 3.8+ 在 Windows 上默认使用 `ProactorEventLoop`，但 `psycopg` 的异步实现基于 `libpq` 的文件描述符轮询机制（`add_reader`/`add_writer`），ProactorEventLoop 不支持这些操作。这是 psycopg 官方已知的 Windows 兼容性问题。

**解决方案**：在 `main.py` 模块顶部、所有 import 之前（确保在事件循环创建前生效），强制使用 `SelectorEventLoop`：

```python
import asyncio
import sys

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
```

## 七、验收标准达成情况

### P0（必须达成）

- [x] Agent 模式完整 5 阶段流程：探索 → 澄清 → 方案 → 大纲 → 正文
- [x] 每个 interrupt 点 UI 交互正常（澄清问题/方案选择/大纲编辑）
- [x] Clarifier 和 Proposer 可智能跳过（LLM 判断需求已明确时返回跳过标记）
- [x] 大纲在气泡中可查看/可编辑（Textarea）/可对话调整
- [x] 修订时默认 overwrite，不再自动 append
- [x] 选中文本 → AI 修改 → 精确替换选区（insertMode = "replace"）
- [x] PDF/Word 提取的图片正确嵌入正文（图片上下文映射 + 空图片兜底）
- [x] 图片上下文映射使 LLM 在合理位置插入图片
- [x] 全部 9 个工具可用（tavily_search, firecrawl_scrape, docling_parser, nanobana_imggen, image_annotate, vlm_understand, docmost_page_read, docmost_rag, docmost_upload）

### P1（次优先）

- [x] 流式内容实时写入编辑器 + 面板同步
- [x] 编辑器生成中锁定 + CSS 标记样式
- [x] 取消生成时自动撤销已写入内容（快照回滚）
- [x] 普通模式也支持大纲流程（两阶段 SSE：先生成大纲 → 确认后生成正文）

## 八、提交记录

以下是本次重构的完整 git 提交记录（从旧到新）：

| 提交 | 说明 |
|------|------|
| `5de6c7d` | docs: AI Creator 优化设计方案（LangGraph interrupt + 5阶段智能工作流） |
| `2269145` | docs: AI Creator implementation plan - 20 tasks across 8 phases |
| `00cc258` | feat(agent): extend AgentState with phase artifacts, add resume request and await_input event |
| `90d3c6f` | feat(agent): add langgraph-checkpoint-postgres dependency |
| `77b38b8` | feat(agent): create explorer node (merges planner + researcher), add image context mapping |
| `a1fa456` | feat(agent): add clarifier node with LangGraph interrupt for human-in-the-loop |
| `97daef6` | feat(agent): add proposer node with interrupt for writing approach selection |
| `c83e3ba` | feat(agent): add outliner node with mandatory interrupt for outline approval |
| `2c4799a` | feat(agent): rebuild LangGraph with 6 nodes, interrupt points, and conditional edges |
| `bcdd08d` | feat(agent): create writer node with outline-driven generation and image context mapping |
| `d1c3deb` | feat(agent): rebuild main.py with Checkpointer, resume endpoint, and session management |
| `9d3afaf` | feat(frontend): extend message types with clarify/propose/outline, add threadId atom |
| `2bfcae1` | feat(gateway): add /agent/resume route and AgentResumeDto |
| `a82cd0c` | feat(frontend): add resumeAgent API and await_input handling in useAgent hook |
| `b52e2fb` | feat(frontend): add outline bubble component with edit/confirm/regenerate |
| `48125fc` | feat(frontend): add clarify and propose bubble components |
| `9d7eccf` | fix(frontend): refactor insertMode — default to overwrite, append only on explicit continue intent |
| `6e292ac` | feat(frontend): dispatch clarify/propose/outline message types to new bubble components |
| `0a24100` | fix(frontend): ensure markdownToHtml correctly converts image syntax to TipTap image nodes |
| `8a2a3da` | feat(server): add two-phase SSE for normal mode outline support |
| `5bcf6e4` | feat(frontend): implement streaming content into editor with lock/unlock/rollback |
| `23566ed` | fix(agent): add missing psycopg-pool dependency |
| `2a95c17` | fix(agent): strip ?schema= query param from DATABASE_URL for psycopg compatibility |
| `0906110` | fix(agent): set WindowsSelectorEventLoopPolicy for psycopg async on Windows |

共 24 个提交，涉及 33 个文件，新增 ~3700 行、删除 ~240 行。
