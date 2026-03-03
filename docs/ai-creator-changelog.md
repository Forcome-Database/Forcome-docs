# AI Creator 面板 — 开发记录

> 创建日期：2026-02-26

## 功能概述

在页面头部新增 ✦ AI Creator 按钮，点击后右侧 Aside 面板展开，支持三种智能模式：

| 模式 | 触发条件 | 行为 |
|------|---------|------|
| **创作模式** | 编辑器无选区（默认） | 上传文件 + 选模版 + 提示词 → AI 流式写入编辑器 |
| **编辑模式** | 编辑器有选区（默认） | 显示选中文本 + 提示词 → AI 替换选区内容 |
| **对话模式** | 编辑器有选区 + 手动切换 | 显示选中文本 + 提示词 → AI 在面板内回答，不修改编辑器 |

模式根据编辑器选区状态自动切换，用户手动切换后锁定，选区清空时解锁。

---

## 文件清单

### 后端新增

| 文件 | 用途 |
|------|------|
| `apps/server/src/ee/ai/services/ai-file.service.ts` | PDF/Word/图片文件解析服务 |
| `apps/server/src/ee/ai/constants/ai-templates.ts` | 6 个 AI 生成模版（技术文档/操作手册/PRD/研究报告/会议纪要/需求分析） |
| `apps/server/src/ee/ai/dto/ai-creator.dto.ts` | 创作模式请求 DTO |

### 后端修改

| 文件 | 改动 |
|------|------|
| `apps/server/src/ee/ai/ai.controller.ts` | 新增 `POST /api/ai/creator/generate` SSE 端点 |
| `apps/server/src/ee/ai/services/ai.service.ts` | 新增 `streamWithFiles()` 方法 |
| `apps/server/src/ee/ai/ai.module.ts` | 注册 AiFileService |
| `apps/server/package.json` | 新增 mammoth、pdf-parse 依赖 |

### 前端新增

| 文件 | 用途 |
|------|------|
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx` | 面板主容器（选区监听 + 模式切换 + 自定义 header） |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-input.tsx` | 核心交互（文件上传/模版/提示词/三模式流式处理） |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-messages.tsx` | 消息列表 + 空状态 + 流式动画 |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-message-item.tsx` | 消息气泡（用户紫色右对齐/AI灰色左对齐 + 复制/插入按钮） |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-mode-switch.tsx` | 编辑/对话切换条 |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-selection.tsx` | 选中文本预览 |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-file-list.tsx` | 文件标签列表 |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-templates.tsx` | 模版下拉选择 |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-atoms.ts` | Jotai 状态原子 |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator.types.ts` | 类型定义 + 模版选项 |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator.module.css` | 全部样式（CSS Module + light-dark 暗色适配） |

### 前端修改

| 文件 | 改动 |
|------|------|
| `apps/client/src/components/layouts/global/aside.tsx` | 新增 `ai-creator` tab，AI 面板自管理布局 |
| `apps/client/src/features/page/components/header/page-header-menu.tsx` | 新增 ✦ AI Creator 按钮（IconSparkles） |
| `apps/client/src/ee/ai/services/ai-service.ts` | 新增 `creatorGenerate()` 函数（FormData + SSE） |

---

## 踩坑记录

### 1. Fastify multipart 文件流消费时机

**现象**：请求发出后后端无响应，一直 pending。

**原因**：Fastify `req.parts()` 返回的文件 part 是流（stream），`for await` 循环结束后流自动关闭。在循环外调用 `file.toBuffer()` 会永久挂起。

**解决**：在 `for await` 循环内立刻 `await part.toBuffer()` 缓冲到内存，传递 `{ buffer, mimetype, filename }` 对象给后续处理。

```typescript
// ❌ 错误：循环后流已关闭
const files = [];
for await (const part of req.parts()) {
  if (part.type === 'file') files.push(part);
}
await processFiles(files); // file.toBuffer() 挂死

