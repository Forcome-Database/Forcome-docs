# AI Creator 优化设计方案

> 日期：2026-03-04
> 状态：已批准
> 方案：B'（LangGraph中断+检查指针）

## 一、背景与目标

### 当前问题

1. **缺乏分阶段产物**：AI 一步直出完整正文，用户无法在大纲阶段纠偏方向
2. **修订 = 追加**：新内容追加到旧内容后面，导致文档堆叠混乱
3. **图文分离**：图片未按位置嵌入正文，文字一套、图片一套
4. **Agent 编排死板**：无调研→澄清→方案的自主规划流程，用户无法介入

### 优化目标

构建 **5 阶段智能创作工作流**：

```
用户输入需求
    ↓
① 探索调研 — Agent 自主搜索/解析/爬取
    ↓
② 澄清问题 — Agent 基于调研结果向用户提问（可跳过）
    ↓
③ 方案提议 — Agent 提供 2-3 个写作方向（可跳过）
    ↓
④ 大纲审批 — 用户确认/编辑/对话调整大纲（必经）
    ↓
⑤ 正文生成 — 流式图文融合写入编辑器
    ↓
⑥ 修订 — 用户选中段落 → AI 精确替换
```

## 二、技术方案：LangGraph中断+Checkpointer

### 2.1 为什么选择此方案

| 对比项 | 方案 A（渐进改造） | 方案 B（多端点） | **方案B'（中断）** |
|--------|-------------------|-----------------|------------------------|
| 阶段分离 | SSE 断开再连 | 多个独立端点 | **单图+中断暂停** |
| 状态管理 | 前端传递上下文 | Redis/DB 手动管理 | **LangGraph 检查点** |
| 会话恢复 | 前端拼装 | 手动查状态 | **thread_id自动恢复** |
| 端点数量 | 1 个（多次调用） | 5+ 个 | **1个+简历** |
| 改动量 | 中 | 大 | **中** |
| 标准程度 | 非标 | 手动实现 | **LangGraph 官方推荐范式** |

### 2.2 LangGraph拓扑

```
入口
 ↓
Explorer（自主调研：搜索/解析/爬取）
 ↓ SSE 推送步骤进度
Clarifier（生成澄清问题）
 ↓ interrupt("clarify") → 等待用户回答 → resume
Proposer（提出 2-3 个方案）
 ↓ interrupt("propose") → 等待用户选方案 → resume
Outliner（生成结构化大纲）
 ↓ interrupt("outline") → 等待用户确认/编辑 → resume
Writer（基于大纲+素材，流式生成图文正文）
 ↓
Reviewer（质量审查）
 ↓ should_continue()
 ├─ needs_revision → 回到 Writer（带修订反馈，最多 3 次）
 └─ approved → END
```

### 2.3 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 资源管理器是否中断 | 否 | 自动执行，SSE 推进度即可 |
| 澄清剂 是否必经 | 否 | LLM 判断需求明确时跳过 |
| 提案人是否必经 | 否 | 简单请求跳过 |
| 大纲是否必经 | **是** | 所有请求都经过大纲确认 |
| 修订回到哪个节点 | 作家 | 不重新调研/出大纲 |
| Checkpointer存储 | PostgreSQL | 复用现有数据库 |

### 2.4 AgentState 扩展

