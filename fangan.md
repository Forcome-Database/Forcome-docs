# AI 写作系统问题诊断与解决方案探索记录

**日期：** 2026-03-26
**上下文：** 本文档记录了 Docmost AI 写作模块的完整问题诊断过程、代码追踪结果、已尝试的修复及其效果、以及对下一步方案的探索发现。供后续对话窗口作为上下文使用。

---

## 一、用户反馈的核心问题

1. **上传文档后内容混乱** — 生成的文章内容与原文不匹配，缺少内容，图片位置错乱
2. **外链写作内容被截断** — 导航栏、页头页脚等脏数据被写入文档
3. **AI 写作面板 UI 凌乱** — 所有卡片同时展示，用户不知道在哪步
4. **Agent 工作流不透明** — 用户不知道 Agent 在做什么、为什么这样选择
5. **Agent 似乎没有真正感知文档内容** — 这是用户反复强调的核心感受

---

## 二、系统架构现状（代码追踪结果）

### 2.1 两条 AI 写作路径

系统存在两条完全不同的 AI 写作路径：

**路径 A：NestJS 直接调用 LLM（`/api/ai/creator/generate`）**
```
前端 → NestJS AiController.creatorGenerate → AiService.streamWithContext → LLM
```
- 文件通过 `AiFileService.processBufferedFiles` 处理（使用 `pdf-parse` 提取纯文本）
- 丢失所有图片、表格、布局信息
- **当前文件上传已在此路径被禁用**（controller 中 `throw BadRequestException('File attachments must use the MinerU-backed agent document task flow.')`）

**路径 B：Python Agent Service（`/api/agent/run`）**
```
前端 → NestJS AgentGatewayController → Python Agent Service → DocumentTaskEngine → OrchestratorEngine
```
- 文件通过 MinerU 解析（`parse_assets_tool` → `parse_document` → `_parse_with_mineru`）
- 图片通过 `upgrade_source_image_assets` 上传到 Docmost
- 文本和图片引用通过 `_build_text_asset_context` 传给 LLM

### 2.2 前端路由决策（`ai-intent.ts`）

```typescript
// 文件上传 → 强制 agent 模式
if (params.files.length > 0) {
  effectiveMode: "agent"  // → 路径 B
}

// URL 引用 → 原来依赖 agentMode 开关（已修复为强制 agent）
if (hasReferenceUrl(params.prompt)) {
  effectiveMode: "agent"  // 修复后
}

// 其他情况 → 取决于 agentMode 开关
effectiveMode: params.agentMode ? "agent" : "standard"
```

### 2.3 Agent Service 内部路由（`document_task_engine.py`）

```python
def run(request):
    workflow = resolve_workflow(request)  # 基于 document_task.task_type

    if workflow == "preservation_patch":
        → _execute_preservation_patch(request)  # 当前文档优化走这条路

    if len(request.files) >= 2:
        → _execute_level3(request)  # 多文档综合

    # 否则按复杂度分析
    complexity = analyze_task_complexity(...)
    if complexity["level"] <= 2:
        → _execute_level2(request)
    else:
        → _execute_level3(request)
```

### 2.4 文档解析管道（当前状态）

```
PDF 文件 (base64)
    ↓
MinerU 云端 API (mineru.net)
    ↓ 上传 → 轮询 → 下载 ZIP
ZIP 包含:
    - full.md (文档完整 markdown，含图片引用 ![](images/xxx.jpg))
    - content_list.json (29 个内容块，含 bbox 坐标)
    - images/ (8 张 JPG 图片)
    ↓
parse_mineru_zip() → DocumentParseResult
    - text: full.md 的内容 (1337 字符 / 312 词)
    - images: 8 个 SourceImagePayload (含 b64、caption、bbox)
    - structure: 标题结构
    ↓
_asset_map_from_parsed_document() → AssetMap
    - items: 14 个 AssetItem (5 text + 8 image + 1 heading_structure)
    - source_markdown: full.md 内容 (1337 字符)
    - source_word_count: 312
    ↓
parse_assets_tool() 后处理:
    - upgrade_source_image_assets: 上传图片到 Docmost → 获取 URL
    - _rewrite_text_asset_image_refs: text items 中的图片引用替换为 URL
    - _rewrite_source_markdown_image_refs: source_markdown 中的引用替换
    ↓
_build_text_asset_context(asset_map) → 传给 LLM 的上下文字符串
    - 优先使用 source_markdown (含图片 URL)
    - 回退使用 text + table + code items 拼接
```

