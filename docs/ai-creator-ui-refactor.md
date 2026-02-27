# AI Creator 面板 UI 重构记录

> 日期：2026-02-27

## 重构背景

原 AI Creator 面板存在以下问题：
- 三模式系统（create/edit/chat）自动切换混乱，选中文字时模式突然跳变
- 固定 350px 宽度，长代码和表格显示不佳
- 空状态过于简陋（仅图标+三行文字）
- 消息气泡无头像、无操作按钮（仅 chat 模式有）
- `dangerouslySetInnerHTML` 直接渲染 `marked` 输出，存在 XSS 风险
- 无代码语法高亮
- 每次打开面板保留历史对话

参考 LobeHub 对话排版风格，进行全面重构。

---

## 设计决策

| 决策项 | 选择 |
|--------|------|
| 面板承载方式 | 可拖拽调节宽度的右侧面板（min 350px, max 700px） |
| 消息排版风格 | 气泡模式（用户右对齐+头像，AI 左对齐+头像） |
| 模式系统 | 统一为单一对话模式，取消 create/edit/chat 切换 |
| 欢迎页设计 | 模板卡片式（AI 头像+欢迎语+2×3 模板网格） |
| 历史对话行为 | 每次打开面板时清空，显示欢迎页 |
| 输入区域风格 | LobeHub 风格大输入框，工具栏浮动在底部 |
| 编辑器插入 | 可切换：自动插入 / 手动插入（持久化到 localStorage） |
| Markdown 渲染 | 气泡显示用隔离 Marked 实例 + hljs；编辑器插入用 editor-ext 的 markdownToHtml |
| XSS 防护 | DOMPurify 净化所有 marked 输出 |

---

## 变更文件清单

### 新增依赖

```bash
cd apps/client && pnpm add dompurify highlight.js && pnpm add -D @types/dompurify
```

### 删除文件

| 文件 | 原用途 |
|------|--------|
| `ai-creator-mode-switch.tsx` | 编辑/对话模式切换条（已不需要） |

### 修改文件（15 个文件，+854/-428 行）

| 文件 | 操作 | 说明 |
|------|------|------|
| `sidebar-atom.ts` | 修改 | 新增 `asideWidthAtom`（持久化面板宽度） |
| `global-app-shell.tsx` | 修改 | aside 拖拽逻辑（复用 sidebar resize 模式的镜像实现） |
| `app-shell.module.css` | 修改 | 新增 `.asideResizeHandle` 样式 |
| `aside.tsx` | 修改 | 简化：AI Creator 直接 early return，移除 customLayout 变量 |
| `ai-creator-atoms.ts` | 修改 | 删除 3 个旧 atom（mode/modeLock/insertMode），新增 `aiCreatorAutoInsertAtom` |
| `ai-creator.types.ts` | 修改 | 删除 `AiCreatorMode`/`InsertMode`，新增 `selectionContext`/`selectionRange` 字段，模板数据增强（icon/desc） |
| `ai-creator-panel.tsx` | 重写 | 移除模式切换、新增清空+新建对话、选区仅作上下文 |
| `ai-creator-messages.tsx` | 重写 | 新增模板卡片式欢迎页（WelcomePage 组件） |
| `ai-creator-message-item.tsx` | 重写 | 气泡模式+头像+操作按钮+hljs 高亮+DOMPurify+编辑器插入用 markdownToHtml |
| `ai-creator-input.tsx` | 重写 | LobeHub 风格大输入框+底部工具栏（模板/上传/自动插入/发送） |
| `ai-creator-selection.tsx` | 修改 | 移到输入区上方，新增清除选区按钮 |
| `ai-creator-templates.tsx` | 简化 | 仍保留文件但不再被 input 组件导入（模板改为 Menu 弹出） |
| `ai-creator-file-list.tsx` | 不变 | — |
| `ai-creator.module.css` | 重写 | 全新样式：欢迎页/气泡/代码高亮/LobeHub 输入框/深色模式 |
| `apps/client/package.json` | 修改 | 新增 dompurify、highlight.js 依赖 |

---

## 功能详述

### 1. 可拖拽 Aside 面板

- 新增 `asideWidthAtom = atomWithWebStorage<number>('asideWidth', 420)`
- `AppShell.Aside` 使用动态 width：`isAsideOpen ? asideWidth : 350`
- 左侧拖拽手柄（与 navbar 的 resizeHandle 镜像对称）
- 宽度范围：350px ~ 700px，刷新后持久化

### 2. 统一对话模式

**删除的 atoms**：
- `aiCreatorModeAtom` — 不再需要三种模式
- `aiCreatorModeLockAtom` — 不再需要模式锁
- `aiCreatorInsertModeAtom` — 合并到自动插入切换按钮