```python
class AgentState(TypedDict):
    # === 用户输入 ===
    user_message: str
    conversation_history: list[dict]
    uploaded_files: list[dict]
    template_id: str | None

    # === 页面上下文 ===
    page_id: str | None
    page_title: str | None
    page_content: str | None
    selected_text: str | None
    selection_range: dict | None
    insert_mode: str  # "create" | "overwrite" | "replace" | "append"

    # === 调研结果 ===
    plan: list[PlanStep]
    research_results: list[dict]
    parsed_files: list[dict]       # 含 image_urls + context 映射
    generated_images: list[dict]

    # === 新增：阶段产物 ===
    clarify_questions: list[str]   # Clarifier 生成的问题
    user_answers: dict             # 用户回答
    proposals: list[dict]          # Proposer 生成的方案
    selected_proposal: dict        # 用户选择的方案
    outline: str                   # Outliner 生成的大纲
    confirmed_outline: str         # 用户确认/编辑后的大纲

    # === 输出 ===
    draft_content: str
    final_content: str

    # === 控制 ===
    phase: str                     # 当前阶段标识
    needs_revision: bool
    revision_feedback: str
    iteration_count: int
    max_iterations: int            # 默认 3
    _task_id: str
    _thread_id: str                # 新增：会话 ID
```

### 2.5 中断实际例子

```python
from langgraph.types import interrupt, Command

async def clarifier_node(state: AgentState) -> dict:
    tid = state["_task_id"]
    llm = get_chat_model()

    # LLM 判断是否需要澄清
    needs_clarify = await llm.ainvoke([
        SystemMessage("判断用户需求是否足够明确..."),
        HumanMessage(f"需求: {state['user_message']}\n调研结果摘要: ...")
    ])

    if "不需要澄清" in needs_clarify.content:
        return {"phase": "proposer"}  # 跳过

    # 生成澄清问题
    questions = await llm.ainvoke([...])

    # 通过 SSE 推送 await_input 事件
    await emit(tid, {
        "type": "await_input",
        "phase": "clarify",
        "questions": questions_list
    })

    # interrupt：图暂停，等待 resume
    user_answers = interrupt({
        "type": "clarify",
        "questions": questions_list
    })

    return {
        "user_answers": user_answers,
        "phase": "proposer"
    }
```

### 2.6 API 端点设计

```python
# 首次启动 Agent
@app.post("/agent/run")
async def run_agent(request: AgentRunRequest):
    thread_id = request.thread_id or str(uuid7())
    config = {"configurable": {"thread_id": thread_id}}
    # ... 初始化状态，启动图，返回 SSE

# 恢复 Agent（用户回答后）
@app.post("/agent/resume")
async def resume_agent(request: AgentResumeRequest):
    config = {"configurable": {"thread_id": request.thread_id}}
    # resume 时传入用户输入
    result = await graph.ainvoke(
        Command(resume=request.resume_value),
        config
    )
    # ... 返回 SSE
```

## 三、前端交互设计

### 3.1 气泡消息类型

| 消息类型 | 数据结构 | UI 形态 |
|---------|---------|--------|
| `user` | `{content, selectionContext?}` | 右对齐紫色气泡（现有） |
| `assistant` | `{content}` | 左对齐灰色气泡（现有） |
| `clarify` | `{questions: string[]}` | 问题列表 + 输入框 + 提交按钮 |
| `propose` | `{proposals: [{title, desc}]}` | 方案卡片列表 + 选择按钮 + 反馈输入 |
| `outline` | `{outline: string}` | Markdown 只读渲染 + 「编辑大纲」「确认生成」「重新规划」按钮 |
| `agent_steps` | `{steps: StepInfo[]}` | 步骤进度条（现有，增强） |

### 3.2 大纲气泡交互

```
┌──────────────────────────────────────┐
│ AI 气泡（大纲 — 默认只读）            │
│                                      │
│  ## 1. 背景与目标                     │
│  ## 2. 技术方案分析                   │
│     ### 2.1 方案概述                  │
│     ### 2.2 性能对比                  │
│  ## 3. 实施计划                       │
│  ## 4. 风险与应对                     │
│                                      │
│  [✏️ 编辑大纲] [✅ 确认生成] [🔄 重新规划] │
└──────────────────────────────────────┘

       ↓ 点击「编辑大纲」

┌──────────────────────────────────────┐
│ AI 气泡（大纲 — 编辑模式）            │
│  ┌──────────────────────────────┐    │
│  │ ## 1. 背景与目标              │    │
│  │ ## 2. 技术方案分析            │ ← textarea
│  │ ## 3. 成本估算（新增）        │    用户直接
│  │ ## 4. 实施计划                │    增删改文字
│  │ ## 5. 风险与应对              │    │
│  └──────────────────────────────┘    │
│  [✅ 确认生成] [❌ 取消编辑]          │
└──────────────────────────────────────┘
```