### 2.5 实际测试数据（来自 debug 日志）

测试文件：`clash配置教程.pdf`（base64 长度 1087420，约 800KB）

**MinerU 返回的 ZIP 内容：**
- `full.md`: 2083 bytes / 1337 chars / 60 lines
- `content_list.json`: 7834 bytes / 29 items
- 8 张 JPG 图片（15KB-70KB 不等）

**full.md 内容摘要：**
```
# PC 端下载地址:
https://74.211.105.94:36322/down/ld8HmZ9QvLls.7z
安卓手机端下载地址：
https://74.211.105.94:36322/down/exaZJh95IHmp.apk
# 订阅地址：
http://74.211.105.94:3000/v2rayse_US_2.yaml
# PC 配置教程：
# 1、下载并完成安装
2、打开 Clash，进入"配置"选项...
![](images/xxx.jpg)
3、切换到"代理"选项...
![](images/yyy.jpg)
... (后续步骤)
自 日志        ← OCR 从截图中提取的 UI 文字噪音
设置
? 帮助
A 关于
```

**关键观察：**
- 原始 PDF 是一份 Clash VPN 配置教程，包含 PC 端 4 步教程 + 重要提示 + 手机端 3 步教程
- PDF 以截图为主（8 张软件界面截图），文字层较少
- MinerU 成功提取了文字层（312 词）和 8 张图片
- **MinerU 没有丢失文字** — content_list.json 包含了文档中的所有文字内容
- **但文字总量确实只有 312 词** — 这是 PDF 本身的特点（图片密集型文档）
- full.md 末尾包含 OCR 噪音（从最后一张截图中提取的菜单文字）

---

## 三、已尝试的修复及其效果

### 3.1 已完成的安全修复（Plan 1，效果好）

| 修复 | 效果 |
|------|------|
| auth.py 空 secret 绕过 | 已验证修复 |
| IDOR 会话所有权验证 | 已验证修复 |
| task_id UUID 替代自增 | 已验证修复 |
| DTO MaxLength | 已验证修复 |
| 并发 Agent 任务限制 | 已验证修复 |
| SSE 超时保护 | 已验证修复 |

### 3.2 已完成的内容管道修复（Plan 2）

| 修复 | 实际效果 |
|------|---------|
| 移除 Docling，MinerU 默认启用 | MinerU 正常工作，但文档文字层少时提取内容有限 |
| Firecrawl 参数优化 (exclude_tags) | 未实测验证 |
| Trafilatura 二次清洗 | 未实测验证 |
| 图片去重 (content_hash) | 逻辑正确，未实测 |
| MinerU 断路器 | 逻辑正确 |
| asset_cache TTLCache | 逻辑正确 |

### 3.3 已完成的 Agent 工作流修复（Plan 3）

| 修复 | 实际效果 |
|------|---------|
| L3 研究分支修复 | 代码已修改，未实测 |
| researcher.py 异步修复 | 代码已修改，未实测 |
| engine.py 乱码修复 | 已验证修复 |
| routing_decision SSE 事件 | 代码已添加，前端可见 |
| Brief 质量门控 | 代码已添加，未实测 |
| Review 循环提取 | 代码已重构，engine.py 减少 180 行 |

### 3.4 已完成的 UI/UX 修复（Plan 4）

