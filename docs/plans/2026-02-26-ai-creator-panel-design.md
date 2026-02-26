# AI 创作面板设计文档

> 日期：2026-02-26
> 状态：已批准

## 概述

在页面头部新增 **AI 创作** 按钮，点击后在右侧 Aside 面板中展开 AI 创作面板，支持三种智能模式：完全创作、编辑、对话。基于现有 Aside 面板框架（方案 A），复用 `asideStateAtom` 机制。

## 三种模式

### 创作模式（无选区时默认）
- 上传 PDF/Word/图片（最多 5 个，≤20MB/个）作为素材
- 选择内置模版或自由输入提示词
- AI 流式写入左侧编辑器（支持追加到末尾或覆盖整页）

### 编辑模式（有选区时默认）
- 显示选中文本预览
- 用户输入提示词，AI 流式替换选中内容

### 对话模式（有选区时可切换）
- 显示选中文本预览
- 用户输入提示词，AI 在面板内对话输出，不修改编辑器
- 消息支持「复制」和「插入到编辑器」操作

### 智能模式切换
- 编辑器无选区 → 自动进入创作模式
- 编辑器有选区 → 自动进入编辑模式，顶部显示 [编辑 | 对话] 切换
- 用户手动切换后锁定模式，直到选区清空

## 面板 UI 布局

```
┌─────────────────────────────┐
│ ✦ AI 创作              [×]  │  面板头部
├─────────────────────────────┤
│ [编辑 | 对话]               │  模式切换条（仅有选区时）
│ ┌─ 选中内容 ────────────┐  │  选区预览（仅编辑/对话）
│ │ "选中文本..."          │  │
│ └───────────────────────┘  │
│ ℹ 页面已有内容              │  上下文提示（仅创作+非空页）
│ [追加到末尾 ✓] [覆盖整页]   │
│                             │
│  [消息历史滚动区域]          │
│  ┌─ AI ─────────────────┐  │
│  │ 内容...               │  │
│  │ [📋 复制] [⤵ 插入]    │  │  消息操作（仅对话模式）
│  └──────────────────────┘  │
│                             │
├─────────────────────────────┤
│ 📎 file.pdf ×              │  文件列表（仅创作模式）
│ [模版 ▾]                    │  模版选择（仅创作模式）
│ ┌──────────────────────┐   │
│ │ 提示词...          [↑]│   │  输入框（始终显示）
│ └──────────────────────┘   │
└─────────────────────────────┘
```

## 数据流

```
创作模式: { files[], prompt, template? } → POST /api/ai/creator/generate (SSE)
                                           → 流式 insertContent 到编辑器
编辑模式: { selectedContent, prompt }     → POST /api/ai/generate/stream (复用)
                                           → 流式替换编辑器选区
对话模式: { selectedContent, prompt }     → POST /api/ai/generate/stream (复用)
                                           → 流式输出到面板消息列表
```

## 后端设计

### 新增端点

```
POST /api/ai/creator/generate  (SSE 流式，multipart/form-data)

请求字段：
  files[]: File[]         // PDF/Word/图片，最多5个，≤20MB
  prompt: string          // 用户提示词
  template?: string       // 模版名称
  pageId: string          // 当前页面 ID
  workspaceId: string     // 工作区 ID
  insertMode: string      // 'append' | 'overwrite'

响应：SSE 流
  data: {"content": "..."}\n\n
  data: [DONE]\n\n
```

### 文件处理策略

| 文件类型 | 处理方式 |
|---------|---------|
| PDF | base64 编码 → AI Provider 直接解析 |
| 图片 | base64 编码 → AI Provider 多模态 API |
| Word (.docx) | mammoth 提取 HTML → 转 Markdown → text content |

### 内置模版

| Key | 名称 | 用途 |
|-----|------|------|
| technical-doc | 技术文档 | 概述、架构、实现、部署 |
| meeting-notes | 会议纪要 | 概要、要点、决议、待办 |
| requirements | 需求分析 | 背景、目标、功能/非功能需求、验收 |
| report | 研究报告 | 摘要、背景、方法、结果、结论 |
| prd | 产品 PRD | 概述、用户故事、功能设计、技术要求 |
| custom | 自定义 | 用户自由描述格式 |

### 复用现有端点

编辑/对话模式复用 `POST /api/ai/generate/stream`，只是前端行为不同。

## 前端设计

### 新增组件

```
apps/client/src/ee/ai/components/ai-creator/
├── ai-creator-panel.tsx          # 面板主容器
├── ai-creator-input.tsx          # 输入区（输入框+上传+模版）
├── ai-creator-messages.tsx       # 消息列表
├── ai-creator-message-item.tsx   # 单条消息
├── ai-creator-selection.tsx      # 选中文本预览块
├── ai-creator-mode-switch.tsx    # [编辑|对话] 切换条
├── ai-creator-file-list.tsx      # 已上传文件列表
└── ai-creator-templates.tsx      # 模版下拉选择
```

### 新增状态 (Jotai Atoms)

```
ai-creator-atoms.ts:
  aiCreatorModeAtom         // 'create' | 'edit' | 'chat'
  aiCreatorModeLockAtom     // boolean - 用户手动锁定模式
  aiCreatorFilesAtom        // File[] - 上传文件
  aiCreatorTemplateAtom     // string | null - 选中模版
  aiCreatorSelectionAtom    // string - 编辑器选中文本
  aiCreatorMessagesAtom     // Map<pageId, Message[]> - 消息历史
  aiCreatorStreamingAtom    // boolean - 流式输出状态
```

### 修改文件

| 文件 | 改动 |
|------|------|
| aside.tsx | 新增 'ai-creator' tab 渲染 |
| page-header-menu.tsx | 新增 AI 创作按钮 |
| sidebar-atom.ts | tab 类型新增 'ai-creator' |
| ai-service.ts | 新增 creatorGenerate() 方法 |

## 增强功能

### 1. 撤销支持
- 创作/编辑模式：AI 写入的整块内容作为一个 undo 步骤，Ctrl+Z 一次撤销
- 编辑模式：替换前保存原始内容，撤销恢复原文

### 2. 生成中视觉反馈
- 编辑器内：AI 写入区域淡蓝色背景高亮（ProseMirror Decoration），完成后 CSS transition 消退
- 面板内：脉冲动画 + "AI 正在创作..."，完成显示 token 用量和耗时

### 3. 对话消息操作
- [📋 复制]：复制 Markdown 到剪贴板
- [⤵ 插入到编辑器]：Markdown → TipTap 节点，插入到当前光标位置

### 4. 上下文感知
- 创作模式检测页面是否有内容，显示 [追加到末尾 | 覆盖整页] 选择
- 自动附带页面标题和现有内容摘要（前500字）帮助 AI 衔接

## 依赖新增

| 包 | 位置 | 用途 |
|----|------|------|
| mammoth ^1.8.0 | apps/server | Word 文档提取 HTML |

## 功能矩阵

| 功能 | 创作 | 编辑 | 对话 |
|------|------|------|------|
| 文件上传 | ✓ | — | — |
| 模版选择 | ✓ | — | — |
| 选中文本预览 | — | ✓ | ✓ |
| 流式写入编辑器 | ✓ | ✓ | — |
| 面板内对话 | 状态反馈 | 状态反馈 | ✓ |
| 撤销支持 | ✓ | ✓ | — |
| 写入高亮 | ✓ | ✓ | — |
| 消息操作 | — | — | ✓ |
| 上下文感知 | ✓ | ✓ | ✓ |
| 停止生成 | ✓ | ✓ | ✓ |
