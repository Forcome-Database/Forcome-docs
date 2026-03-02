# Wiki AI 知识问答板块渐进式重构设计

**日期**：2026-03-02
**方案**：方案 A — 渐进式重构
**状态**：已批准

---

## 一、目标

在保持现有架构骨架的前提下，分阶段修复 wiki AI 问答板块的关键问题：
- 清理死代码，拆分巨石组件
- 实现多轮对话上下文
- 改善来源引用展示
- 添加推荐问题
- 优化后端 RAG 质量（阈值 + Prompt 语言）

## 二、问题清单（按优先级）

### P0 — 关键
1. **无多轮对话上下文**：前端只发单次 query，后端无历史消息，AI 无法理解追问
2. **死代码 ~700 行**：`useAIChat()` 函数体 + `AIChatMessage.vue` 完全未使用

### P1 — 高
3. **AIChat.vue 巨石组件**：1069 行 SFC，逻辑/样式耦合
4. **来源引用混入回答**：以原始 markdown 追加到 AI 回答末尾，视觉不突出
5. **向量搜索无相关性阈值**：始终返回 top-5，即使全部不相关
6. **Prompt 固定英文**：与中文文档内容不匹配

### P2 — 中
7. **无推荐问题**：首次打开仅静态欢迎语
8. **清空历史用 `confirm()`**：浏览器原生弹窗，与设计不一致
9. **流式中止无 UI 按钮**

## 三、设计决策

### 3.1 多轮对话

**前端**：发送最近 N 条消息历史（默认 10 条，约 4000 token 上限）

```typescript
// 请求体扩展
interface AiAnswerRequest {
  query: string
  pageSlugId?: string
  history?: { role: 'user' | 'assistant'; content: string }[]  // 新增
}
```

**后端**：将 history 注入 prompt 的 messages 数组（改 `streamText({ prompt })` 为 `streamText({ messages })`）

```typescript
// ai-search.service.ts
const messages = [
  { role: 'system', content: systemPrompt + '\n\nContext:\n' + context },
  ...history,  // 前端传来的历史消息
  { role: 'user', content: query }
]
const result = streamText({ model, messages })
```

**历史裁剪策略**：前端发送前按 token 估算裁剪，保留最近的消息优先。

### 3.2 来源引用卡片化

**现状**：sources 作为 markdown 文本追加到 `assistantMessage.content` 末尾

**改为**：
- `sources` 作为独立数据存储在 `ChatMessage` 的新字段 `sources?: AiSource[]`
- UI 以可折叠的引用卡片组件渲染在消息下方
- 不再污染 AI 回答文本内容

```typescript
interface ChatMessage {
  // ...existing
  sources?: { title: string; slugId: string; spaceSlug: string }[]  // 新增
}
```

### 3.3 推荐问题

基于当前页面 title 生成 3 个静态快捷问题模板：
- "这个页面讲了什么？"
- "帮我总结 {pageTitle} 的要点"
- "有什么相关的文档？"

点击后自动填入输入框并发送。

### 3.4 向量搜索阈值

```sql
WHERE pe."workspaceId" = ${workspaceId}
  AND p.deleted_at IS NULL
  AND (pe.embedding <=> ${embeddingStr}::vector) < 0.8  -- 新增阈值
ORDER BY distance ASC
LIMIT ${limit}
```

阈值 0.8 为 L2 距离初始值，后续可根据实际效果调优。

### 3.5 Prompt 语言跟随

检测 query 中是否包含中文字符，自动选择 prompt 模板：

```typescript
const isChinese = /[\u4e00-\u9fa5]/.test(query)
const systemPrompt = isChinese
  ? '根据以下文档内容回答用户的问题。如果文档中没有足够的信息，请如实说明。'
  : 'Answer the question based on the provided documentation context. If insufficient, say so.'
```

### 3.6 组件拆分

```
AIChat.vue (1069 行) → 拆分为：
├── composables/useAIChatPanel.ts    — 面板开关/状态/历史管理
├── composables/useAIChatSend.ts     — 消息发送/流式处理/abort
├── components/AIChat.vue            — 纯 UI 容器（~150 行）
├── components/AIChatSources.vue     — 来源引用卡片
├── components/AIChatWelcome.vue     — 欢迎页 + 推荐问题
└── styles/ai-chat.css               — 独立样式文件
```

删除：
- `useAIChat.ts` 中的 `useAIChat()` 函数体（保留工具函数导出）
- `AIChatMessage.vue` 整个文件

## 四、不做的事情（YAGNI）

- 不引入对话持久化（DB 表）— localStorage 够用
- 不实现文本分块（chunking）— 留给方案 B
- 不做混合搜索（vector + tsvector）— 留给方案 B
- 不做 i18n — 当前仅中文用户
- 不做面板拖拽调宽 — 低优先级
- 不做消息反馈（thumbs up/down）— 需产品定义

## 五、影响范围

### 前端（wiki）
| 文件 | 操作 |
|------|------|
| `composables/useAIChatPanel.ts` | **新建** — 面板状态管理 |
| `composables/useAIChatSend.ts` | **新建** — 消息发送逻辑 |
| `components/AIChat.vue` | **重写** — 瘦身为纯 UI |
| `components/AIChatSources.vue` | **新建** — 来源卡片 |
| `components/AIChatWelcome.vue` | **新建** — 欢迎页 + 推荐 |
| `styles/ai-chat.css` | **新建** — 抽离样式 |
| `composables/useAIChat.ts` | **修改** — 删除 useAIChat() 函数体 |
| `components/AIChatMessage.vue` | **删除** |
| `services/docmost.ts` | **修改** — aiAnswers 增加 history 参数 |
| `types/index.ts` | **修改** — ChatMessage 增加 sources 字段 |

### 后端
| 文件 | 操作 |
|------|------|
| `core/public-wiki/dto/public-wiki.dto.ts` | **修改** — DTO 增加 history 字段 |
| `core/public-wiki/public-wiki.controller.ts` | **修改** — 传递 history |
| `core/public-wiki/public-wiki.service.ts` | **修改** — 传递 history |
| `ee/ai/services/ai-search.service.ts` | **修改** — prompt→messages，加阈值，加语言检测 |

### 不变
- 数据库 schema（无迁移）
- VitePress 路由拦截逻辑
- Dify 服务（保留但不改动）
- useContentProcessor.ts
- markdown.ts / useCodeCopy.ts
