# AI Creator v3 — 完全重构设计文档

> **日期**: 2026-03-20
> **状态**: 设计已确认，待实施
> **优先级**: 文档优化 > 划词改写 > 从零创作
> **技术栈**：PydanticAI（保留）、Mantine 8、TipTap 3 / ProseMirror、MineRU

---

## 1. 背景与问题

### 1.1 当前系统经历了 5 个迭代阶段

| 阶段 | 时间 | 内容 | 遗留问题 |
|------|------|------|----------|
| V1 | 02-26 | 三模式切换（创建/编辑/聊天） | 模式切换混乱 |
| UI 重构 | 02-27 | 统一对话 + 可调面板 + hljs | Mermaid不渲染 |
| 五阶段 | 03-04 | 探索者→澄清者→提议者→大纲→作家 | 流程过重 |
| 深度分析 | 03-14 | 发现 13 个 P0/P1 bug | SectionWriter 上下文丢失 |
| V2PydanticAI | 03-14+ | Orchestrator 引擎 + Workers | 多数 bug 未修复 |

### 1.2 用户反馈的 5 个核心问题

1. **UI 界面错乱** — 3 列工作台（文档树+实时草稿+活动日志）+3 个弹窗（Brief/Blueprint/Review），信息过载
2. **分章节写作不连贯** —SectionWriter 独立写每章，取消 user_message/system_prompt/template_prompt，章节间仅 500 字尾部衔接；PDF/DOC 优化时图文错乱
3. **对话与文档衔接差** — 对话历史和文档操作指令混在同一个 Activity Log 里
4. **划词改写冲突** — 选中文本通过 `buildPrompt()` 注入到普通对话流中，与历史消息混杂
5. **重新优化丢失内容** — overwrite 模式直接清空编辑器，无快照/版本回滚

### 1.3 根因分析

| 问题 | 架构根因 |
|------|---------|
| UI 错乱 | 把 AI 当成与编辑器并列的「工作台」，而非服务文档的「工具」 |
| 章节不连贯 | 分章节独立写作（SectionWriter）设计，源于「从零创作」优先的假设 |
| 对话衔接差 | 用「聊天/对话」范式处理「文档操作」场景，范式不匹配 |
| 划词冲突 | ai-menu 与 ai-creator 共享状态（atoms、对话历史） |
| 内容丢失 | 无操作前快照，overwrite 模式不可逆 |

---

## 2. 设计哲学

### 2.1 核心原则

> **AI应该作用于文档（在文档上进行操作），而不是与文档并列（在文档旁边）。**

- **文档为主角**：编辑器始终占主要空间，AI 面板可折叠
- **命令取代对话**：用户给 AI 下指令，不与 AI 聊天
- **通道隔离**：划词改写与文档操作完全独立，互不干扰
- **内容安全优先**：任何 AI 操作前自动保存快照，支持一键恢复

### 2.2 参考架构

基于 Anthropic《Building effective AI Agents》的模式架构：

| 场景 | Claude 架构模式 | 应用方式 |
|------|----------------|---------|
| 划词改写 | 增强型 LLM | 单次 LLM 调用，最简模式 |
| 文档优化 | 路由 → 提示链 | 按复杂度路由，解析→分析→改写顺序链 |
| 从零创作 | 提示链 | 可选 Brief → 生成全文 |

关键指导：*“从简单开始。只有在更简单的方法失败时才增加复杂性。”*

### 2.3 业界参考

| 工具 | 借鉴的模式 |
|------|-----------|
| BlockNote | Fork-and-Merge — AI 在文档副本上操作，原文不变直到用户接受 |
| TipTap 人工智能工具包 | 选择锁定、工具调用式编辑 |
| Novel.sh | 极简 在两个按钮下方替换/插入 |
| Word Copilot | 保留/重新生成/丢弃/微调四步审阅 |
| Notion AI | 内联触发，无持久面板，文档始终为主角 |

---

## 3. 整体架构

### 3.1 三通道路由

```
用户操作
    ↓
┌───────────────────────────────────────────┐
│        Intent Router（确定性，非 LLM）       │
│                                            │
│  有选区？──────→ Channel A: 划词改写         │
│  有文档/上传？──→ Channel B: 文档优化         │
│  空白页？───────→ Channel C: 从零创作         │
└───────────────────────────────────────────┘
    ↓                  ↓                  ↓
 Layer 1           Layer 1/2          Layer 2
 单次 LLM           按复杂度路由       Prompt Chain
 调用               返回变更摘要        流式写入
    ↓                  ↓                  ↓
 浮动面板          审阅面板 + Undo     编辑器直接写入
 (ai-menu)        (ReviewSidebar)
```

### 3.2 三通道对比

| 维度 | A: 划词改写 | B: 文档优化 | C: 从零创作 |
|------|-----------|-----------|-----------|
| **触发** | 选中文字 → 气泡菜单 | 命令面板按钮/输入 | 命令面板输入（空白页） |
| **API** | `POST /api/ai/generate/stream` | `POST /api/ai/document/optimize` | `POST /api/ai/document/create` |
| **后端处理** | 单次 LLM 调用 | 解析 → 生成 → 变更摘要 | 解析 → [Brief] → 生成 |
| **前端渲染** | ai-menu 浮窗 | 审阅面板 + Undo | 流式写入编辑器 |
| **内容安全** | 仅替换选区 | 快照+撤消 | 空白页，无需保护 |
| **图片处理** | 不涉及 | Prompt 约束 + 摘要验证 | MineRU 提取 + CDN 重新托管 |
| **对话历史** | 无 | 无（操作记录） | 无（操作记录） |

### 3.3 两层后端架构

```
Layer 1: Augmented LLM（直接调用）
├── 划词改写 → 单次 LLM 调用，返回替换文本
├── 简单指令（翻译、缩写、语气调整）→ 单次调用
└── 生成摘要 → 单次调用

Layer 2: Prompt Chaining（顺序链）
├── 文档优化 → 解析文档 → 构建 Prompt → 生成 → 变更摘要
├── 从零创作 → [可选 Brief] → 生成全文
└── 复杂改写（含上传文件）→ 解析 → 分析 → 改写
```

### 3.4 保留与砍掉的基础设施

**保留不动**：
- MineRU 解析管道：`mineru_client.py` + `mineru_parser.py` + `asset_parser.py`
- 图片转发：`source_image_store.py` → Docmost CDN URL
- LLM 工厂：`llm_factory.py`（PydanticAI 多模型）
- 模板系统：三层覆盖（系统 → 工作区 → 用户）
- NestJS 网关：`http.request` SSE 代理（非 fetch）
- SSE 事件协议：`asyncio.Queue` 侧信道推送
- 现有 ai-menu：编辑器内联 AI 菜单（11+ 预定义 action）

**砍掉**：
- `SectionWriter` — 不再分章节独立写作
- `create_blueprint.py` — 不需要章节规划
- `BlueprintModal` / `ReviewModal` / `SmartBriefCard` — 过度设计
- `evaluate.py` / `fix_tools.py` — 审阅由用户在编辑器完成
- `DocumentTreePanel` / `LiveDraftPanel` — 无章节树和独立预览
- 对话历史堆积 — 改为操作记录
- `consistency_checker.py` / `fixer.py` / `section_revision.py`

---

## 4. 前端架构

### 4.1 组件结构

