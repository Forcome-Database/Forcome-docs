# AI 多模型分级配置 & 图片感知 RAG 优化

> 分支：`fix-askai`
> 日期：2026-03-02

## 一、概述

本次优化实现了 AI 多模型分级配置，并修复了图片描述向量管线和 RAG 回答中的图片引用问题。

### 核心目标

| 优化点 | 之前 | 之后 |
|-------|------|------|
| 模型分级 | 所有任务共用 `AI_COMPLETION_MODEL` | 按用途分配：主模型/轻量模型/视觉模型 |
| 图片感知 | AI 完全不知道文档中有图片 | VLM 自动描述图片，RAG 回答内联展示 |
| 成本优化 | rerank/前缀生成消耗昂贵模型 | 低价值任务使用 gpt-5-mini |
| 图片展示 | 无 | 回答中用 `![alt](url)` 格式直接渲染图片 |

---

## 二、环境变量配置

### 新增变量

| 变量 | 用途 | 未配置时回退 |
|------|------|-------------|
| `AI_LITE_MODEL` | 上下文前缀生成、LLM rerank | → `AI_COMPLETION_MODEL` |
| `AI_VLM_MODEL` | 图片描述（VLM captioning） | → `AI_COMPLETION_MODEL` |
| `AI_VLM_DRIVER` | VLM 使用的 API 提供商 | → `AI_DRIVER` |

### 推荐 .env 配置

```env
# AI 驱动（统一走代理）
AI_DRIVER=openai-compatible
OPENAI_API_URL=http://74.211.105.94:3008/v1
OPENAI_API_KEY=sk-xxx

# 主模型：AI 创作面板、RAG 问答
AI_COMPLETION_MODEL=gpt-5.2

# 轻量模型：上下文前缀 + LLM rerank（低成本）
AI_LITE_MODEL=gpt-5-mini

# 视觉模型：图片描述
AI_VLM_MODEL=gemini-3-flash-preview
# VLM 专用驱动（代理支持时无需设置，会回退到 AI_DRIVER）
# AI_VLM_DRIVER=gemini

# 向量嵌入
AI_EMBEDDING_MODEL=text-embedding-3-small
AI_EMBEDDING_DIMENSION=1536

# 专用 Rerank（可选）
AI_RERANK_MODEL=gpt-5-nano
AI_RERANK_API_URL=http://74.211.105.94:3008/v1
```

### 降级矩阵

所有新变量都有回退，**不配置时行为完全不变**，零破坏性。

---

## 三、修改文件清单

### 1. `apps/server/src/integrations/environment/environment.validation.ts`

新增 3 个可选环境变量验证：`AI_LITE_MODEL`、`AI_VLM_MODEL`、`AI_VLM_DRIVER`。

### 2. `apps/server/src/integrations/environment/environment.service.ts`

新增 3 个 getter 方法（含回退逻辑）：
- `getAiLiteModel()` → `AI_LITE_MODEL || AI_COMPLETION_MODEL`
- `getAiVlmModel()` → `AI_VLM_MODEL || AI_COMPLETION_MODEL`
- `getAiVlmDriver()` → `AI_VLM_DRIVER || AI_DRIVER`

### 3. `apps/server/src/ee/ai/services/ai-search.service.ts`

**模型层重构：**
- 提取 `buildLanguageModel(driver, modelName)` 私有方法消除重复
- 新增 `getLiteModel()`（AI_DRIVER + AI_LITE_MODEL）
- 新增 `getVlmModel()`（AI_VLM_DRIVER + AI_VLM_MODEL）
- `getCompletionModel()` 重构为调用 `buildLanguageModel`

**上下文前缀恢复 LLM 调用：**
- `generateContextPrefix()` 从零成本模板恢复为 LLM 调用（使用 lite model）
- 失败时自动回退到模板 `本段来自《标题》`

**LLM Rerank 改用轻量模型：**
- `rerankWithLLM()` 从 `getCompletionModel()` 改为 `getLiteModel()`

**RAG 管线图片感知重构（answerWithContext）：**
- 获取当前页面时额外查 `content` 列（ProseMirror JSON）
- 用 `prosemirrorToTextWithImages()` 将 ProseMirror JSON 转成带内联图片 markdown
- 图片使用绝对路径 `${APP_URL}/api/files/{attachmentId}/{fileName}`
- 图片描述从 `page_embeddings.metadata` 获取，附在图片 markdown 之后
- 系统提示词：引导模型保留 `![描述](链接)` 格式，使图片在回答中直接渲染
- 来源引用优化：单来源时不标 `[N]`，多来源时才要求标注

**用户上传图片格式修复：**
- 从 `data:mime;base64,xxx` 字符串改为 `Buffer + mimeType` 对象（与 AI SDK 兼容）

### 4. `apps/server/src/ee/ai/ai-queue.processor.ts`