| 修复 | 实际效果 |
|------|---------|
| DocumentTaskHeader Badge 布局 | 已验证，面板中显示更紧凑 |
| 3 阶段指示器 | 已验证，面板显示 PREPARING > CONFIRMING > DELIVERING |
| TaskActivityFeed 人类可读 + 经过时间 | 已验证，显示"1m 21s"等 |
| 阶段感知卡片显隐 | 已验证生效 |
| i18n 修复 | 已验证修复 |

### 3.5 针对内容质量的修复尝试（效果不佳）

| 修复 | 尝试 | 实际效果 |
|------|------|---------|
| source_markdown 字段 | 在 AssetMap 中保存完整 markdown | **无效** — 合并时丢失（后已修复） |
| source_markdown 合并修复 | 合并循环中收集 md_parts | 修复后 source_markdown 正确传递 |
| _build_text_asset_context 改用 source_markdown | 优先使用完整 markdown | source_markdown 确实传给了 LLM |
| preservation_patch 直接插入 | 跳过 LLM，直接用 source_markdown | **无排版优化** — 用户期望优化 |
| preservation_patch 回退到 LLM | 禁用直接插入，用 LLM 优化 | LLM 收到 source_markdown 但**输出内容仍混乱** |
| VLM 图片描述富化 | 解析时调 VLM 为每张图生成描述 | VLM 调用成功（8 张图），但描述注入 source_markdown 后（23506 字符）**LLM 输出了图片描述而非格式化文档** |
| VLM 描述分离 | 不注入 source_markdown，作为独立段落 | LLM 仍然输出混乱内容，丢失图片引用 |
| prompt 优化 | 8 条明确规则（保留图片、不移动、不删除） | **仍然无效** — LLM 不遵循 prompt 要求 |

---

## 四、根本原因分析

### 4.1 当前管道的根本性缺陷

**核心问题：当前管道是"提取文字 → 发给文本 LLM"架构，这对图片密集型文档是灾难性的。**

1. **MinerU 提取的文字只有 312 词**（对一个 800KB、8 张截图的 PDF）— 这不是 MinerU 的 bug，而是 PDF 本身文字层就少
2. **LLM 只看到文字，看不到图片** — `simple_edit` 的 prompt 中只有文字和 `![](url)` 引用，LLM 不知道图片里是什么
3. **VLM 描述太详细（每张图 2000+ 字符）** — 注入后反而淹没了原始文字（312 词 vs 22000+ 词 VLM 描述），LLM 的注意力被 VLM 描述吸引
4. **prompt 工程无法根本解决问题** — 当 LLM 收到 23000 字符的 VLM 描述和 1337 字符的源文档时，无论怎么写 prompt，LLM 都倾向于基于 VLM 描述重新生成内容，而非保留原始文档结构
5. **图片无法在文本 LLM 中传递** — `![](url)` 对文本 LLM 只是一个字符串，LLM 不理解图片内容，无法判断图片应该放在哪里

### 4.2 simple_edit 的执行方式

`execute_simple_edit` 使用 PydanticAI Agent 调用 LLM。它接收的是纯文本 prompt（`build_simple_edit_prompt` 构建），其中 `asset_context` 是文本内容。LLM 是**文本模型**（非多模态），无法"看到"图片。

```python
# simple_edit.py 的 prompt 构建
parts.append(f"[Source Document Content]\n{request.asset_context.strip()}")
# asset_context 是纯文本/markdown 字符串，包含 ![](url) 引用
# 但 LLM 无法打开 URL 看图片
```

### 4.3 preservation_patch 的困境

用户说"请优化这个文档"时：
- `preservation_patch` 直接插入 → 无排版优化，用户不满意
- `preservation_patch` 通过 LLM → LLM 不理解图片，输出混乱
- 无论哪种方式，当前架构都无法满足需求

---

## 五、探索发现：多模态模型直接处理 PDF

### 5.1 核心发现

2025-2026 年的多模态模型（Gemini 3.1 Pro、GPT-5.4、Claude 4.6、Qwen 3.5）**原生支持 PDF 文件输入**。模型直接"看到"PDF 的每一页（文字 + 图片 + 布局），不需要预提取文字。