```
apps/client/src/ee/ai/components/
├── ai-command-panel/              ← 右侧命令面板（日常编辑态）
│   ├── AiCommandPanel.tsx         ← 主容器（Mantine Paper）
│   ├── QuickActions.tsx           ← 6 宫格快捷按钮（文档级操作）
│   ├── RecentOps.tsx              ← 最近操作记录列表
│   └── CommandInput.tsx           ← 底部输入框 + 工具栏
│
├── ai-review-sidebar/             ← 审阅面板（文档优化后）
│   ├── ReviewSidebar.tsx          ← v1: 变更摘要 + 接受/撤销/重新优化
│   ├── ChangeList.tsx             ← v2: 变更条目列表（逐条 Accept/Reject）
│   └── ImagePreservationBadge.tsx ← 图片保留状态指示
│
├── ai-review/                     ← v2: Inline Diff 渲染
│   └── DiffDecorationPlugin.ts   ← ProseMirror decoration plugin
│
├── editor/ai-menu/                ← 现有（重构，非新建）
│   ├── ai-menu.tsx               ← 解耦：移除对 ai-creator atoms 的依赖
│   ├── command-items.ts          ← 保留：11+ 预定义 action
│   ├── command-selector.tsx      ← 保留
│   └── result-preview.tsx        ← 保留
│
└── shared/
    ├── AiStatusIndicator.tsx      ← 生成中/完成/错误状态指示
    └── BriefConfirmCard.tsx       ← 从零创作的 Brief 确认卡片（简化版）
```

### 4.2 三态 UI 设计

**状态 1：日常编辑态**
- 编辑器占主空间（~65%），右侧 AI 命令面板（300px，可折叠）
- 命令面板含：快捷操作网格 + 最近操作记录 + 输入框
- 风格完全遵循 Docmost 现有 Mantine 配色（`#6366f1` 主色、`light-dark()` 主题切换）

**状态 2：审阅态（文档优化后）**
- 右侧面板切换为审阅面板（ReviewSidebar）
- v1：变更摘要（修改数、图片保留率）+ 接受/撤销/重新优化按钮
- v2：变更列表（可点击跳转）+编辑器内嵌差异装饰

**状态 3：划词改写态**
- 现有 ai-menu 浮窗独立弹出
- 与右侧命令面板完全无状态关联
- 操作完成后写入 recentOps（命令面板可见）

### 4.3 状态管理

**佐泰原子（4 个）**：

```typescript
aiCreatorFilesAtom: atom<File[]>([])                   // 上传文件
aiCreatorTemplateAtom: atom<string | null>(null)       // 选中模板
aiPanelModeAtom: atom<'command' | 'review' | 'hidden'>('command')  // 面板状态
aiSelectionPopoverAtom: atom<SelectionState | null>(null)  // 选区状态（ai-menu 用）
```

**会话状态（Reducer）**：

```typescript
interface AiSessionState {
  status: 'idle' | 'running' | 'completed' | 'error'
  panelMode: 'command' | 'review'

  // 文档优化
  pendingChanges: BlockChange[] | null   // v2: 结构化变更列表
  changeSummary: ChangeSummary | null    // 变更摘要统计
  snapshot: EditorSnapshot | null        // 操作前快照

  // 从零创作
  streamingContent: string | null
  brief: CreationBrief | null

  // 通用
  recentOps: RecentOp[]
  error: string | null
}
```

### 4.4 挂钩

```typescript
useAiCommand()        // 命令面板：submit, cancel, recentOps, snapshot 管理
useAiReview()         // 审阅模式：acceptAll, rejectAll, acceptChange(id), rejectChange(id), apply
useAiStream()         // 通用 SSE 流处理（供以上 hook 内部使用）
// 现有 ai-menu 保留自己的独立 hook（不引用以上 hook）
```

### 4.5 快捷操作 vs ai-menu 的区分

| 维度 | ai-menu（选区级） | QuickActions（文档级） |
|------|-----------------|---------------------|
| 触发 | 选中文字 → 气泡菜单 | 命令面板按钮 |
| 作用范围 | 选中的文字 | 整个文档 |
| 应用程序编程接口 | `POST /api/ai/generate/stream`（现有） | `POST /api/ai/document/optimize`（新） |
| 结果呈现 | ai-menu 内预览 + 替换/插入 | 编辑器内替换 + 审阅面板 |
| 状态 | 独立（与命令面板无关） | 命令面板管理 |

---

## 5. 后端架构

### 5.1 OrchestratorEngine 重构

现有 `engine.py`（1235 行）→ 重构为两个入口函数（~400 行）：

```python
class OrchestratorEngine:

    async def handle_simple(self, request: SimpleRequest) -> AsyncIterator[SSEEvent]:
        """Layer 1: 单次 LLM 调用
        适用：划词改写、翻译、缩写、扩写、语气调整、生成摘要
        """
        prompt = build_prompt(request.action, request.content, request.instruction)
        async for chunk in llm.stream(prompt, system=request.system_prompt):
            yield SSEEvent(type="content", chunk=chunk)
        yield SSEEvent(type="done")

    async def handle_document(self, request: DocumentRequest) -> AsyncIterator[SSEEvent]:
        """Layer 2: Prompt Chaining
        适用：文档优化、从零创作
        """
        # Step 1: 解析上传文件（如有）
        asset_map = None
        if request.files:
            yield SSEEvent(type="step_start", step="parsing")
            asset_map = await parse_assets(request.files, request.page_id)
            yield SSEEvent(type="step_done", step="parsing")

        # Step 2: 可选 Brief（仅从零创作 + 深度模式）
        brief = None
        if request.need_brief:
            brief = await generate_brief(request, asset_map)
            yield SSEEvent(type="await_input", phase="brief", data=brief)
            brief = await wait_for_confirmation(timeout=300)

        # Step 3: LLM 流式生成
        yield SSEEvent(type="step_start", step="generating")
        context = build_document_context(request, asset_map, brief)
        full_content = ""
        async for chunk in llm.stream(context.prompt, system=context.system_prompt):
            full_content += chunk
            yield SSEEvent(type="content", chunk=chunk)
        yield SSEEvent(type="step_done", step="generating")

        # Step 4: 变更摘要 / 结构化 diff
        if request.original_content:
            summary = generate_change_summary(request.original_content, full_content, asset_map)
            yield SSEEvent(type="change_summary", data=summary)

            # v2: 结构化变更列表
            if request.diff_mode and request.editor_json:
                changes = compute_block_changes(
                    request.original_content, full_content, request.editor_json
                )
                yield SSEEvent(type="block_changes", data=changes)

        yield SSEEvent(type="done", content=full_content)
```

### 5.2 API 端点

```
保留（不变）:
POST /api/ai/generate/stream       ← Layer 1: 选区级操作（ai-menu）

新增:
POST /api/ai/document/optimize     ← Layer 2: 文档优化
POST /api/ai/document/create       ← Layer 2: 从零创作

简化:
POST /api/agent/resume             ← 仅用于 Brief 确认（从零创作）
POST /api/agent/stop               ← 保留，简化

废弃（Phase 5 移除）:
POST /api/agent/run                ← 被新端点取代
```

### 5.3 NestJS 端点定义

```typescript
// DocumentOptimizeDto
{
  pageId: string
  instruction: string              // 用户指令
  files?: FilePayload[]            // 上传文件（可选）
  templateId?: string              // 模板（可选）
  originalContent?: string         // 当前页面 markdown（用于 diff）
  systemPrompt?: string            // 工作区系统提示词
  diffMode?: boolean               // v2: 是否返回结构化变更
  editorJson?: object              // v2: ProseMirror 文档 JSON
}

// DocumentCreateDto
{
  pageId: string
  instruction: string
  files?: FilePayload[]
  templateId?: string
  needBrief?: boolean              // 是否需要 Brief 确认
  systemPrompt?: string
}
```

