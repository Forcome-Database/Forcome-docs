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