### 5.2 模型能力对比

| 能力 | Gemini 3.1 Pro | GPT-5.4 | Qwen 3.5 | MiniMax M2.7 |
|------|:---:|:---:|:---:|:---:|
| 直接接受 PDF | 3000 页 | ~1000 页 | 需转图片 | 不支持 |
| 上下文窗口 | 1M tokens | 1.05M | 256K | 200K |
| 每页 token | 258 | 未公开(高) | 按图片计 | N/A |
| 中文质量 | 好 | 一般 | 最强(阿里) | 强(中国) |
| 本地部署 | 不支持 | 不支持 | Apache 2.0 | 不支持 |
| Input $/1M | $2.00 | $2.50 | 免费(本地) | $0.30 |
| 文档理解 | MMMLU 92.6% | GDPval 83% | OmniDocBench 90.8 | 仅文本 |
| Vercel AI SDK | 官方支持 | 官方支持 | AI Gateway | 社区 |

### 5.3 新架构方案

```
新架构（替代当前 MinerU 管道）：

PDF (base64)
    ↓
直接发给多模态模型 (type: 'file', mimeType: 'application/pdf')
    ↓
模型"看到"完整页面（文字 + 图片 + 布局 + 表格）
    ↓
输出结构化 Markdown + 图片位置标记
    ↓
PyMuPDF 提取 PDF 中的嵌入图片 → 上传 Docmost → 替换标记
```

### 5.4 Vercel AI SDK v6 代码示例

Docmost 已安装 `@ai-sdk/google` 和 `@ai-sdk/openai`：

```typescript
import { generateText } from 'ai';
import { google } from '@ai-sdk/google';

const { text } = await generateText({
  model: google('gemini-3.1-pro-preview'),
  messages: [{
    role: 'user',
    content: [
      { type: 'text', text: '请优化这个文档的排版，保留所有内容...' },
      { type: 'file', data: pdfBuffer, mimeType: 'application/pdf' },
    ],
  }],
});
```

### 5.5 与当前管道的对比

| 维度 | 当前管道 | 新方案 |
|------|---------|--------|
| 步骤数 | 8+步（MinerU上传→轮询→下载→解析→分离→VLM→重写→LLM） | 2步（PDF→模型，图片提取→替换） |
| 处理时间 | 2+ 分钟 | ~10-30 秒 |
| 图片理解 | LLM 看不到图片内容 | 模型直接"看到"每张图 |
| 文字完整性 | 取决于 MinerU 提取质量 | 模型看到原始页面，不丢失 |
| 布局保持 | 丢失（文字被碎片化） | 模型看到原始布局 |
| 成本 | MinerU API + VLM×8 + LLM | 单次模型调用 |
| 依赖 | MinerU 云端 API + pybreaker + imagehash + trafilatura | Vercel AI SDK（已安装） |

---

## 六、当前代码状态

### 6.1 已修改的文件（本次会话）

**安全修复（已验证有效）：**
- `agent-service/app/middleware/auth.py` — 空 secret 绕过修复
- `agent-service/app/config.py` — 启动警告
- `agent-service/app/main.py` — task_id UUID
- `apps/server/src/ee/ai/dto/ai.dto.ts` — MaxLength
- `apps/server/src/ee/ai/agent-gateway/agent-gateway.service.ts` — IDOR + 并发限制
- `apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts` — IDOR + SSE 超时
- `apps/server/src/ee/ai/ai-internal.controller.ts` — assertInternalSecret 强化

**内容管道（架构层面正确，但未解决核心问题）：**
- `agent-service/app/tools/docling_parser.py` — 已删除
- `agent-service/app/workers/asset_parser.py` — Docling 代码移除 + 断路器
- `agent-service/app/orchestrator/tools/parse_assets.py` — TTLCache + 去重 + VLM 富化 + source_markdown 合并
- `agent-service/app/tools/firecrawl_scrape.py` — 参数优化 + Trafilatura
- `agent-service/app/tools/trafilatura_extract.py` — 新文件
- `agent-service/app/models/asset_map.py` — source_markdown 字段