### 5.4 文档优化 Prompt 策略

```python
DOCUMENT_OPTIMIZE_SYSTEM = """你是一个专业的文档优化助手。

规则：
1. 保留所有图片引用（![desc](url)），不要修改、删除或重新排列图片
2. 保留文档的整体结构（标题层级、列表、表格）
3. 只修改文字内容，优化措辞和表达
4. 如果原文包含 Mermaid 代码块，保持不变
5. 如果原文包含代码块，保持不变（除非用户明确要求修改）
6. 输出完整的优化后文档，不要省略任何部分
7. 不要添加原文没有的图片或图表

{workspace_system_prompt}
{template_prompt}
"""
```

### 5.5 变更摘要生成

```python
def generate_change_summary(original: str, optimized: str, asset_map) -> ChangeSummary:
    """确定性对比，非 LLM"""

    diff = difflib.unified_diff(original.splitlines(), optimized.splitlines(), lineterm='')
    additions = sum(1 for l in diff if l.startswith('+') and not l.startswith('+++'))
    deletions = sum(1 for l in diff if l.startswith('-') and not l.startswith('---'))

    original_images = set(re.findall(r'!\[[^\]]*\]\(([^)]+)\)', original))
    optimized_images = set(re.findall(r'!\[[^\]]*\]\(([^)]+)\)', optimized))

    return ChangeSummary(
        text_changes=additions + deletions,
        images_total=len(original_images),
        images_kept=len(original_images & optimized_images),
        images_lost=list(original_images - optimized_images),
        structure_preserved=_check_heading_structure(original, optimized),
        mermaid_preserved=_check_mermaid_blocks(original, optimized),
    )
```

### 5.6 砍掉的后端代码（~2240 行）

| 文件 | 行数 | 原因 |
|------|------|------|
| `orchestrator/tools/create_blueprint.py` | ~300 | 不再分章节规划 |
| `orchestrator/tools/write_tools.py` | ~275 | 不再分章节写作 |
| `orchestrator/tools/evaluate.py` | ~200 | 审阅由用户在编辑器完成 |
| `orchestrator/tools/fix_tools.py` | ~150 | 不再有自动修复循环 |
| `workers/section_writer.py` | 465 | 不再分章节 |
| `workers/section_revision.py` | ~200 | 不再有修订循环 |
| `workers/evaluator.py` | ~300 | 砍掉 |
| `workers/consistency_checker.py` | ~150 | 砍掉 |
| `workers/fixer.py` | ~200 | 砍掉 |

---

## 6. 内容安全

### 6.1 v1：快照+原子事务+撤消

```typescript
async function submitDocumentOptimize(instruction: string) {
  // ① 保存快照
  const snapshot = {
    bodyJson: editor.getJSON(),
    titleText: titleEditor?.getText(),
    timestamp: Date.now(),
  }

  // ② 锁定编辑器 + 显示进度
  editor.setEditable(false)

  // ③ 流式接收 AI 结果
  await streamSSE('/api/ai/document/optimize', payload, {
    onDone: (fullContent) => {
      // ④ 原子事务替换内容（ProseMirror History 自动记录）
      editor.chain().setContent(markdownToHtml(fullContent)).run()
      editor.setEditable(true)
      // Ctrl+Z 一步回到 snapshot 状态
    },
    onError: () => {
      // ⑤ 出错恢复快照
      editor.commands.setContent(snapshot.bodyJson)
      editor.setEditable(true)
    }
  })
}
```

### 6.2 三层图片保护

```
Layer 1 — Prompt 约束
  系统提示词要求保留所有 ![desc](url) 引用

Layer 2 — 变更摘要验证
  generate_change_summary() 对比原文和优化后的图片 URL 集合
  images_kept < images_total → 审阅面板标红警告

Layer 3 — 用户兜底
  Ctrl+Z 恢复完整的 ProseMirror JSON，100% 无损恢复
```

### 6.3 审阅面板（v1）

```
┌────────────────────────┐
│ 📋 变更摘要            │
│  文字修改: 12 处        │
│  图片状态: 3/3 保留 ✓   │
│  结构保留: ✓            │
│                        │
│ [✅ 接受] [↩️ 撤销]     │
│ [🔄 重新优化]          │
│                        │
│ 💡 也可用 Ctrl+Z 撤销  │
└────────────────────────┘
```

---

## 7. v2：内联差异增强

### 7.1 Diff 引擎（后端）

```python
def compute_block_changes(original_md, optimized_md, editor_json) -> list[BlockChange]:
    old_blocks = split_to_blocks(original_md)
    new_blocks = split_to_blocks(optimized_md)
    aligned = align_blocks(old_blocks, new_blocks)

    changes = []
    for old_block, new_block in aligned:
        if old_block.type in ('image', 'mermaid', 'table'):
            continue  # 图片/图表/表格不参与 diff
        if old_block.text != new_block.text:
            hunks = diff_sentences(old_block.text, new_block.text)
            for hunk in hunks:
                changes.append(BlockChange(
                    id=uuid7(),
                    type='modified',
                    block_type=old_block.type,
                    path=old_block.heading_context,
                    old_text=hunk.old,
                    new_text=hunk.new,
                    doc_position=resolve_position(editor_json, old_block),
                ))
    return changes
```

### 7.2 Diff 粒度规则

| 内容类型 | Diff 粒度 | 处理方式 |
|---------|----------|---------|
| 段落文本 | 句子级 | 按句号/分号/换行切分 |
| 标题 | 整行 | 标题变更作为整体 |
| 列表项 | 项级 | 每个 li 单独对比 |
| 图片 `![](url)` | 跳过 | 不参与 diff |
| Mermaid 代码块 | 跳过 | 不参与 diff |
| 普通代码块 | 整块 | 代码块整体对比 |
| 表格 | 跳过 | 不参与 diff |

### 7.3 DiffDecorationPlugin（前端）

```typescript
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

const diffPluginKey = new PluginKey('aiDiffReview')

interface DiffPluginState {
  changes: BlockChange[]
  decorations: DecorationSet
  resolved: Map<string, 'accepted' | 'rejected'>
}

function createDiffPlugin(changes: BlockChange[]): Plugin {
  return new Plugin({
    key: diffPluginKey,
    state: {
      init(_, editorState) {
        return {
          changes,
          decorations: buildDecorations(editorState.doc, changes),
          resolved: new Map(),
        }
      },
      apply(tr, pluginState, oldState, newState) {
        const meta = tr.getMeta(diffPluginKey)
        if (meta?.type === 'accept') {
          pluginState.resolved.set(meta.changeId, 'accepted')
          return rebuildDecorations(pluginState, newState.doc)
        }
        if (meta?.type === 'reject') {
          pluginState.resolved.set(meta.changeId, 'rejected')
          return rebuildDecorations(pluginState, newState.doc)
        }
        return pluginState
      }
    },
    props: {
      decorations(state) {
        return this.getState(state)?.decorations ?? DecorationSet.empty
      }
    }
  })
}
```

### 7.4 v2 审阅面板