// ✅ 正确：循环内立刻缓冲
const bufferedFiles = [];
for await (const part of req.parts()) {
  if (part.type === 'file') {
    const buffer = await part.toBuffer();
    bufferedFiles.push({ buffer, mimetype: part.mimetype, filename: part.filename });
  }
}
await processBufferedFiles(bufferedFiles); // 使用已缓冲的 buffer
```

### 2. Vercel AI SDK openai-compatible 不支持 file 类型

**现象**：`AI_InvalidPromptError: Invalid input: expected "text"`，0 chunks sent。

**原因**：`createOpenAICompatible()` 创建的 provider 只支持 `text` 和 `image` 两种 content part 类型。`type: 'file'`（用于 PDF）会被 Zod 验证拒绝。官方 `openai()` provider 支持 `file` 类型，但 `openai-compatible` 不支持。

**解决**：PDF 和 Word 统一提取文本后作为 `text` 类型发送。只有图片保留 `image` 类型。纯文本场景用简单 `prompt` 参数（兼容所有 provider），有图片时才用 `messages` 多模态格式。

```typescript
// 根据内容类型选择 API 格式
if (!hasImages) {
  // 纯文本：简单 prompt 格式，兼容所有 provider
  streamText({ model, prompt: fullTextPrompt });
} else {
  // 有图片：messages 多模态格式（只含 text + image）
  streamText({ model, messages: [{ role: 'user', content: [...] }] });
}
```

### 3. pdf-parse v2 API 完全重构

**现象**：`pdfParse is not a function`。

**原因**：`pdf-parse@2.x` 改为 class-based API（`new PDFParse()`），不再默认导出函数。npm 安装时默认拉取最新的 v2。

**解决**：锁定 `pdf-parse@1.1.1`，v1 直接导出函数 `pdfParse(buffer)` → `{ text, numpages, info }`。

```bash
pnpm add pdf-parse@1.1.1
```

### 4. Windows 系统环境变量覆盖 .env

**现象**：API Key 明明在 `.env` 中配置正确，但后端日志显示 `apiKey: "YOUR_KEY_HERE"`（一个占位符）。

**原因**：Windows 用户级环境变量 `OPENAI_API_KEY=YOUR_KEY_HERE` 覆盖了 `.env` 文件中的值。NestJS ConfigModule 中 `process.env` 优先级高于 `.env`。

**解决**：删除用户级环境变量。

```powershell
# 查看
[Environment]::GetEnvironmentVariable('OPENAI_API_KEY', 'User')
# 删除
[Environment]::SetEnvironmentVariable('OPENAI_API_KEY', '', 'User')
# 需要重启终端才生效
```

### 5. Jotai v2 nullable atom 的 TypeScript 类型推断

**现象**：`useAtom(aiCreatorSelectionRangeAtom)` 的 setter 被推断为 `never` 类型，调用 `setSelectionRange(null)` 或 `setSelectionRange({ from, to })` 均报 TS 错误。

**原因**：Jotai v2 的 `atom<T | null>(null)` 在某些 TypeScript 配置下，setter 的参数类型被推断为 `never`。

**解决**：对 setter 做类型断言。

```typescript
const [, _setSelectionRange] = useAtom(aiCreatorSelectionRangeAtom);
const setSelectionRange = _setSelectionRange as (v: SelectionRange | null) => void;
```

### 6. AI 生成的标题没有写入页面 title

**现象**：AI 生成的 H1 标题被插入到正文区域，页面标题栏仍显示 "Untitled"。

**原因**：`editor.chain().insertContent(html)` 只操作 pageEditor（正文编辑器），不操作 titleEditor（标题编辑器）。TipTap 的标题和正文是两个独立的 Editor 实例。

**解决**：在写入编辑器前，用正则提取第一个 H1，写入 titleEditor，然后从正文中移除该 H1。

```typescript
const titleMatch = markdown.match(/^#\s+(.+)$/m);
if (titleMatch && titleEditor && !titleEditor.state.doc.textContent.trim()) {
  titleEditor.commands.setContent(titleMatch[1].trim());
  markdown = markdown.replace(/^#\s+.+\n*/m, '').trim();
}
```

### 7. Aside 面板布局：双重 padding + 固定高度

**现象**：面板左右边距过大，输入框掉到视口底部。

**原因**：Aside 父容器 `<Box p="md">` 加上子组件自身的 padding 导致双重边距。面板高度用 `calc(100vh - 100px)` 固定值，与 Aside 实际可用高度不匹配。

**解决**：AI Creator 面板完全自管理布局，Aside 容器只提供最小的 wrapper。面板高度用 `flex: 1; min-height: 0` 自适应父容器。

```typescript
// aside.tsx - AI Creator 使用自定义布局
if (customLayout && component) {
  return (
    <Box style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {component}  // 面板自带 header、内容、输入区
    </Box>
  );
}
```

---

## 设计决策

### 为什么用 Aside 面板而非独立 Drawer

- 与评论面板交互一致（用户心智模型统一）
- 复用已有的 `asideStateAtom` 开关逻辑和 AppShell 响应式
- 改动最小，评论/目录/AI 三者互斥（同一时间只开一个）

### 为什么 AI 面板自带 header 而非复用 Aside 默认标题

- 需要自定义的紫色渐变 sparkle 图标 + 关闭按钮
- 需要精确控制 padding（Aside 默认 `p="md"` 对 AI 面板太宽）
- 上下文提示（追加/覆盖）需要放在 header 下方、消息区上方

### 为什么 PDF 提取文本而非传给 AI Provider

- `openai-compatible` provider 不支持 `file` 类型（OneAPI 网关等中转服务限制）
- 文本提取后用简单 `prompt` 格式，兼容 OpenAI/Gemini/Ollama 所有 driver
- 用户上传 PDF 的目的是让 AI 理解内容来创作，不需要保留原始排版

### 为什么 CSS 用 light-dark() 而非硬编码颜色

- Docmost 支持暗色模式，所有颜色必须适配
- `light-dark(lightValue, darkValue)` 是项目统一的主题适配模式
- 所有间距用 `var(--mantine-spacing-*)` token，与 Mantine 设计系统一致

---

## 2026-02-27 UI 重构

面板进行了全面 UI 重构（参考 LobeHub 风格），详见 **[ai-creator-ui-refactor.md](./ai-creator-ui-refactor.md)**。

主要变更：取消三模式系统 → 统一对话模式、可拖拽面板宽度、模板卡片欢迎页、气泡消息+头像、hljs 代码高亮、DOMPurify XSS 防护、LobeHub 风格大输入框+底部工具栏、自动/手动插入切换。

---

## 2026-03-03 深度审计修复 + 粘贴图片功能

**提交记录**:
- `ff73309` fix(ai): 修复AI创作模块10个功能问题 (P0-P3)
- `7c08bd8` feat(ai): 支持在输入框直接粘贴图片
- `fd85bcf` fix(ai): 修复粘贴图片缩略图不显示

**统计**: 11 文件变更, +1012/-53 行

### 审计方法

通过三个并行 Explore 代理（前端组件 / 后端服务 / 前端交互）深度审查全部 AI 模块代码，覆盖：
- 前端 29 个文件（组件、hooks、service、atoms、types）
- 后端 14 个文件（controller、service、DTO、queue、constants）

### Bug 修复清单

#### P0 — CRITICAL

| # | 问题 | 修复 | 文件 |
|---|------|------|------|
| 1 | **选区过期致内容错位** — 流式生成 5-30s 期间编辑器内容可能变化，旧 `{from,to}` 指向错误位置 | 发送时保存 `SelectionSnapshot`(text+from+to)，插入前 `isSelectionStillValid()` 验证，不匹配回退追加模式并通知用户 | `ai-creator-input.tsx`, `ai-creator-utils.ts`, `ai-creator.types.ts` |
| 2 | **空消息残留** — 网络错误/中断时预添加的空 assistant 消息留在历史，影响后续对话 | 新增 `removeLastEmptyAssistant()`，在 onError / handleStop / catch 三处调用 | `ai-creator-input.tsx` |

#### P1 — HIGH

| # | 问题 | 修复 | 文件 |
|---|------|------|------|
| 3 | **代码复制按钮失效** — 事件委托查找 `.code-copy-btn` 但渲染器从未生成该按钮 | `bubbleMarked` code renderer 追加 `<button class="code-copy-btn">` + SVG 图标，CSS 绝对定位右上角 hover 显示 | `ai-creator-message-item.tsx`, `.module.css` |
| 4 | **多轮对话上下文断裂** — 选区修改模式下，历史消息不含选区信息 | 构建 history 时注入截断的 `selectionContext`（≤200 字符） | `ai-creator-input.tsx` |
| 5 | **Stop 不清理** — 停止后截断内容或空消息留在对话中 | `handleStop` 调用 `removeLastEmptyAssistant()` | `ai-creator-input.tsx` |
| 6 | **onComplete 双重调用** — SSE `[DONE]` 路径和 reader done 路径都调用 onComplete | `let completed = false` 幂等标志，两路径互斥 | `ai-service.ts` |

#### P2 — MEDIUM

| # | 问题 | 修复 | 文件 |
|---|------|------|------|
| 7 | **历史消息无长度限制** — 恶意客户端可发巨量 content 导致 token 爆炸 | 每条 `content.slice(0, 10000)` + `typeof` 类型检查 | `ai.controller.ts` |
| 8 | **DOMPurify 允许任意 URI** — `<img src="https://evil.com/track">` 可追踪用户 | `ALLOWED_URI_REGEXP: /^(?:https?\|data):/i` | `ai-creator-message-item.tsx` |

#### P3 — LOW

| # | 问题 | 修复 | 文件 |
|---|------|------|------|
| 9 | **extractTitle 重复定义** — 同函数在两个文件中各一份 | 新建 `ai-creator-utils.ts` 提取共享函数 | `ai-creator-utils.ts`（新建）|
| 10 | **Jotai nullable atom 类型断言** — `_setX as` 模式重复 3+ 次 | 封装 `useTemplateAtom()` hook | `ai-creator-atoms.ts` |

### 新功能：粘贴图片

**需求**：用户在 AI 输入框中 `Ctrl+V` 直接粘贴截图/复制图片。

**实现**：

| 组件 | 改动 |
|------|------|
| `ai-creator-input.tsx` | `handlePaste` — 从 `clipboardData.files` 提取 `image/*`，验证大小/数量，截图重命名 `paste-{timestamp}.png` |
| `ai-creator-file-list.tsx` | 图片文件渲染 48×48 圆角缩略图（`useMemo` + `URL.createObjectURL`）；非图片保留芯片样式；hover 显示 × 关闭按钮 |
| `ai-creator.module.css` | `.fileThumb` / `.fileThumbImg` / `.fileThumbRemove` 样式 |

### 踩坑

#### 8. useMemo vs useRef 存储 ObjectURL

**现象**：粘贴图片后缩略图显示为空白/破碎图标。

**原因**：最初用 `useRef` + `useEffect` 创建 objectURL，但 `useEffect` 在渲染后执行，首次渲染时 `urlsRef.current` 还是空数组。且 ref 变更不触发重渲染，永远看不到图片。

**解决**：改用 `useMemo` 同步创建 URL（渲染时即可用），`useEffect` 仅负责清理旧 URL。

```typescript
// ❌ 错误：useRef + useEffect，首次渲染时 URL 为空
const urlsRef = useRef<string[]>([]);
useEffect(() => {
  urlsRef.current = files.filter(isImage).map(f => URL.createObjectURL(f));
}, [files]);
// render: <img src={urlsRef.current[i]} />  ← 空！

// ✅ 正确：useMemo 同步创建，渲染时立即可用
const imageUrls = useMemo(() => {
  const map = new Map<number, string>();
  files.forEach((file, i) => {
    if (isImageFile(file)) map.set(i, URL.createObjectURL(file));
  });
  return map;
}, [files]);
// render: <img src={imageUrls.get(i)} />  ← 有值！
```

### 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `ai-creator-utils.ts` | **新建** | 共享工具函数（extractTitle, stripTimestamp, isSelectionStillValid） |
| `ai-creator-atoms.ts` | 修改 | 新增 `useTemplateAtom` hook |
| `ai-creator.types.ts` | 修改 | 新增 `SelectionSnapshot` 接口 |
| `ai-creator-input.tsx` | 修改 | 选区快照验证、错误清理、历史上下文、粘贴图片 handlePaste |
| `ai-creator-message-item.tsx` | 修改 | 代码复制按钮、DOMPurify URI 限制、使用共享 utils |
| `ai-creator-file-list.tsx` | 修改 | 图片缩略图预览（useMemo + ObjectURL） |
| `ai-creator.module.css` | 修改 | 代码复制按钮样式 + 缩略图样式 |
| `ai-service.ts` | 修改 | onComplete 幂等保护 |
| `ai.controller.ts` | 修改 | 历史消息长度限制 |

### 设计文档

- `docs/plans/2026-03-03-ai-creator-bugfix-design.md` — 审计结果与修复设计
- `docs/plans/2026-03-03-ai-creator-bugfix-impl-plan.md` — 分步实施计划