用户也可以不点编辑按钮，直接在输入框中打字反馈（如"增加成本分析"），AI 会重新生成大纲。

### 3.3 流式写入编辑器

```
生成开始:
  1. 保存编辑器快照（用于取消撤销）
  2. editor.setEditable(false)  // 锁定
  3. 在插入位置添加 CSS 标记（半透明背景 + 边框）

流式中:
  4. 每收到 content chunk:
     a. markdownToHtml(chunk) 或累积后批量转换
     b. editor.chain().focus("end").insertContent(html).run()
     c. 面板气泡同步显示原始 Markdown

生成完成:
  5. 移除 CSS 标记样式
  6. editor.setEditable(true)  // 解锁

取消时:
  7. 回滚到步骤 1 的快照
  8. editor.setEditable(true)  // 解锁
```

**技术要点**：
- Markdown → HTML 的流式转换需要处理不完整的 Markdown（如半截代码块）
- 建议累积到完整段落（遇到 `\n\n`）后再批量插入，避免逐 chunk 插入导致的节点碎片化
- 快照使用 `editor.getJSON()` 保存，回滚使用 `editor.commands.setContent(snapshot)`

### 3.4 insertMode 重构

```typescript
// 当前逻辑（有问题）
const shouldAppend = pageHasContent && !selection;
const insertMode = shouldAppend ? "append" : selection ? "replace" : "create";

// 改进逻辑
function determineInsertMode(
  pageHasContent: boolean,
  hasSelection: boolean,
  userIntent: string  // 从用户输入中推断
): InsertMode {
  if (hasSelection) return "replace";       // 有选区 → 替换选区
  if (!pageHasContent) return "create";     // 空页面 → 创建
  if (isContinueIntent(userIntent)) return "append";  // "续写/接着写" → 追加
  return "overwrite";                       // 默认 → 替换整页
}

function isContinueIntent(text: string): boolean {
  const keywords = ["续写", "接着写", "继续写", "追加", "下一章", "下一节"];
  return keywords.some(k => text.includes(k));
}
```

### 3.5 普通模式大纲支持

普通模式（非 Agent）也走大纲流程，但更轻量：

```
第一次 SSE 调用:
  system prompt: "仅输出结构化大纲，不要写正文"
  → 返回大纲 Markdown
  → 前端展示大纲气泡（复用 Agent 的 outline 组件）
  → 用户确认/编辑/反馈

第二次 SSE 调用:
  system prompt: "基于以下大纲生成完整正文" + 确认的大纲
  → 流式生成正文
  → 写入编辑器
```

## 四、图文融合设计

### 4.1 图片上下文映射

Researcher 解析文件时，为每张图片记录原始位置上下文：

```python
# parsed_files 中的 image_urls 扩展
image_urls = [
    {
        "index": 0,
        "url": "/api/files/xxx/doc-img-0.png",
        "desc": "系统架构图",
        "context": "出现在第 2 节「架构设计」之后",   # 新增
        "page_ref": "第 5 页",                       # 新增
        "surrounding_text": "如图所示，系统由三个核心模块组成..."  # 新增
    }
]
```

### 4.2 Writer（Executor）提示改进