```
┌─────────────────────────┐
│ 🔍 审阅模式              │
│  进度: 8/12 已处理        │
│  ████████░░░░  67%       │
│                          │
│ ┌──────────────────────┐ │
│ │ 变更 #1  ✓ 已接受     │ │
│ │ § 1. 流程定位 > p:1   │ │  ← 点击跳转到编辑器对应位置
│ │ -衔接 +承接           │ │
│ └──────────────────────┘ │
│ ┌──────────────────────┐ │
│ │ 变更 #2  ⏳ 待处理    │ │
│ │ § 2. 核心准则 > p:1   │ │
│ │ -必须严核 +务必严格审核│ │
│ │  [✓ 接受] [✗ 拒绝]    │ │
│ └──────────────────────┘ │
│                          │
│  📷 图片: 3/3 保留 ✓     │
│                          │
│ [✅ 应用已接受的变更]     │
│ [↩️ 全部撤销]            │
└─────────────────────────┘
```

### 7.5 v2 数据流

```
前端提交优化指令 (diffMode: true)
    ↓
后端 handle_document()
    ├── Step 1-3: 同 v1
    ├── Step 4: compute_block_changes() → block_changes[]
    └── emit: block_changes + change_summary
    ↓
前端接收
    ├── 不直接替换内容
    ├── 注册 DiffDecorationPlugin → inline diff 渲染
    ├── 编辑器设为只读
    └── 面板切换为 v2 审阅面板
    ↓
用户逐条 Accept/Reject
    ├── Accept → decoration 消失，新文保留
    └── Reject → 恢复原文
    ↓
点击 [应用已接受的变更]
    ├── 批量应用 accepted/rejected 决策
    ├── 移除 DiffDecorationPlugin
    └── 编辑器恢复可编辑
```

---

## 8. 视觉元素策略

### 8.1 编辑器已有的图表能力

| 图表能力 | 扩展 | 使用方式 |
|---------|------|---------|
| 流程图/时序图/甘特图 | Mermaid 11.12 | 代码块 `lang=mermaid` |
| 自由手绘/白板 | Excalidraw 0.18 | 专用节点 |
| 专业工程图 | Draw.io（react-drawio） | 专用节点 |
| 数据表格 | 自定义表 + 免打扰 | 原生表格 |
| 数学公式 | 凯特克斯 0.16 | `$$..$$` |

### 8.2 AI 生成视觉元素的决策规则

| AI 检测到的内容 | 自动生成为 | 原因 |
|---------------|-----------|------|
| 流程/步骤描述 | Mermaid 流程图代码块 | 可编辑，LLM 生成准确率 >90% |
| 数据对比/列表 | 提示点击表格 HTML | 原生可编辑 |
| 数学表达式 | 凯泰克斯 | 已有渲染器 |
| 源文档截图 | 复用原图（MineRU 提取） | 保真，不重生成 |
| 概念性插图 | 不自动生成 | 用户显式请求时才触发 |

### 8.3 外部探索能力（Web 搜索/抓取）

| 场景 | 是否需要 | 触发方式 |
|------|---------|---------|
| 文档优化 | 不需要 | — |
| 划词改写 | 不需要 | — |
| 从零创作 | 看情况 | 用户显式包含 URL 或使用 `/search` 指令 |

---

## 9. 端到端数据流

### 9.1 频道A：划词改写

```
选中文字 → 气泡菜单 → "Ask AI" → ai-menu 浮窗
    ↓
选择动作（润色/缩写/翻译/自定义）
    ↓
POST /api/ai/generate/stream { action, content, pageId }
    ↓
SSE 流式返回 → result-preview 显示
    ↓
[替换] editor.chain().insertContentAt({from,to}, result).run()
[插入下方] editor.chain().insertContentAt(to+1, result).run()
    ↓
操作记录写入 recentOps
```

### 9.2 渠道 B：文档优化

```
命令面板: [优化全文] / 上传文件 + 指令 / 自定义指令
    ↓
useAiCommand.submitDocumentOptimize()
    ├── 保存 snapshot（editor.getJSON()）
    ├── 锁定编辑器
    └── 面板 → running
    ↓
POST /api/ai/document/optimize (multipart if files)
    ↓
NestJS Gateway → http.request → Agent Service
    ↓
handle_document():
    ├── 解析文件 → AssetMap → 图片 重新托管
    ├── 构建 Prompt（含图片保护规则）
    ├── LLM 流式生成
    └── 变更摘要 / block_changes（v2）
    ↓
前端接收完毕:
    v1: editor.setContent(result) → 面板 → review → 接受/撤销/重新优化
    v2: 注册 DiffDecorationPlugin → 逐条 Accept/Reject → 应用
```

### 9.3 Channel C：从零创作

```
空白页命令面板: 输入指令 + [可选上传文件] + [可选模板]
    ↓
POST /api/ai/document/create
    ↓
handle_document():
    ├── 解析文件（如有）
    ├── [可选] Brief 生成 → await_input → 用户确认
    ├── LLM 流式生成（含 MineRU 图片 URL、Mermaid 代码块）
    └── done
    ↓
前端流式写入编辑器:
    ├── maybeExtractTitle()
    └── 边接收边显示
```

---

## 10. 迁移策略

### 10.1 原则

渐进式替换，不中断现有功能。每一步都保持系统可用。 Feature Flag 控制新旧面板切换。

### 10.2 实施计划

#### 阶段 0: 准备（第 0 周）
- 功能创建路径 `feat/ai-creator-v3`
- 确保现有测试全部通过（基线）

#### 阶段 1: 后端简化（第 1-2 周）
- 新建 `handle_simple()` + `handle_document()` 在 engine.py（与旧 `run()` 并存）
- 新建 NestJS 端点 `POST /api/ai/document/optimize` 和 `/create`
- 文档优化 Prompt 策略（图片保护规则）
- 变更摘要生成（`generate_change_summary`）
- Brief 简化（从零创作用，可选）
- 新端点单元测试

#### 阶段 2: 前端命令面板（第 2-3 周）
- 新建 AiCommandPanel（Mantine 组件）
- 快速操作快捷按钮
- CommandInput 输入框+文件上传
-RecentOps 操作记录
- 使用 AiCommand 钩子
- 快照机制
- ReviewSidebar v1（变更摘要 + 接受/撤销/重新优化）
- 面板模式切换（命令↔查看↔运行）
- 功能标志 `AI_CREATOR_V3` 控制新旧面板

#### 阶段 3: ai-menu 解耦（第 3 周）
- ai-menu 移除对 `aiCreatorSelectionAtom` 的依赖
- ai-menu 移除对 ai-creator 对话历史的读写
- 操作完成后写入 recentOps
- 验证划词改写不再影响命令面板状态

#### 阶段 4: 从零创作（第 3-4 周）
- 命令面板检测空白页 → 调用 `/api/ai/document/create`
- Brief 确认卡片（简化版）
- 流式内容写入编辑器
- 也许提取标题

#### 阶段 5: 清理旧代码（第 4 周）
- 前端删除：ai-creator-panel、messages、DocumentTree、LiveDraft、BlueprintModal、ReviewModal
- 删除：SectionWriter、create_blueprint、evaluate、fix_tools、evaluator、fixer 等
- 保留旧端点空壳返回 410 Gone

#### 阶段 6: v2 Inline Diff（第 5-6 周）
- 后端 `compute_block_changes()` diff 引擎
- 后端 `handle_document()` 增加 `diffMode` 支持
- 前端 `DiffDecorationPlugin`（ProseMirror 装饰）
- 逐条接受/拒绝按钮
- 审阅面板增强：变更列表 + 进度条 + 跳转定位
- 测试：中英文混合、含图片、含 Mermaid

### 10.3 功能标志

```typescript
// .env
AI_CREATOR_V3=true

// PageEditor.tsx
const useV3 = useFeatureFlag('AI_CREATOR_V3')
{useV3 ? <AiCommandPanel /> : <AiCreatorPanel />}
```