**Agent 工作流：**
- `agent-service/app/orchestrator/engine.py` — 多处修改（L3修复、乱码、routing_decision、Brief验证、Review提取、_build_text_asset_context、preservation_patch 多次修改）
- `agent-service/app/workers/researcher.py` — 异步修复
- `agent-service/app/workers/mineru_parser.py` — debug 日志
- `agent-service/app/orchestrator/document_task_engine.py` — debug 日志
- `agent-service/app/orchestrator/review/review_loop.py` — 新文件
- `agent-service/app/schemas/response.py` — RoutingDecisionEvent

**前端 UI/UX：**
- `apps/client/src/ee/ai/services/ai-intent.ts` — URL 强制 agent 模式
- `apps/client/src/ee/ai/components/ai-creator/ai-creator-panel.tsx` — formatDocumentTaskMode
- `apps/client/src/ee/ai/components/ai-creator/document-task/DocumentTaskHeader.tsx` — Badge 布局
- `apps/client/src/ee/ai/components/ai-creator/document-task/TaskActivityFeed.tsx` — 可读标签 + 经过时间
- `apps/client/src/ee/ai/components/ai-creator/document-task/DocumentOperationCenter.tsx` — 阶段感知
- `apps/client/src/ee/ai/components/ai-creator/ai-creator-agent-steps.tsx` — i18n

### 6.2 当前 engine.py 中的 debug 日志

engine.py 和相关文件中存在大量 `print(f"[DEBUG ...]")` 语句，用于运行时追踪。这些在生产部署前需要清理或转为 `logger.debug()`。

### 6.3 Git 提交历史（本次会话）

共 39 个 commits，从 `cba990f` 到 `763f959`。可通过 `git log --oneline -40` 查看。

---

## 七、设计文档位置

- 总体设计：`docs/superpowers/specs/2026-03-26-ai-writing-comprehensive-improvement-design.md`
- 安全修复计划：`docs/superpowers/plans/2026-03-26-ai-security-critical-fixes-v2.md`
- 内容管道计划：`docs/superpowers/plans/2026-03-26-ai-content-pipeline-refactor.md`
- Agent 工作流计划：`docs/superpowers/plans/2026-03-26-ai-agent-workflow-refactor.md`
- UI/UX 计划：`docs/superpowers/plans/2026-03-26-ai-ui-ux-redesign.md`

---

## 八、下一步思考（仅供参考，非结论）

### 8.1 建议方向：多模态模型直传 PDF

当前 MinerU 管道的根本问题是**信息损失链太长**。每一步都在丢失信息：
- MinerU 提取 → 丢失图片内容语义（只有 bbox 和文件名）
- 碎片化 AssetItem → 丢失文档整体结构
- _build_text_asset_context → 只传文字，LLM 看不到图片
- LLM 重写 → 不理解图片，随意放置或丢弃

多模态模型直传 PDF 可以在**一步**完成全部理解，模型同时看到文字、图片、布局，输出会更一致。

### 8.2 实施路径建议

1. **最小改动方案**：在 NestJS 侧的 `AiService` 中，当模型支持 PDF 输入时（Gemini/GPT-5.4），将 PDF base64 直接作为 `type: 'file'` 发送，跳过 MinerU 管道。这只需要修改 NestJS 侧的文件处理逻辑。

2. **图片提取仍需要**：多模态模型可以"看到"图片但不能"导出"图片文件。仍需要 PyMuPDF（或类似工具）从 PDF 中提取嵌入图片并上传到 Docmost 存储，然后在模型输出的 markdown 中替换图片标记。

3. **渐进迁移**：可以先在 `preservation_patch`（文档优化）场景验证多模态直传效果，成功后再推广到其他场景。