```
图片上下文映射（请在对应位置插入）：

图 1: ![系统架构图](/api/files/xxx/doc-img-0.png)
  原始位置: 第 2 节「架构设计」之后（源文件第 5 页）
  上下文: "如图所示，系统由三个核心模块组成..."

图 2: ![性能对比](/api/files/xxx/doc-img-1.png)
  原始位置: 第 4 节「测试结果」中间
  上下文: "新旧方案的性能基准测试结果如下..."

插入规则：
1. 必须在对应章节位置插入 ![desc](url)
2. 每张图片引用恰好使用一次
3. 图片前后应有解释性文字
4. 无对应位置的图片放在最相关段落之后
5. 没有合适的图片时，AI 可以调用图片搜索/生成工具
```

### 4.3 图片转换管线

```
Agent/普通模式生成的 Markdown
    ↓
markdownToHtml()  (@docmost/editor-ext)
    ↓ 需验证：![desc](url) → <img src="url" alt="desc">
editor.chain().insertContent(html)
    ↓ TipTap 解析 <img> 为 Image 节点
编辑器中显示（可缩放/拖拽/对齐）
```

**验证要点**：
- `markdownToHtml` 是否正确处理图片语法
- 图片 URL（`/api/files/xxx`）是否被正确保留
- TipTap Image 扩展的 `parseHTML` 是否正确识别

**如果验证失败的降级方案**：在 `markdownToHtml` 之前，用正则预处理图片引用：
```typescript
function preprocessImages(md: string): string {
  return md.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    '<img src="$2" alt="$1" />'
  );
}
```

### 4.4 空图片兜底

```python
def _strip_empty_images(md: str) -> str:
    # 空 URL → 斜体描述
    md = re.sub(r'!\[([^\]]*)\]\(\s*\)', r'> *\1*', md)
    # 占位符 URL → 斜体描述
    md = re.sub(r'!\[([^\]]*)\]\(IMAGE_PLACEHOLDER[^)]*\)', r'> *\1*', md)
    # 非法本地路径 → 斜体描述
    md = re.sub(r'!\[([^\]]*)\]\((?!https?://|/api/)[^)]*\)', r'> *\1*', md)
    return md
```

## 五、SSE 事件协议完整定义

### 5.1 现有事件（保留）

```json
{"type": "step_start",  "step": "string", "description": "string"}
{"type": "step_done",   "step": "string", "result_summary": "string"}
{"type": "content",     "chunk": "string"}
{"type": "image",       "url": "string", "alt": "string"}
{"type": "error",       "message": "string"}
{"type": "done",        "final_content": "string", "insert_mode": "string"}
```

### 5.2 新增事件

```json
// Agent 请求用户输入（interrupt 时发送）
{
  "type": "await_input",
  "phase": "clarify" | "propose" | "outline",
  "data": {
    // phase=clarify 时
    "questions": ["string"],
    // phase=propose 时
    "proposals": [{"title": "string", "description": "string"}],
    // phase=outline 时
    "outline": "markdown string"
  }
}

// Agent 会话元信息（首次返回）
{
  "type": "session",
  "thread_id": "string"
}
```

### 5.3 前端 resume 请求

```typescript
POST /api/agent/resume
{
  "thread_id": "xxx",
  "resume_value": {
    // phase=clarify 时
    "answers": "用户回答文本",
    // phase=propose 时
    "selected_proposal": 0,  // 索引
    "feedback": "可选的额外反馈",
    // phase=outline 时
    "confirmed_outline": "用户编辑后的大纲 markdown",
    "action": "confirm" | "regenerate"  // 确认或重新规划
  }
}
```

## 六、改造文件清单

### Python Agent Service（核心~12文件）

| 文件 | 操作 | 说明 |
|------|------|------|
| `app/agent/graph.py` | 重写 | 6 节点+中断+检查指针 |
| `app/agent/state.py` | 修改 | 扩展代理状态 |
| `app/agent/nodes/planner.py` | 重命名为 `explorer.py` | 调研节点 |
| `app/agent/nodes/clarifier.py` | 新增 | 阐明问题+中断 |
| `app/agent/nodes/proposer.py` | 新增 | 方案建议+打断 |
| `app/agent/nodes/outliner.py` | 新增 | 大纲生成+中断 |
| `app/agent/nodes/executor.py` | 重命名为 `writer.py` | 提示改进 |
| `app/agent/nodes/reviewer.py` | 修改 | 修订只回 Writer |
| `app/main.py` | 修改 | 新增 `/agent/resume` 端点 |
| `app/schemas/request.py` | 修改 | 新增thread_id、resume |
| `app/schemas/response.py` | 修改 | 新增await_input事件 |
| `pyproject.toml` | 修改 | 新增检查点依赖 |