### 10.4 回滚方案

- 第1-4阶段：关闭功能标志→返回旧面板
- Phase 5：不执行删除即可
- Phase 6：v2 功能独立，不影响 v1

---

## 11. 完整需求矩阵

| 模块 | v1（1-5期） | v2（第6阶段） |
|------|----------------|---------------|
| AI 命令面板 | ✅ 快捷操作 + 输入框 + 操作记录 | — |
| 文档优化 API | ✅ 整文生成 + 变更摘要 | ✅ + block_changes 包装返回 |
| 内容安全 | ✅ 快照+撤消 | ✅ + 逐条 接受/拒绝 |
| 审阅面板 | ✅ 变更摘要 + 接受/撤销/重新优化 | ✅ + 变更列表 + 进度条 + 跳转 |
| 内联差异 | — | ✅ ProseMirror 装饰插件 |
| 图片保护 | ✅ 提示约束+摘要验证+撤消 | ✅ + Diff 跳过图片块 |
| 划词改写解耦 | ✅ ai-menu 状态隔离 | — |
| 从零创作 | ✅ 流式写入 + 可选 Brief | — |
| Diff 引擎 | — | ✅ 块对齐 + 句子级 diff |
| 视觉元素 | ✅ Mermaid/表格自动识别 | — |

---

## 12. 成功标准

### v1 验收标准
- [ ] 文档优化：上传 PDF → 优化 → 图片全部保留 → 变更摘要正确
- [ ] 文档优化：Ctrl+Z 可一步恢复原文
- [ ] 划词改写：与 AI 命令面板完全独立，无状态冲突
- [ ] 从零创作：流式写入编辑器，标题自动提取
- [ ] UI：命令面板不超过 300px，编辑器占主空间
- [ ] 性能：划词改写 <3s 响应，文档优化 <30s 完成

### v2 验收标准
- [ ] Inline Diff：红删绿增正确显示
- [ ]逐条接受/拒绝功能正常
- [ ] 图片/Mermaid/表格不参与 diff
- [ ] 变更列表点击可跳转到编辑器对应位置
- [ ] 全部接受/全部拒绝批量操作正常

---

## 13. 边界条件与风险处理

> 本节回应 spec review 中发现的关键问题，确保实施时不遗漏。

### 13.1 运行时归属（Critical）

三个通道的代码分别运行在不同的运行时：

| 通道 | 运行时 | API 端点 | 控制器 |
|------|--------|---------|------------|
| A: 划词改写 | **NestJS**（TypeScript，Vercel AI SDK） | `POST /api/ai/generate/stream` | `AiController` |
| B: 文档优化 | **Python 代理服务**（PydanticAI） | `POST /api/ai/document/optimize` | `AiController`（新增，代理到代理服务） |
| C: 从零创作 | **Python 代理服务**（PydanticAI） | `POST /api/ai/document/create` | `AiController`（新增，代理到代理服务） |

- Channel A **保持在 NestJS 中**，直接调用`AiService.generateStream()`，不经过 Python 代理服务。速度最快，无跨进程占用。
- Channel B/C 的新端点添加在 `AiController`（非 `AgentGatewayController`），内部通过 `http.request` SSE 代理到代理服务。
- `handle_simple()` Python 代码仅用于 agent-service 内部简单子任务，**不对外暴露端点**。

### 13.2 Yjs 协作安全（严重）

当前系统使用 Hocuspocus + Yjs 实现实时协作。 `editor.setContent()` 会产生 Yjs update 广播给所有连接的客户端，且 Yjs 的 undo 机制与 ProseMirror History 插件是**独立的**。

**v1 解决方案**：

```typescript
// 使用 Y.UndoManager 而非 ProseMirror History 实现 undo
import * as Y from 'yjs'

function submitDocumentOptimize() {
  const ydoc = editor.state.doc  // Yjs 文档
  const undoManager = new Y.UndoManager(ydoc.getXmlFragment('default'))

  // AI 操作前：标记 undo scope 起点
  undoManager.stopCapturing()

  // AI 替换内容（会被 undoManager 自动追踪）
  editor.chain().setContent(markdownToHtml(result)).run()

  // 撤销时：undoManager.undo() 回到操作前状态
  // 这在协作环境下也是安全的
}
```

**协作锁定**：AI 操作期间，通过 Hocuspocus awareness 广播 `{ aiOperating: true, userId }` 状态，其他客户端显示 "AI 正在优化文档..." 提示并禁止编辑。操作完成后解除锁定。

### 13.3 Markdown 序列化策略（关键）

`DocumentOptimizeDto.originalContent` 需要将 ProseMirror 文档序列化为 markdown。

**策略**：使用 `@docmost/editor-ext` 中已有的 `prosemirrorToMarkdown()`（基于 `prosemirror-markdown` serializer），该序列化器了解 Docmost 所有自定义节点。

**不可序列化的节点处理**：

| 节点类型 | 序列化方式 |
|---------|-----------|
| 文本/标题/列表/引用 | 标准 Markdown |
| 图片 | `![alt](url)` |
| 表格 | HTML`<table>` |
| Mermaid 代码块 | ` ```Mermaid\n...\n``` ` |
| Excalidraw / Draw.io | `<!-- excalidraw:attachmentId -->` 占位符 |
| 嵌入（YouTube 等） | `<!-- embed:url -->` 占位符 |

占位符确保这些非文本内容在 AI 优化过程中被原样保留（LLM 不会修改 HTML 注释）。

### 13.4 MineRU 解析失败处理

```python
async def handle_document(self, request):
    asset_map = None
    if request.files:
        yield SSEEvent(type="step_start", step="parsing")
        try:
            asset_map = await parse_assets(request.files, request.page_id)
            yield SSEEvent(type="step_done", step="parsing",
                           summary=f"解析完成: {asset_map.source_word_count} 字, {len(asset_map.images)} 张图片")
        except Exception as e:
            yield SSEEvent(type="step_error", step="parsing",
                           error=f"文件解析失败: {str(e)}")
            # 降级：不带资产继续，让 LLM 只基于用户指令生成
            # 前端显示警告："文件解析失败，将基于指令直接处理"

    # 继续后续步骤（asset_map 可能为 None）
    ...
```

### 13.5 大文档处理

当文档超过 LLM 上下文窗口时：

```python
MAX_INPUT_TOKENS = 100_000  # 根据模型调整

def build_document_context(request, asset_map, brief):
    content = asset_map.full_text if asset_map else request.original_content
    estimated_tokens = estimate_tokens(content)

    if estimated_tokens > MAX_INPUT_TOKENS:
        # 策略 1：截断到安全范围并告知用户
        content = truncate_to_token_limit(content, MAX_INPUT_TOKENS * 0.8)
        warning = f"文档较大（约 {estimated_tokens} tokens），已截取前 {MAX_INPUT_TOKENS} tokens 进行优化"
        # 前端显示此警告

    # 未来可扩展为分段优化（按章节拆分 → 逐段优化 → 合并）
    ...
```

### 13.6 SSE 流断线恢复

```typescript
// 前端 useAiStream hook

function useAiStream() {
  const HEARTBEAT_TIMEOUT = 30_000  // 30 秒无数据视为断线
  let lastEventTime = Date.now()

  const watchdog = setInterval(() => {
    if (Date.now() - lastEventTime > HEARTBEAT_TIMEOUT) {
      // 断线处理
      clearInterval(watchdog)
      onDisconnect()
    }
  }, 5000)

  // 后端每 10 秒发送 heartbeat
  // SSE event: { type: "heartbeat", timestamp: ... }

  function onDisconnect() {
    // 如果已有部分内容：保留已接收内容，提示用户
    // 如果无内容：恢复 snapshot，提示重试
    setPanelMode('command')
    setError('连接中断，请重试。已接收的内容已保留在编辑器中。')
  }
}
```