**VLM 图片描述修复：**
- 模型从 `getCompletionModel()` 改为 `getVlmModel()`
- 图片传递格式从 data URI 字符串改为 `Buffer + mimeType`（修复 AI SDK 兼容性）
- VLM 失败时 **fallback 到文件名/alt 文本**，仍然生成 embedding（不再静默跳过）
- 添加关键诊断日志：
  - `Found N images in page xxx`
  - `Calling VLM for image xxx (filename, size bytes)`
  - `VLM caption success / failed`
  - `Using cached description / Using fallback description`

### 5. `apps/server/src/ee/ai/utils/content-extractor.ts`

新增 `prosemirrorToTextWithImages()` 函数：
- 递归遍历 ProseMirror JSON 节点
- 文本节点 → 原文
- 图片节点 → `![alt](absoluteUrl)\n（描述）\n`
- 保留标题、列表、引用、代码块等结构
- 接受 `imageDescriptions` Map 参数，将 VLM 描述内嵌到图片 markdown 之后

### 6. `.env`

- 新增 `AI_LITE_MODEL=gpt-5-mini`、`AI_VLM_MODEL=gemini-3-flash-preview`
- 全中文注释，按功能分组（应用/数据库/存储/邮件/AI/Wiki/钉钉/其他）

---

## 四、模型调用点全景

| 调用场景 | 使用的模型 | 代码位置 |
|---------|-----------|---------|
| AI 创作面板 | `AI_COMPLETION_MODEL` (gpt-5.2) | `ai.service.ts` |
| RAG 问答 (streamText) | `AI_COMPLETION_MODEL` (gpt-5.2) | `ai-search.service.ts → answerWithContext()` |
| 上下文前缀生成 | `AI_LITE_MODEL` (gpt-5-mini) | `ai-search.service.ts → generateContextPrefix()` |
| LLM Rerank | `AI_LITE_MODEL` (gpt-5-mini) | `ai-search.service.ts → rerankWithLLM()` |
| 图片描述 (VLM) | `AI_VLM_MODEL` (gemini-3-flash-preview) | `ai-queue.processor.ts → upsertPageEmbedding()` |
| 向量嵌入 | `AI_EMBEDDING_MODEL` (text-embedding-3-small) | `ai-search.service.ts → generateEmbedding()` |
| 专用 Rerank API | `AI_RERANK_MODEL` (gpt-5-nano) | `ai-search.service.ts → rerankWithModel()` |

---

## 五、踩坑记录

### 1. AI SDK 图片格式

**问题**：`{ type: 'image', image: 'data:image/png;base64,xxx' }` 通过 `openai-compatible` 提供商发送时，部分模型无法正确解析 data URI 字符串。

**解决**：改用 `Buffer` + `mimeType` 格式传递：
```typescript
// 修复前（不可靠）
{ type: 'image', image: `data:${mimeType};base64,${base64}` }

// 修复后（与 AI SDK 完全兼容）
{ type: 'image', image: imageBuffer, mimeType }
```

### 2. VLM 失败导致图片 embedding 丢失

**问题**：旧代码中 VLM 调用失败时 `continue` 直接跳过，不生成任何 embedding。图片对搜索系统"不存在"。

**解决**：VLM 失败时 fallback 到文件名/alt 文本作为基础描述，仍然生成 embedding。

### 3. 图片与文本分离导致顺序错乱

**问题**：图片单独列在一个区块 `[N] (当前页面包含 8 张图片):`，AI 不知道每张图对应哪一步，导致回答中图片位置混乱。

**解决**：用 `prosemirrorToTextWithImages()` 将 ProseMirror JSON 直接转成带内联图片的 markdown。图片保留在文档原始位置，AI 自然知道图文对应关系。

### 4. 图片相对路径无法加载

**问题**：`![img](/api/files/xxx/img.png)` 在聊天面板中无法解析相对路径。

**解决**：使用 `environmentService.getAppUrl()` 拼成绝对路径 `http://localhost:3000/api/files/xxx/img.png`。

### 5. 单来源时冗余引用标记

**问题**：系统提示词要求 AI 标注 `[N]` 来源编号，当只有一个来源时每段都标 `[1]`，视觉噪音大。

**解决**：只有多来源（idx > 2）时才要求标注 `[N]`。

---

## 六、验证方式

1. **模型分级**：`pnpm dev` 启动无报错，观察日志中不同任务使用的模型名
2. **VLM 图片描述**：编辑含图片的页面 → 日志中出现 `Found N images` + `VLM caption success`
3. **RAG 图片展示**：Wiki 问答提问"用截图告诉我怎么配置" → 回答中图片内联渲染，位置与文档一致
4. **来源引用**：单来源时无 `[1]` 标记，多来源时正常标注
5. **降级测试**：删除 `AI_LITE_MODEL` 和 `AI_VLM_MODEL` → 回退到 `AI_COMPLETION_MODEL`，功能正常