### NestJS 网关（~4 文件）

| 文件 | 操作 | 说明 |
|------|------|------|
| `agent-gateway.controller.ts` | 修改 | 新增 resume 路由 |
| `agent-gateway.service.ts` | 修改 | 提交thread_id |
| `dto/agent-run.dto.ts` | 修改 | 新增字段 |
| `ai.controller.ts` | 修改 | 普通模式大纲两阶段 |

### 前端（~11 文件）

| 文件 | 操作 | 说明 |
|------|------|------|
| `ai-creator-atoms.ts` | 修改 | 新增threadId、相原子 |
| `ai-creator.types.ts` | 修改 | 新增消息类型 |
| `ai-creator-message-item.tsx` | 修改 | 分发新气泡类型 |
| `ai-creator-outline-bubble.tsx` | 新增 | 大纲气泡组件 |
| `ai-creator-clarify-bubble.tsx` | 新增 | 澄清问题气泡 |
| `ai-creator-propose-bubble.tsx` | 新增 | 方案选择气泡 |
| `ai-creator-input.tsx` | 修改 | insertMode 重构 + 流式读写 |
| `ai-creator-panel.tsx` | 修改 | 编辑器锁定/解锁 |
| `hooks/use-agent.ts` | 修改 | 恢复+等待输入处理 |
| `services/agent-service.ts` | 修改 | 新增resumeAgent API |
| `ai-creator.module.css` | 修改 | 新气泡样式 + 锁定样式 |

## 七、验收标准

### P0（必须达成）

- [ ] Agent 模式完整 5 阶段流程：探索→澄清→方案→大纲→正文
- [ ] 每个 interrupt 点 UI 交互正常（澄清问题/方案选择/大纲编辑）
- [ ] Clarifier 和 Proposer 可智能跳过
- [ ] 大纲在气泡中可查看/可编辑（textarea）/可对话调整
- [ ] 修订时默认覆盖，不再自动追加
- [ ] 选中文本→AI修改→精确替换选区
- [ ] PDF/Word 提取的图片正确嵌入正文（标准 TipTap image 节点）
- [ ] 图片上下文映射使 LLM 在合理位置插入图片
- [ ] 全部 9 个工具可用，AI 自主判断何时用图

### P1（次优先）

- [ ] 流式内容实时写入编辑器 + 面板同步
- [ ] 编辑器生成中锁定 + 标记样式
- [ ] 取消生成时自动撤销已写入内容
- [ ] 普通模式也支持大纲流程（两阶段 SSE）

## 八、技术风险与缓解

| 风险 | 影响 | 缓解方案 |
|------|------|---------|
| LangGraph 中断与 SSE 流式的兼容性 | 中断后SSE需要正确结束 | 中断前先发出await_input事件，SSE正常结束；resume时开新SSE |
| Checkpointer 存储大量调研数据 | PostgreSQL 存储压力 | 限制research_results大小，定期清理过期线程 |
| Markdown 流式转 HTML 的不完整片段 | 编辑器节点碎片化 | 累积到完整段落（`\n\n`）后批量插入 |
| markdownToHtml 对图片的支持 | 图片可能不被正确转换 | 验证后若有问题，用正则预处理图片引用 |
| 编辑器锁定期间的协作冲突 | 多人协作时锁定影响其他用户 | 锁定仅影响当前用户的编辑器实例，Yjs 协作层不受影响 |