后端增加心跳：

```python
async def _heartbeat_loop(queue: asyncio.Queue, interval: float = 10.0):
    while True:
        await asyncio.sleep(interval)
        await queue.put({"type": "heartbeat", "timestamp": time.time()})
```

### 13.7 操作记录持久化

`recentOps` 使用 `localStorage`（非 sessionStorage），每页存储，最多保留 20 条：

```typescript
const STORAGE_KEY = (pageId: string) => `docmost.ai.recentOps:${pageId}`

// 写入
function addRecentOp(pageId: string, op: RecentOp) {
  const key = STORAGE_KEY(pageId)
  const ops = JSON.parse(localStorage.getItem(key) || '[]')
  ops.unshift(op)
  localStorage.setItem(key, JSON.stringify(ops.slice(0, 20)))
}
```

### 13.8 v2 Diff 位置映射策略

Spec review 指出了头部 markdown diff → ProseMirror 位置映射有精度风险。

**修订方案**：v2 的 diff 计算**移到前端**，直接基于 ProseMirror 文档结构：

```typescript
// 前端 diff 计算（避免 markdown→position 映射问题）
function computeEditorDiff(oldDoc: Node, newDoc: Node): BlockChange[] {
  const changes: BlockChange[] = []

  // 遍历新旧文档的 block 节点
  oldDoc.forEach((oldNode, oldOffset, oldIndex) => {
    const newNode = newDoc.maybeChild(oldIndex)
    if (!newNode) {
      changes.push({ type: 'deleted', ... })
      return
    }
    // 跳过图片/Mermaid/表格节点
    if (['image', 'codeBlock', 'table'].includes(oldNode.type.name)) {
      if (oldNode.type.name === 'codeBlock' && oldNode.attrs.language !== 'mermaid') {
        // 普通代码块参与 diff
      } else {
        return  // 跳过
      }
    }
    // 文本内容对比
    if (oldNode.textContent !== newNode.textContent) {
      changes.push({
        id: crypto.randomUUID(),
        type: 'modified',
        position: { from: oldOffset, to: oldOffset + oldNode.nodeSize },
        oldText: oldNode.textContent,
        newText: newNode.textContent,
        path: getHeadingContext(oldDoc, oldOffset),
      })
    }
  })

  return changes
}
```

后端仍返回 `full_content`（优化后全文），前端将其解析为 ProseMirror Node（`markdownToDoc()`），然后在两个 Node 之间做 diff。这完全避免了 markdown position 映射问题。

### 13.9 快捷操作列表（命令面板）

AI 命令面板的 6 个文档级快捷操作：

| 按钮 | 说明 | 内部指令 |
|------|------|-----------------|
| 📝 优化全文 | 优化措辞，保留结构和图片 | “提高本文档的写作质量” |
| 🌐 翻译 | 全文翻译（弹出语言选择） | “将此文档翻译成{语言}” |
| 📏 扩写 | 充实内容，增加细节 | “以更多详细信息扩展此文档” |
| ✂️ 缩写 | 精简内容，保留要点 | “使本文档更加简洁” |
| 🎯 调整语气 | 改为专业/友好/正式等 | “用{tone}语气重写” |
| 📋 生成摘要 | 在文档顶部插入摘要 | “生成本文档的摘要” |

### 13.10 功能标志实现

通过 Vite 环境变量（构建时注入）：

```typescript
// .env
VITE_AI_CREATOR_V3=true

// 使用
const useV3 = import.meta.env.VITE_AI_CREATOR_V3 === 'true'
```

### 13.11 会话状态类型优化

使用 discriminated union 避免无效状态组合：

```typescript
type AiSessionState =
  | { mode: 'idle'; recentOps: RecentOp[] }
  | { mode: 'running'; operation: 'optimize' | 'create'; recentOps: RecentOp[] }
  | { mode: 'review'; snapshot: EditorSnapshot; changeSummary: ChangeSummary;
      pendingChanges?: BlockChange[]; recentOps: RecentOp[] }
  | { mode: 'error'; error: string; snapshot?: EditorSnapshot; recentOps: RecentOp[] }
```

---

## 14. 测试策略

### 14.1 测试层次

```
┌─────────────────────────────────────────────────┐
│  Layer 4: 浏览器 E2E 验证（Chrome，每 Phase 末尾） │
├─────────────────────────────────────────────────┤
│  Layer 3: API 集成测试（NestJS + Agent Service）  │
├─────────────────────────────────────────────────┤
│  Layer 2: 前端组件测试（Vitest + Testing Library）│
├─────────────────────────────────────────────────┤
│  Layer 1: 后端单元测试（pytest）                  │
└─────────────────────────────────────────────────┘
```

### 14.2 后端单元测试（pytest）

#### 阶段 1 测试用例

```python
# agent-service/tests/orchestrator/test_engine_v3.py

class TestHandleDocument:
    """文档优化核心流程"""

    async def test_optimize_plain_text_returns_content_and_summary(self):
        """纯文本文档优化：返回优化内容 + 变更摘要"""
        request = DocumentRequest(
            instruction="优化措辞",
            original_content="衔接应付单审核与发票",
        )
        events = [e async for e in engine.handle_document(request)]
        assert any(e.type == "content" for e in events)
        assert any(e.type == "change_summary" for e in events)
        assert events[-1].type == "done"

    async def test_optimize_preserves_image_references(self):
        """文档优化必须保留所有图片引用"""
        original = "# 标题\n\n段落内容\n\n![截图](https://cdn/img1.png)\n\n更多内容"
        request = DocumentRequest(
            instruction="优化措辞",
            original_content=original,
        )
        events = [e async for e in engine.handle_document(request)]
        done_event = next(e for e in events if e.type == "done")
        assert "![截图](https://cdn/img1.png)" in done_event.content
        summary = next(e for e in events if e.type == "change_summary")
        assert summary.data["images_kept"] == summary.data["images_total"]

    async def test_optimize_preserves_mermaid_blocks(self):
        """文档优化必须保留 Mermaid 代码块"""
        original = "# 流程\n\n```mermaid\nflowchart LR\nA-->B\n```\n\n说明文字"
        request = DocumentRequest(instruction="优化", original_content=original)
        events = [e async for e in engine.handle_document(request)]
        done_event = next(e for e in events if e.type == "done")
        assert "```mermaid" in done_event.content
        assert "flowchart LR" in done_event.content

    async def test_optimize_with_file_upload_parses_and_rehosts(self):
        """上传 PDF 优化：MineRU 解析 + 图片 重新托管"""
        request = DocumentRequest(
            instruction="优化这个文档",
            files=[FilePayload(name="sop.pdf", mimetype="application/pdf", content_b64="...")],
            page_id="page-1",
        )
        events = [e async for e in engine.handle_document(request)]
        assert any(e.type == "step_start" and e.step == "parsing" for e in events)
        assert any(e.type == "step_done" and e.step == "parsing" for e in events)

    async def test_optimize_mineru_failure_degrades_gracefully(self):
        """MineRU 解析失败时降级处理"""
        # Mock MineRU 抛出异常
        request = DocumentRequest(
            instruction="优化",
            files=[FilePayload(name="bad.pdf", ...)],
        )
        events = [e async for e in engine.handle_document(request)]
        assert any(e.type == "step_error" and e.step == "parsing" for e in events)
        # 仍然完成（降级到无资产模式）
        assert events[-1].type == "done"

    async def test_optimize_large_document_truncation(self):
        """超大文档触发截断警告"""
        large_content = "段落内容。" * 50000  # 超过 token 限制
        request = DocumentRequest(instruction="优化", original_content=large_content)
        events = [e async for e in engine.handle_document(request)]
        # 应有截断警告但不崩溃
        assert events[-1].type == "done"