4. **模型选择**：Gemini 3.1 Pro（3000 页、258 token/页、$2/1M）是 PDF 处理的最佳选择。Qwen 3.5（开源、中文最强）适合本地部署场景。

### 8.3 需要注意的问题

- Docmost 当前使用 Vercel AI SDK v6，`@ai-sdk/google` 和 `@ai-sdk/openai` 已安装（`^3.0.29`）
- `type: 'file'` content part 需要 SDK 和模型都支持
- 图片从模型输出中"回填"到 Docmost 页面的流程需要设计（模型输出 markdown 中的图片位置标记 → 提取 PDF 图片 → 上传 → URL 替换）
- 当前 Agent Service（Python）可以保留用于复杂工作流（多文档综合、Web 搜索等），但简单的"文档优化"可以完全在 NestJS 侧完成
- MinerU 可以保留作为不支持 PDF 输入的模型（如 Ollama 本地模型）的降级路径

### 8.4 当前 debug 日志的清理

engine.py、document_task_engine.py、parse_assets.py、mineru_parser.py、main.py 中的 `print(f"[DEBUG ...]")` 语句需要在方案确定后清理。建议转为 `logger.debug()` 或直接删除。

---

## 九、全面代码审查发现的其他问题

### 9.1 NestJS creatorGenerate 路径的问题

**文件：** `apps/server/src/ee/ai/ai.controller.ts`

1. **文件 buffer 后再拒绝（第 227-231 行）**：文件被完全读入内存后才抛 BadRequestException。应在检测到文件时提前拒绝，避免内存浪费。

2. **大纲指令硬编码中文（第 307 行）**：
   ```typescript
   systemPrompt += '\n\n重要：你现在只需要生成文档的结构化大纲...';
   ```
   非中文 locale 用户会看到中文指令混入 prompt。

3. **pageContent 截断无日志（第 297 行）**：`pageContent.slice(0, 8000)` 静默截断，大文档可能丢失关键上下文。

### 9.2 AiService 流格式不一致

**文件：** `apps/server/src/ee/ai/services/ai.service.ts`

**高优先级问题：** `streamWithFiles`（第 121、156 行）返回 `JSON.stringify({ content: chunk })`，但 `streamWithContext`（第 221 行）返回纯 `chunk` 字符串。调用者收到的数据格式不兼容，可能导致前端解析错误。

### 9.3 AiFileService 内容提取质量

**文件：** `apps/server/src/ee/ai/services/ai-file.service.ts`

1. **PDF 纯文本提取（第 30-31 行）**：使用 `pdf-parse`，扫描件返回空字符串。无日志记录。
2. **Word HTML 清洗过度（第 52-60 行）**：`<[^>]+>/g` 正则删除所有 HTML 标签，包括有意义的 `<a>`、`<code>`、`<table>`、`<strong>` 等。丢失语义结构。
3. **PowerPoint 不支持**：MIME 白名单允许 `.pptx`，但代码中无处理逻辑，静默跳过。

### 9.4 AiService 多模态兼容性

**文件：** `apps/server/src/ee/ai/services/ai.service.ts`

1. **无模型能力检查**：不同模型对多模态支持不同，但代码统一用同一格式发送图片。某些模型（如旧版 GPT）不支持图片输入但不会报错。
2. **图片数据格式未验证（第 134、202-204 行）**：假设 `part.data` 是 base64 但不验证。
3. **`getModel()` 当前只支持 4 种 provider**：openai、openai-compatible、google（gemini）、ollama。**不支持 anthropic（Claude）**。

### 9.5 内联改写缺少验证

**文件：** `apps/server/src/ee/ai/inline/inline-rewrite.service.ts`

1. `request.action` 被强制转型 `as AiAction`（第 22 行），无校验。无效 action 导致 undefined 行为。
2. 无 DTO 类和 `@ValidateNested()` 装饰器。

### 9.6 AI Creator Commit 流程的问题

**文件：** `apps/server/src/ee/ai/ai.controller.ts`（第 361-391 行）