**新增的 atoms**：
- `aiCreatorAutoInsertAtom` — 编辑切换（auto-insert ON/OFF），持久化到 localStorage

**类型变更**：
- 删除 `AiCreatorMode`（'create' | 'edit' | 'chat'）
- 删除 `InsertMode`（'append' | 'overwrite'）
- `AiCreatorMessage` 移除 `.mode`，新增 `.selectionContext?` 和 `.selectionRange?`
- `AiTemplate` 新增 `.icon` 和 `.desc` 字段

### 3. 面板主容器

- 移除所有模式切换逻辑和 `useEffect` 联动
- 选区监听仅更新 `aiCreatorSelectionAtom`（作为上下文，不触发模式跳变）
- `useEffect(() => setAllMessages(...), [])` — 每次面板挂载时清空消息
- Header 新增"新建对话"按钮（IconPlus）

布局结构：
```
┌─ Header: [✦ AI 助手] [+新建] [×关闭] ────┐
├─ ScrollArea ──────────────────────────────┤
│   欢迎页（无消息时）/ 消息列表（有消息时）  │
├─ Selection Context（有选区时显示）─────────┤
├─ Input Area ──────────────────────────────┤
│   [文件chips]                              │
│   ┌──────────────────────────────────┐    │
│   │ textarea (多行)                   │    │
│   │                                   │    │
│   │ [📋模板][📎上传][✏️编辑]    [⬆️] │    │
│   └──────────────────────────────────┘    │
└───────────────────────────────────────────┘
```

### 4. 欢迎页（模板卡片式）

- AI 渐变头像 + 欢迎语
- `SimpleGrid cols={2}` + `Paper` 组件的 2×3 模板网格
- 6 个模板卡片，每个有图标 + 名称 + 简短描述
- 点击卡片 → 设置 `aiCreatorTemplateAtom` + 聚焦输入框

模板数据：

| key | 名称 | 图标 | 描述 |
|-----|------|------|------|
| technical-doc | 技术文档 | IconFileCode | 系统架构、API 文档 |
| operation-manual | 操作手册 | IconBook | 操作步骤与指南 |
| prd | 产品 PRD | IconClipboardList | 产品需求规格书 |
| report | 研究报告 | IconChartBar | 行业分析与调研 |
| meeting-notes | 会议纪要 | IconNotes | 会议记录与决议 |
| requirements | 需求分析 | IconChecklist | 功能需求拆解 |

### 5. 消息气泡

**用户消息**：
- 右对齐：气泡（紫色）+ 头像（IconUser 圆形）
- 圆角 `16px 16px 4px 16px`（右下尖角）
- 如有 `selectionContext`，在气泡顶部显示引用文字（半透明白色背景+左边框）

**AI 消息**：
- 左对齐：头像（IconSparkles 渐变圆形）+ 气泡（浅灰）
- 圆角 `16px 16px 16px 4px`（左下尖角）
- 所有 AI 消息均显示操作按钮（hover 时出现）：
  - 复制（IconCopy）
  - 插入到编辑器末尾（IconArrowBarDown）
  - 替换选区（IconReplace，仅当有选区时显示）

### 6. 代码语法高亮

- 使用 `highlight.js` 集成到 `marked` 自定义 renderer
- **关键**：使用 `new Marked()` 创建**隔离实例**（`bubbleMarked`），避免污染全局 `marked`
- 代码块显示语言标签（通过 `data-language` 属性 + CSS `::before`）
- 代码块样式：圆角、背景色、顶部语言标签栏

### 7. XSS 安全

- `marked.parse()` 输出经过 `DOMPurify.sanitize()` 净化
- 白名单模式：只允许特定标签（p/br/strong/em/h1-h6/ul/ol/li/pre/code/span/table 等）
- 只允许特定属性（class/href/target/rel/src/alt/title/data-language）
- `<script>`、`onerror`、`javascript:` 等均被过滤

### 8. LobeHub 风格输入区域

- 大面积多行输入框（`min-height: 60px`，`max-height: 160px`）
- 底部工具栏浮动在输入框内部：
  - **左侧**：模板选择（Menu 弹出）、上传文件、编辑切换
  - **右侧**：发送/停止按钮
- 模板从独立 Select 下拉框改为紧凑图标按钮 + Menu
- 编辑切换按钮（`aiCreatorAutoInsertAtom`，持久化）：
  - ON（IconPencil 亮色）：AI 完成后自动插入正文
  - OFF（IconPencilOff 灰色）：手动点击操作按钮插入

### 9. 编辑器插入的双管线架构

这是本次重构中最重要的架构决策：