class TestHandleSimple:
    """简单操作（仅用于 agent-service 内部子任务）"""

    async def test_simple_returns_streamed_content(self):
        request = SimpleRequest(action="improve", content="这是一段文字")
        events = [e async for e in engine.handle_simple(request)]
        assert any(e.type == "content" for e in events)
        assert events[-1].type == "done"


class TestChangeSummary:
    """变更摘要生成"""

    def test_summary_counts_text_changes(self):
        summary = generate_change_summary("原文A", "修改后B", None)
        assert summary.text_changes > 0

    def test_summary_detects_image_preservation(self):
        original = "![img1](url1)\n![img2](url2)"
        optimized = "![img1](url1)\n![img2](url2)"  # 图片不变
        summary = generate_change_summary(original, optimized, None)
        assert summary.images_kept == 2
        assert summary.images_total == 2

    def test_summary_detects_image_loss(self):
        original = "![img1](url1)\n![img2](url2)"
        optimized = "![img1](url1)"  # 丢失一张
        summary = generate_change_summary(original, optimized, None)
        assert summary.images_kept == 1
        assert summary.images_lost == ["url2"]

    def test_summary_detects_heading_structure_change(self):
        original = "# A\n## B\n## C"
        optimized = "# A\n## B\n## D"  # C → D
        summary = generate_change_summary(original, optimized, None)
        assert summary.structure_preserved is False
```

#### 阶段 6（v2）测试用例

```python
# agent-service/tests/orchestrator/test_diff_engine.py

class TestBlockDiff:
    def test_diff_detects_text_modification(self):
        changes = compute_block_changes("段落A", "段落B", {})
        assert len(changes) == 1
        assert changes[0].type == "modified"

    def test_diff_skips_image_blocks(self):
        original = "段落\n\n![img](url)\n\n段落2"
        optimized = "修改段落\n\n![img](url)\n\n修改段落2"
        changes = compute_block_changes(original, optimized, {})
        # 只有 2 处变更（两个段落），图片跳过
        assert all(c.block_type != "image" for c in changes)

    def test_diff_skips_mermaid_blocks(self):
        original = "段落\n\n```mermaid\nA-->B\n```"
        optimized = "修改段落\n\n```mermaid\nA-->B\n```"
        changes = compute_block_changes(original, optimized, {})
        assert len(changes) == 1  # 只有段落变更
```

### 14.3 前端组件测试（Vitest）

```typescript
// apps/client/src/ee/ai/components/__tests__/

// test: AiCommandPanel
describe('AiCommandPanel', () => {
  it('renders 6 quick action buttons', () => {
    render(<AiCommandPanel pageId="p1" editor={mockEditor} />)
    expect(screen.getByText('优化全文')).toBeInTheDocument()
    expect(screen.getByText('翻译')).toBeInTheDocument()
    // ... 6 个按钮
  })

  it('switches to review mode after optimization completes', async () => {
    // Mock SSE stream → done event
    // Assert panel shows ReviewSidebar
  })

  it('shows change summary with image preservation status', () => {
    render(<ReviewSidebar changeSummary={{ text_changes: 8, images_kept: 3, images_total: 3 }} />)
    expect(screen.getByText('3/3 保留')).toBeInTheDocument()
  })

  it('warns when images are lost', () => {
    render(<ReviewSidebar changeSummary={{ images_kept: 2, images_total: 3 }} />)
    expect(screen.getByText('2/3 保留')).toHaveClass('warning')
  })
})

// test: RecentOps
describe('RecentOps', () => {
  it('displays recent operations from localStorage', () => {
    localStorage.setItem('docmost.ai.recentOps:p1', JSON.stringify([
      { type: 'optimize', summary: '修改了 8 处', status: 'accepted', time: Date.now() }
    ]))
    render(<RecentOps pageId="p1" />)
    expect(screen.getByText('修改了 8 处')).toBeInTheDocument()
  })

  it('limits to 20 operations', () => {
    // Add 25 ops → assert only 20 rendered
  })
})

// test: ai-menu 解耦
describe('ai-menu isolation', () => {
  it('does not read from aiCreatorSelectionAtom', () => {
    // Verify ai-menu uses its own selection state
    // Not importing from ai-creator-atoms
  })

  it('does not write to ai-creator conversation history', () => {
    // Verify ai-menu operation does not add messages to any shared state
  })

  it('writes to recentOps after operation', () => {
    // Trigger ai-menu replace action
    // Assert recentOps updated
  })
})

// test: 快照 + Undo
describe('useAiCommand snapshot', () => {
  it('saves editor snapshot before optimize', async () => {
    const { result } = renderHook(() => useAiCommand({ editor: mockEditor, pageId: 'p1' }))
    await act(() => result.current.submitOptimize('优化'))
    expect(result.current.snapshot).not.toBeNull()
    expect(result.current.snapshot.bodyJson).toBeDefined()
  })

  it('restores snapshot on reject', async () => {
    // Submit optimize → receive result → click reject
    // Assert editor content matches original snapshot
  })

  it('restores snapshot on error', async () => {
    // Submit optimize → SSE error
    // Assert editor content matches original snapshot
  })
})
```

### 14.4 API 集成测试

```python
# agent-service/tests/integration/test_api_v3.py

class TestDocumentOptimizeEndpoint:
    """POST /agent/document/optimize 集成测试"""

    async def test_optimize_returns_sse_stream(self, client):
        resp = await client.post("/agent/document/optimize", json={
            "instruction": "优化措辞",
            "original_content": "测试内容",
        })
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/event-stream")

    async def test_optimize_with_file_upload(self, client, sample_pdf_bytes):
        resp = await client.post("/agent/document/optimize",
            data={"instruction": "优化文档", "page_id": "p1"},
            files={"file": ("test.pdf", sample_pdf_bytes, "application/pdf")},
        )
        events = parse_sse_events(resp)
        assert any(e["type"] == "step_done" and e["step"] == "parsing" for e in events)

    async def test_heartbeat_emitted_during_long_operation(self, client):
        """长时间操作中应有心跳事件"""
        resp = await client.post("/agent/document/optimize", json={
            "instruction": "详细扩写",
            "original_content": "短文本",
        })
        events = parse_sse_events(resp)
        # 如果操作超过 10 秒，应有 heartbeat
        # 短操作可能没有，但不应报错


class TestDocumentCreateEndpoint:
    """POST /agent/document/create 集成测试"""

    async def test_create_streams_content(self, client):
        resp = await client.post("/agent/document/create", json={
            "instruction": "写一篇采购流程文档",
        })
        events = parse_sse_events(resp)
        assert any(e["type"] == "content" for e in events)
        assert events[-1]["type"] == "done"

    async def test_create_with_brief_pauses_for_confirmation(self, client):
        resp = await client.post("/agent/document/create", json={
            "instruction": "写一篇技术文档",
            "need_brief": True,
        })
        events = parse_sse_events(resp)
        assert any(e["type"] == "await_input" and e["phase"] == "brief" for e in events)