1. **selectionSnapshot 验证缺陷**：`insertMode === 'replace'` 时应为必填，但标记 `@IsOptional()`。
2. **Markdown → ProseMirror 转换可能丢失格式**：AI 输出不标准 markdown 时，TipTap 解析可能失败。

### 9.7 图片引用渲染问题

**文件：** `apps/client/src/features/editor/extensions/attachment-image-canonicalizer.ts`

1. **URL 正则假设过严格（第 87 行）**：只匹配 `/files/{id}/{name}` 或 `/api/files/{id}/{name}`。完整 URL（如 `https://...`）或其他格式的引用不匹配，导致图片不显示。
2. **重名附件导致图片丢失（第 104-107 行）**：多个相同文件名时返回 `null`。

### 9.8 模板系统

1. **模板 prompt 大小无限制**：创建/更新时不检查大小，超大模板可能导致 token 溢出。
2. **默认模板硬编码中文**：`ai-templates.ts` 中 6 个默认模板提示词为中文。
3. **Mermaid 语法约束硬编码**：AI 不一定遵守，无后验证。

### 9.9 其他发现

1. **流中途错误**：SSE 流发送部分数据后 LLM 超时，客户端收到不完整内容。无 ERROR 事件标记。
2. **历史消息按数量截断**（`creator-generate.utils.ts` 第 30 行）：`.slice(-10)` 不考虑 token 大小，10 条长消息可能消耗大量 token。
3. **文档版本冲突**（`page.service.ts` 第 308-315 行）：`replace` 模式忽视版本变更，可能覆盖用户编辑。

---

## 十、问题全景图

```
┌────────────────────────────────────────────────────────────────┐
│                    AI 写作系统问题全景                          │
├────────────┬──────────────────────────┬─────────────────────────┤
│ 层级       │ 问题                     │ 影响                    │
├────────────┼──────────────────────────┼─────────────────────────┤
│            │ 文件 buffer 后再拒绝     │ 内存浪费                │
│ NestJS     │ 流格式不一致             │ 前端解析可能出错        │
│ 控制器层   │ PDF/Word 提取丢失语义    │ LLM 看不到完整内容      │
│            │ 多模态格式与模型不兼容   │ 图片可能无法传递        │
│            │ 大纲指令硬编码中文       │ 多语言用户受影响        │
├────────────┼──────────────────────────┼─────────────────────────┤
│            │ MinerU 文字提取不完整    │ ★核心：LLM 看不到完整文档│
│ Agent      │ 图片密集 PDF 文字少      │ ★核心：312词/800KB PDF  │
│ Service    │ simple_edit 是文本模型   │ ★核心：无法"看到"图片   │
│ (Python)   │ VLM 描述淹没原文         │ LLM 输出混乱            │
│            │ prompt 无法解决根本问题  │ 反复修 prompt 无效      │
│            │ engine.py 1150+ 行       │ 维护困难                │
├────────────┼──────────────────────────┼─────────────────────────┤
│            │ URL 强制 agent 模式(已修)│ URL 写作可以走 Agent    │
│ 前端路由   │ agentMode 开关影响路由   │ 非 agent 模式功能有限   │
│            │ 阶段感知卡片(已修)       │ UI 已改善               │
├────────────┼──────────────────────────┼─────────────────────────┤
│            │ selectionSnapshot 验证   │ replace 模式可能出错    │
│ Commit     │ Markdown→ProseMirror 转换│ 非标准 MD 可能丢格式    │
│ 流程       │ 图片 URL 正则过严格      │ 某些图片不显示          │
│            │ 版本冲突检查不完整       │ 可能覆盖用户编辑        │
├────────────┼──────────────────────────┼─────────────────────────┤
│ 安全       │ IDOR/auth/并发(已修)     │ 已修复                  │
│ (已修复)   │ DTO 验证/SSE 超时(已修)  │ 已修复                  │
└────────────┴──────────────────────────┴─────────────────────────┘

★ = 根本性架构问题，无法通过 prompt 工程或代码小修解决
```