| 场景 | 使用的渲染器 | 原因 |
|------|-------------|------|
| **气泡显示** | `bubbleMarked`（隔离实例 + hljs + DOMPurify） | 需要代码高亮、XSS 安全，不经过 TipTap |
| **编辑器插入** | `markdownToHtml`（from `@docmost/editor-ext`） | 使用编辑器自己的 marked 配置，输出 TipTap DOMParser 能正确解析的 HTML |

为什么不能用同一个渲染器：
- hljs 高亮会将代码文本转为 `<span class="hljs-keyword">` 等 HTML
- TipTap codeBlock 的 `parseHTML` 期望 `<pre>` 中是纯文本
- 如果代码已被 hljs 处理，TipTap 无法正确创建 codeBlock 节点（language 属性丢失）

编辑器插入时的标题提取逻辑：
```
AI 生成 markdown → stripTimestamp → extractTitle → markdownToHtml → insertContent
```

---

## 已知问题（待后续解决）

### Mermaid 图在编辑器中不渲染

**现象**：AI 生成的 mermaid 代码块插入编辑器后，显示为空白代码块（language 显示 "auto"），mermaid 图不渲染。

**分析**：
- TipTap 的 `MermaidView` 组件仅在 `node.attrs.language === "mermaid"` 时触发
- `markdownToHtml` 输出的 `<pre><code class="language-mermaid">` 理论上应被 TipTap parseHTML 正确解析
- 已排除全局 `marked` 污染问题（改用 `new Marked()` 隔离实例）
- 需要进一步调试 `insertContent(html)` 后实际创建的 ProseMirror 节点结构
- 可能需要改用 markdown clipboard 的 `DOMParser.fromSchema().parseSlice()` 方式，或分段处理 mermaid 代码块

**待验证方向**：
1. 在 `insertContent` 后打印 `editor.getJSON()` 检查 codeBlock 节点的 attrs
2. 对比手动从斜杠菜单创建 mermaid 图时的节点结构
3. 考虑在 insert 前用正则提取 mermaid 代码块，用 `setCodeBlock({ language: "mermaid" })` + `insertContent(纯文本)` 分段插入
4. 检查 `markdownToHtml` 是否被 editor-ext 的其他 `marked.use()` 调用（callout/math 扩展）影响了 code 输出格式

---

## 踩坑记录

### 1. marked.use() 全局污染

**现象**：使用 `markdownToHtml`（from editor-ext）插入编辑器时，代码块仍然被 hljs 高亮处理，TipTap 无法解析为正确的 codeBlock 节点。

**原因**：`marked.use()` 修改全局单例。在 `ai-creator-message-item.tsx` 模块加载时执行的 `marked.use({ renderer: { code() {} } })` 影响了所有后续的 `marked.parse()` 调用，包括 `markdownToHtml` 内部的。

**解决**：使用 `new Marked()` 创建隔离实例。

```typescript
// ❌ 错误：污染全局
import { marked } from "marked";
marked.use({ renderer: { code() { /* hljs */ } } });

// ✅ 正确：隔离实例
import { Marked } from "marked";
const bubbleMarked = new Marked({
  renderer: {
    code({ text, lang }) { /* hljs 高亮逻辑 */ },
  },
});
```

### 2. marked v13 code renderer 的 text 可能为 undefined

**现象**：流式传输期间，白屏崩溃。`TypeError: Cannot read properties of undefined (reading 'replace')`。

**原因**：流式输出的 markdown 可能包含未闭合的代码块（如 ` ```python ` 打开但未关闭），marked 解析后 code token 的 `text` 属性为 `undefined`，传给 `hljs.highlightAuto(undefined)` 崩溃。

**解决**：
```typescript
code({ text, lang }) {
  if (!text) return '<pre><code></code></pre>\n';  // 防护
  // ...
}
```

### 3. DOMPurify 过滤 data-language 属性

**现象**：代码块语言标签不显示（CSS `::before { content: attr(data-language) }` 无效）。

**原因**：DOMPurify 默认不允许 `data-*` 属性。

**解决**：在 `ALLOWED_ATTR` 中显式添加 `'data-language'`。

### 4. atomWithWebStorage 的 boolean 类型推断

**现象**：`const [autoInsert, setAutoInsert] = useAtom(aiCreatorAutoInsertAtom)` 中 setter 类型推断为 `never`。

**原因**：`atomWithWebStorage` 内部 `baseAtom` 的类型因 `storedValue === "true"` 表达式被推断为 `string | boolean | undefined`，与 `boolean` 不匹配。

**解决**：类型断言。
```typescript
const [autoInsert, _setAutoInsert] = useAtom(aiCreatorAutoInsertAtom);
const setAutoInsert = _setAutoInsert as (v: boolean) => void;
```