```

### 14.5 浏览器端到端验证（Chrome）

> 使用 `mcp__claude-in-chrome__*` 工具在真实 Chrome 浏览器中执行端到端验证。
> 每个 Phase 完成后执行对应的验证场景。

#### 阶段 2 完成后：命令面板基础验证

```
验证 TC-01: 命令面板渲染
  前置: 登录 Docmost，打开一个有内容的页面
  步骤:
    1. 打开 Chrome → localhost:5173/s/{space}/p/{page}
    2. 确认右侧 AI 命令面板可见
    3. 验证 6 个快捷按钮（优化全文、翻译、扩写、缩写、调整语气、生成摘要）
    4. 验证输入框存在且可聚焦
    5. 验证面板可折叠/展开
  预期: 面板 300px 宽，按钮 2x3 网格，输入框底部带工具栏

验证 TC-02: 文档优化 — 纯文本
  前置: 打开一个含 3 段文字的页面
  步骤:
    1. 点击 [优化全文] 按钮
    2. 观察面板状态变为 "running"（显示进度）
    3. 等待完成
    4. 验证面板切换为审阅模式（显示变更摘要）
    5. 验证编辑器内容已更新
    6. 点击 [撤销] → 验证内容恢复原文
  预期: 优化 <30s，变更摘要正确，撤销后内容 100% 恢复

验证 TC-03: 文档优化 — 含图片
  前置: 打开一个含文字 + 图片的页面
  步骤:
    1. 记录页面中图片数量
    2. 点击 [优化全文]
    3. 等待完成
    4. 验证变更摘要中图片状态为 "X/X 保留 ✓"
    5. 验证编辑器中图片仍然存在且位置正确
    6. 点击 [接受]
  预期: 所有图片保留，位置不变

验证 TC-04: 文档优化 — 上传 PDF
  前置: 准备一个含图片的 PDF 文件
  步骤:
    1. 在命令面板输入框点击 📎 附件按钮
    2. 选择 PDF 文件上传
    3. 输入指令 "优化这个文档的排版和措辞"
    4. 点击发送
    5. 观察解析进度（"parsing" 步骤）
    6. 等待完成
    7. 验证编辑器中有文字内容 + 图片
  预期: PDF 中的图片正确提取并显示，文字被优化
```

#### 阶段 3 完成后：划词改写解耦验证

```
验证 TC-05: 划词改写独立性
  前置: 打开一个有内容的页面
  步骤:
    1. 先在命令面板执行一次 [优化全文]，完成后接受
    2. 在编辑器中选中一段文字
    3. 在 气泡菜单 中点击 "Ask AI"
    4. 选择 "润色"
    5. 等待结果 → 点击 [替换]
    6. 验证右侧命令面板的 "最近操作" 记录了此次划词改写
    7. 验证命令面板没有出现聊天气泡或对话历史
  预期: 划词改写通过 ai-menu 浮窗独立完成，命令面板只显示操作记录

验证 TC-06: 连续划词改写不冲突
  步骤:
    1. 选中第一段文字 → 润色 → 替换
    2. 选中第二段文字 → 翻译为英文 → 替换
    3. 选中第三段文字 → 缩写 → 插入下方
    4. 验证三次操作都在 "最近操作" 中
    5. 验证编辑器内容正确（无错位、无丢失）
  预期: 三次独立操作，无状态污染
```

#### 阶段 4 完成后：从零创作验证

```
验证 TC-07: 空白页创作
  前置: 新建一个空白页面
  步骤:
    1. 在命令面板输入 "写一篇采购退货流程 SOP"
    2. 点击发送
    3. 观察内容流式写入编辑器
    4. 验证标题自动提取到标题栏
    5. 验证内容包含标题、段落、可能的 Mermaid 流程图
  预期: 内容流式出现，标题正确，结构完整

验证 TC-08: 上传文件创作
  步骤:
    1. 新建空白页
    2. 上传 PDF + 输入 "基于这个文档写一篇改进版"
    3. 等待完成
    4. 验证内容包含 PDF 中的关键信息和图片
  预期: PDF 内容被理解和复用，图片来自原文
```

#### 阶段 5 完成后：回归验证

```
验证 TC-09: 旧代码清理后功能正常
  步骤:
    1. 执行 TC-02 ~ TC-08 全部场景
    2. 验证无 console 错误
    3. 验证无 404 请求（旧端点已返回 410）
  预期: 全部场景通过，无回归

验证 TC-10: Feature Flag 关闭回退
  步骤:
    1. 设置 VITE_AI_CREATOR_V3=false
    2. 重新构建前端
    3. 打开页面
    4. 验证显示旧版 AI Creator 面板（3 列 Workbench）
  预期: Feature Flag 关闭后旧面板正常工作（如果 Phase 5 尚未删除旧代码）
```

#### 阶段 6 完成后：v2 Inline Diff 验证

```
验证 TC-11: Inline Diff 基本功能
  前置: 打开含文字 + 图片的页面
  步骤:
    1. 点击 [优化全文]（v2 模式自动启用）
    2. 等待完成
    3. 验证编辑器中出现红色删除线（原文）+ 绿色标记（新文）
    4. 验证每处变更旁有 ✓✗ 按钮
    5. 验证图片处无 diff 标记（图片被跳过）
    6. 验证 Mermaid 代码块无 diff 标记
  预期: Inline diff 正确渲染，图片和 Mermaid 不参与 diff

验证 TC-12: 逐条 Accept/Reject
  步骤:
    1. 执行优化 → 进入 diff 审阅
    2. 第 1 处变更 → 点击 ✓ 接受
    3. 第 2 处变更 → 点击 ✗ 拒绝
    4. 右侧审阅面板验证进度（2/N 已处理）
    5. 点击 [应用已接受的变更]
    6. 验证第 1 处保留新文，第 2 处恢复原文
    7. 验证编辑器恢复可编辑状态
  预期: Accept/Reject 正确应用，编辑器状态正常

验证 TC-13: 审阅面板跳转
  步骤:
    1. 执行优化 → 进入 diff 审阅
    2. 在右侧审阅面板点击某一变更条目
    3. 验证编辑器滚动到对应位置
    4. 验证该变更被高亮
  预期: 点击跳转准确

验证 TC-14: 全部拒绝 = 完全恢复
  步骤:
    1. 执行优化 → 进入 diff 审阅
    2. 点击 [全部撤销]
    3. 验证编辑器内容 100% 恢复原文
    4. 验证所有 diff 标记消失
  预期: 零内容损失
```

### 14.6 浏览器验证执行方式

每个 Phase 完成后，使用 Claude in Chrome 自动化执行验证：

```
执行流程：
1. 启动 Docmost 开发服务器（pnpm dev + agent-service）
2. 使用 mcp__claude-in-chrome__tabs_create_mcp 打开页面
3. 使用 mcp__claude-in-chrome__javascript_tool 执行操作
4. 使用 mcp__claude-in-chrome__screenshot_mcp 截图验证
5. 使用 mcp__claude-in-chrome__read_console_messages 检查错误
6. 使用 mcp__claude-in-chrome__gif_creator 录制关键流程
7. 记录结果到 progress.md
```

### 14.7 测试覆盖率目标

| 层级 | 目标 | 重点 |
|------|------|------|
| 后端单元 | >80% | handle_document、generate_change_summary、compute_block_changes |
| 前端组件 | >70% | AiCommandPanel、ReviewSidebar、useAiCommand |
| API 集成 | 关键路径 100% | 优化、创造、SSE 事件格式 |
| 浏览器 E2E | 14 个 TC 全部通过 | 每 Phase 执行对应 TC |
