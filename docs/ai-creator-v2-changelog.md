# AI Creator v2 重构变更日志

> 本文档记录 AI Creator v2 的完整重构工作，作为后续测试和开发的上下文参考。
> 最后更新：2026-03-14

---

## 目录

1. [项目概述](#1-项目概述)
2. [架构变更](#2-架构变更)
3. [完整文件清单](#3-完整文件清单)
4. [核心模块说明](#4-核心模块说明)
5. [数据流](#5-数据流)
6. [结构化中间态](#6-结构化中间态)
7. [SSE 事件协议](#7-sse-事件协议)
8. [前端集成](#8-前端集成)
9. [API 端点](#9-api-端点)
10. [测试覆盖](#10-测试覆盖)
11. [已知限制与后续工作](#11-已知限制与后续工作)
12. [测试指南](#12-测试指南)

---

## 1. 项目概述

### 1.1 为什么重构

v1 AI Creator（基于 LangGraph）存在以下问题：

- **固定流水线**：LangGraph 的有向图（Planner → Researcher → Executor → Reviewer）无法根据任务复杂度动态调整
- **无长度控制**：生成内容经常远短于或远长于预期，没有字数预算机制
- **黑盒执行**：用户提交请求后只能等待最终结果，无法在中间环节（意图确认、结构审批、质量复查）介入
- **素材浪费**：上传文档被粗暴地全文拼接到 prompt 中，缺少结构化解析和素材复用追踪
- **无分段写作**：整篇文章一次性生成，长文（>3000 字）质量骤降

### 1.2 核心目标

1. **动态复杂度路由**：根据用户输入和上下文自动选择 L1/L2/L3 三条执行路径
2. **结构化中间态**：每个阶段产出可序列化的 Pydantic 模型（Brief, AssetMap, Blueprint, SectionDraft, ReviewReport）
3. **人机交互卡片**：在 Brief、Blueprint、Review 三个关键节点暂停，展示交互卡片让用户确认/修改后继续
4. **分段写作 + 字数预算**：按 Blueprint 中的章节计划逐段生成，每段有独立字数预算（±10% 容差），<80% 自动重试
5. **质量评审循环**：确定性检查 + LLM 评估 → 格式问题自动修复 → 内容问题展示给用户选择性修复

### 1.3 验收标准

- [ ] L1 路径（简单编辑）5-15 秒内完成，无中间交互
- [ ] L2 路径（中等创作）30-90 秒，展示 Brief 确认卡片 + Blueprint 确认卡片
- [ ] L3 路径（完整创作）2-5 分钟，完整 Brief → Blueprint → 分段写作 → Review 流程
- [ ] 每段字数偏差 ≤±10%（>80% 时不重试）
- [ ] 素材复用率 ≥80%（上传文档中的关键内容被引用到最终文章中）
- [ ] 610 个后端测试全部通过
- [ ] 前端交互卡片（SmartBriefCard, BlueprintModal, ReviewModal）正确渲染和交互

---

## 2. 架构变更

### 2.1 从 LangGraph 到 PydanticAI

| 维度 | v1（LangGraph） | v2（PydanticAI） |
|------|-----------------|------------------|
| 编排模式 | 固定有向图（9 个节点线性执行） | 1 个 Orchestrator + 6 个 Workers + 工具函数 |
| 状态管理 | LangGraph State 字典 | Pydantic BaseModel（CreationState） |
| LLM 调用 | 直接 langchain ChatModel | PydanticAI Agent + llm_factory |
| 人机交互 | 不支持 | asyncio.Event 暂停/恢复 |
| 复杂度路由 | 无（所有任务走同一流水线） | 确定性关键词分类器（L1/L2/L3） |
| 模型路由 | 单一模型 | ModelRole 枚举，支持按角色分配不同模型 |

### 2.2 Pattern B 架构

```
用户请求
    │
    ▼
┌─────────────────────────────────────────────────┐
│  OrchestratorEngine                             │
│  ┌──────────────────────────────────────────┐   │
│  │ analyze_task_complexity()                 │   │
│  │   → Level 1: _execute_level1()           │   │
│  │   → Level 2: _execute_level2()           │   │
│  │   → Level 3: _execute_level3()           │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
│  工具函数层（orchestrator/tools/）：              │
│    complexity, simple_edit, finalize,            │
│    parse_assets, create_brief, create_blueprint, │
│    write_tools, evaluate, fix_tools,             │
│    user_interaction, research,                   │
│    rewrite_section, merge_proposals              │
│                                                  │
│  Worker 层（workers/）：                         │
│    AssetParser, SectionWriter, VisualPlanner,   │
│    Evaluator, Fixer, Researcher,                │
│    StyleAnalyzer, ConsistencyChecker            │
└─────────────────────────────────────────────────┘
    │
    ▼ SSE 事件流
前端（ai-creator-message-item.tsx）
```

### 2.3 任务复杂度分级

| 级别 | 场景 | 预计耗时 | 执行路径 |
|------|------|----------|----------|
| Level 1 | 翻译、改错、精简、改语气等简单编辑 | 5-15 秒 | simple_edit → finalize |
| Level 2 | 排版、续写、扩展、单文件转换 | 30-90 秒 | parse_assets → brief → ask_user(brief) → blueprint → ask_user(blueprint) → simple_edit → finalize |
| Level 3 | 多文件综合、模板创作、从零撰写 | 2-5 分钟 | parse_assets → brief → ask_user(brief) → blueprint → ask_user(blueprint) → write_all_sections → save_draft → consistency_checks → evaluate → auto_fix → ask_user(review) → fix_selected → finalize |

**复杂度分类规则**（确定性，无 LLM 调用）：

1. `selection_edit` intent → L1
2. L1 关键词（无文件，无 L3 关键词覆盖）→ L1
3. 多文件（≥2）→ L3
4. 模板 + `document_create` intent → L3
5. L3 关键词（创作/仿写/撰写/生成等）→ L3
6. 单文件 → L2
7. L2 关键词（排版/续写/扩展等）→ L2
8. 默认 → L3

### 2.4 分段写作 + 滑动窗口

SectionWriter 为每个章节生成独立内容，上下文包括：
- **全局大纲**：所有章节标题（当前章节用 `>>>` 标记）
- **前一章节尾部**（prev_section_tail）：最后 200 字，用于衔接过渡
- **下一章节标题**（next_section_header）：让当前章节自然过渡到下一章节
- **素材分配**：Blueprint 中指定给该章节的 AssetItem
- **字数预算**：目标字数 ±10% 容差，<80% 时自动重试

### 2.5 质量评审

评审分两个阶段：

1. **确定性检查**（代码实现，不调用 LLM）：
   - 字数预算检查（每段字数 vs 预算）
   - 标题层级检查（子标题不能 ≤ 章节标题级别）
   - 素材复用率检查
   - 空段检查
   - 跨章节一致性检查（ConsistencyChecker）

2. **LLM 评估**（Evaluator Worker）：
   - 内容完整性评分
   - 风格一致性评分
   - 生成 ReviewIssue 列表

3. **修复流程**：
   - `auto_fixable` 问题 → Fixer 自动修复（标题层级、空 Mermaid、占位图片）
   - 其余问题 → ReviewModal 展示给用户 → 用户勾选需要修复的问题 → `fix_selected_issues` 针对性修复

---

## 3. 完整文件清单

### 3.1 Python 后端 — 新增文件

#### 数据模型（`agent-service/app/models/`）

| 文件 | 职责 |
|------|------|
| `__init__.py` | 统一导出所有模型类 |
| `brief.py` | `CreationBrief` — 智能创作简报 |
| `asset_map.py` | `AssetItem`, `AssetMap` — 素材地图 |
| `blueprint.py` | `VisualPlan`, `SectionPlan`, `CreationBlueprint` — 创作蓝图 |
| `draft.py` | `SectionDraft` — 章节草稿 |
| `review.py` | `ReviewIssue`, `ReviewReport` — 质量评审报告 |
| `events.py` | `StepEvent`, `ContentEvent`, `InteractionEvent`, `SectionProgressEvent`, `CompletionEvent`, `ComplexityEvent`, `SSEEvent` — SSE 事件模型 |
| `state.py` | `CreationState` — 统一状态容器 |

#### 编排器（`agent-service/app/orchestrator/`）

| 文件 | 职责 |
|------|------|
| `engine.py` | `OrchestratorEngine` — 核心编排引擎，L1/L2/L3 三条路径 |
| `llm_factory.py` | `create_pydantic_ai_model()` — PydanticAI 模型工厂，支持 OpenAI/Gemini/Ollama/OpenAI-compatible |
| `model_router.py` | `ModelRole`, `get_model_for_role()` — 按角色分配不同 LLM 模型 |
| `prompts.py` | `ORCHESTRATOR_SYSTEM_PROMPT` — 编排器系统提示词 |
| `sse_optimizer.py` | `SSEOptimizer` — SSE 事件批量优化（50ms 缓冲 + 心跳） |
| `draft_manager.py` | `DraftStore` — 草稿存储管理器（当前为内存实现） |

#### 编排器工具（`agent-service/app/orchestrator/tools/`）

| 文件 | 职责 |
|------|------|
| `__init__.py` | 包初始化 |
| `complexity.py` | `analyze_task_complexity()` — 确定性复杂度分类器 |
| `simple_edit.py` | `execute_simple_edit()` — L1 简单编辑（流式 LLM 调用） |
| `finalize.py` | `finalize_and_emit()` — 合并章节 + 发送 done 事件 |
| `parse_assets.py` | `parse_assets_tool()` — 调用 AssetParser Worker 解析上传文件 |
| `create_brief.py` | `generate_brief()` — LLM 分析生成 Smart Brief |
| `create_blueprint.py` | `generate_blueprint()` — LLM 规划生成 CreationBlueprint |
| `user_interaction.py` | `InteractionRegistry` — asyncio.Event 暂停/恢复机制 |
| `research.py` | `research_tool()` — 调用 Researcher Worker 进行搜索 |
| `write_tools.py` | `write_single_section()`, `write_all_sections()` — 按章节调度 SectionWriter |
| `evaluate.py` | `evaluate_quality()` — 调用 Evaluator Worker 进行质量评估 |
| `fix_tools.py` | `fix_selected_issues()` — 针对用户选择的问题进行 LLM 修复 |
| `rewrite_section.py` | `rewrite_section()` — 重写特定章节（用于修复） |
| `merge_proposals.py` | `merge_proposals()` — 合并修复提案到草稿中 |

#### Worker 层（`agent-service/app/workers/`）

| 文件 | 职责 |
|------|------|
| `__init__.py` | 包初始化 |
| `asset_parser.py` | AssetParser — 文档解析（Docling）+ 素材提取（标题/文本/表格/代码/Mermaid/图片） |
| `section_writer.py` | SectionWriter — 单章节生成，滑动窗口上下文，字数预算强制 |
| `visual_planner.py` | VisualPlanner — 确定性视觉建议（基于关键词匹配，无 LLM） |
| `evaluator.py` | Evaluator — 双阶段质量评估（确定性检查 + LLM 评分） |
| `fixer.py` | Fixer — 确定性自动修复（标题层级/空 Mermaid/占位图片）+ LLM 针对性修复 |
| `researcher.py` | Researcher — 统一搜索接口（Tavily/Firecrawl/Docmost RAG/Page Read） |
| `style_analyzer.py` | StyleAnalyzer — 工作区文档风格学习（段落长度/标题风格/术语） |
| `consistency_checker.py` | ConsistencyChecker — 跨章节一致性验证（标题层级/术语/交叉引用） |

#### 工具函数（`agent-service/app/utils/`）

| 文件 | 职责 |
|------|------|
| `text.py` | `count_words()` — 中英文混合字数统计；`count_words_by_section()` — 按 Markdown 标题分段统计 |

### 3.2 Python 后端 — 删除文件

#### 旧 LangGraph Agent（`agent-service/app/agent/`）

| 文件 | 说明 |
|------|------|
| `graph.py` | LangGraph 有向图定义 |
| `state.py` | LangGraph 状态定义 |
| `llm.py` | 旧 LLM 工厂 |
| `evidence.py` | 证据提取 |
| `document_strategy.py` | 文档策略 |
| `quality_checks.py` | 旧质量检查 |
| `nodes/*.py` | 全部 9 个节点文件（planner, researcher, executor, reviewer 等） |

> 注意：`agent-service/app/agent/events.py`（`emit` 函数）**保留**，v2 编排器仍使用它发送 SSE 事件。

### 3.3 前端 — 新增文件

#### 类型定义（`apps/client/src/ee/ai/types/`）

| 文件 | 职责 |
|------|------|
| `brief.types.ts` | `CreationBrief` 接口 |
| `blueprint.types.ts` | `VisualPlan`, `SectionPlan`, `CreationBlueprint`, `AssetItem`, `AssetMap` 接口 |
| `review.types.ts` | `ReviewSeverity`, `ReviewCategory`, `ReviewIssue`, `ReviewReport` 接口 |
| `draft.types.ts` | `SectionDraft`, `DraftState` 接口 |
| `events-v2.types.ts` | `StepEvent`, `ContentEvent`, `InteractionEvent`, `SectionProgressEvent`, `CompletionEvent`, `ComplexityEvent`, `SSEEventV2` 类型 |

#### 交互组件（`apps/client/src/ee/ai/components/ai-creator/`）

| 文件 | 职责 |
|------|------|
| `smart-brief/SmartBriefCard.tsx` | Smart Brief 确认卡片 — 展示受众、目标、字数、风格等，允许用户编辑后确认 |
| `blueprint/BlueprintModal.tsx` | Blueprint 审批弹窗 — 展示章节结构、字数预算、视觉计划，允许调整 |
| `review/ReviewModal.tsx` | Review 评审弹窗 — 展示质量问题列表，用户勾选需修复的问题 |
| `review/ReviewScoreBoard.tsx` | 评审记分板 — 总分、字数合规率、素材复用率 |
| `review/IssueCard.tsx` | 单个问题卡片 — 严重度、类别、描述、建议、是否自动修复 |
| `review/AutoFixSummary.tsx` | 自动修复摘要 — 显示已自动修复的问题数量 |
| `live-draft/DraftProgressBar.tsx` | 写作进度条 — 显示当前章节/总章节 |
| `live-draft/SectionNav.tsx` | 章节导航 — 章节列表快速跳转 |
| `live-draft/SectionActions.tsx` | 章节操作 — 对单个章节的操作按钮 |
| `draft-manager/DraftPanel.tsx` | 草稿管理面板 |
| `draft-manager/DraftMergeActions.tsx` | 草稿合并操作 |
| `common/LoadingSkeleton.tsx` | 加载骨架屏 |
| `input/AiCreatorInputV2.tsx` | v2 输入框组件 |

#### 服务（`apps/client/src/ee/ai/services/`）

| 文件 | 职责 |
|------|------|
| `draft-service.ts` | 草稿 API 客户端 — `getDraft()`, `getMergedDraft()`, `deleteDraft()` |

### 3.4 前端 — 修改文件

| 文件 | 变更内容 |
|------|----------|
| `ai-creator-message-item.tsx` | 新增 `BriefMessageItem`, `BlueprintMessageItem`, `ReviewMessageItem` 子组件，渲染交互卡片 |
| `ai-create-runner.utils.ts` | 新增 `normalizeV2Event()` v2 事件标准化 |
| `ai-create-session.messages.ts` | 新增 v2 message 工厂函数 |
| `agent.types.ts` | 新增 v2 await+resume 类型定义 |
| `ai-creator.types.ts` | 新增 v2 角色定义 |
| `ai-create-session.types.ts` | 新增 v2 phase 定义 |

### 3.5 前端 — 删除文件

| 文件 | 说明 |
|------|------|
| `ai-creator-clarify-bubble.tsx` | v1 澄清气泡（被 SmartBriefCard 替代） |
| `ai-creator-propose-bubble.tsx` | v1 提议气泡（被 BlueprintModal 替代） |
| `ai-creator-outline-bubble.tsx` | v1 大纲气泡（被 BlueprintModal 替代） |

### 3.6 NestJS Gateway

| 文件 | 变更内容 |
|------|----------|
| `agent-gateway.controller.ts` | 新增 `resume` 端点，run 端点增加 template/system prompt 解析 |
| `dto/agent-resume.dto.ts` | 新增 resume DTO |
| `agent-gateway.service.ts` | 保持不变 |
| `agent-gateway.module.ts` | 保持不变 |
| `agent-gateway.types.ts` | 保持不变 |
| `dto/agent-run.dto.ts` | 保持不变 |
| `dto/agent-stop.dto.ts` | 保持不变 |
| `agent-gateway.controller.spec.ts` | 控制器测试 |

---

## 4. 核心模块说明

### 4.1 OrchestratorEngine（`orchestrator/engine.py`）

**职责**：接收用户请求，分析复杂度，分发到对应的执行路径。

**输入**：`OrchestratorRequest` — 包含 `thread_id`, `user_message`, `page_content`, `selected_text`, `system_prompt`, `template_prompt`, `conversation_history`, `files`, `intent_route`, `template_id`, `insert_mode`, `workspace_id`, `page_id`。

**输出**：最终合并的内容字符串。

**关键方法**：
- `run(request)` — 入口，调用 `analyze_task_complexity()` 后分发
- `_execute_level1(request)` — simple_edit → finalize
- `_execute_level2(request)` — parse_assets → brief → ask(brief) → blueprint → ask(blueprint) → simple_edit → finalize
- `_execute_level3(request)` — 完整流水线，包含分段写作、一致性检查、评审、修复

### 4.2 InteractionRegistry（`orchestrator/tools/user_interaction.py`）

**职责**：基于 `asyncio.Event` 的暂停/恢复机制，让编排器在需要用户输入时暂停。

**关键方法**：
- `register(thread_id)` — 注册线程等待用户输入
- `wait_for_response(thread_id)` — 阻塞直到用户响应
- `submit_response(thread_id, data)` — 从 API 端点提交用户响应，唤醒等待的协程
- `cleanup(thread_id)` — 清理已完成的线程

**工作流**：
```
编排器: emit(await_input) → register() → wait_for_response() [阻塞]
API: POST /agent/resume → submit_response() [唤醒]
编排器: 继续执行
```

### 4.3 SectionWriter（`workers/section_writer.py`）

**职责**：为单个章节生成内容，维持跨章节连贯性。

**上下文包**：
- 全局大纲（所有章节标题，当前用 `>>>` 标记）
- 文档标题、目标受众、写作风格
- 前一章节尾部（最后 ~200 字）
- 下一章节标题
- 分配的素材（AssetItem）
- 视觉指令（Mermaid/图片 URL）
- 字数预算

**字数强制**：目标字数 ±10% 容差。如果生成内容 <80% 预算，自动重试。

### 4.4 Evaluator（`workers/evaluator.py`）

**职责**：双阶段质量评估。

**阶段 1 — 确定性检查**（无 LLM）：
- `check_word_budgets()` — 字数预算合规
- `check_heading_levels()` — 子标题层级合理性
- `check_asset_reuse()` — 素材复用率
- `check_empty_sections()` — 空段检测

**阶段 2 — LLM 评估**（可选）：
- 内容完整性
- 风格一致性

**输出**：`ReviewReport`，包含 `issues` 列表，每个 issue 标记 `auto_fixable`。

### 4.5 Fixer（`workers/fixer.py`）

**职责**：修复质量问题。

**确定性自动修复**（无 LLM）：
- `auto_fix_heading_levels()` — 修复子标题层级
- `auto_fix_empty_mermaid()` — 移除空 Mermaid 代码块
- `auto_fix_placeholder_images()` — 移除占位图片 URL（placehold.co, placeholder.com 等）

**LLM 针对性修复**：
- `fix_selected_issues()` — 根据用户勾选的问题，对特定章节进行 LLM 重写

### 4.6 AssetParser（`workers/asset_parser.py`）

**职责**：解析上传文档，提取结构化素材。

**解析管线**：
1. 通过 Docling 解析文档获取 Markdown
2. 提取标题结构（heading_structure）
3. 提取文本段落（text）
4. 提取表格（table）
5. 提取代码块（code）
6. 提取 Mermaid 图（mermaid）
7. 可选：通过 VLM 理解嵌入图片

**输出**：`AssetMap`，包含 `items` 列表和 `source_word_count`。

### 4.7 VisualPlanner（`workers/visual_planner.py`）

**职责**：基于关键词的确定性视觉建议，不调用 LLM。

**规则**：
- 流程/架构/步骤相关关键词 → 建议 Mermaid 图
- 对比/列表/参数相关关键词 → 建议表格
- 素材中有可复用图片 → 建议 reuse_image

### 4.8 ConsistencyChecker（`workers/consistency_checker.py`）

**职责**：写作完成后的跨章节一致性验证。

**检查项**：
- `check_heading_continuity()` — 标题层级连续性
- `check_term_consistency()` — 术语一致性
- `check_cross_references()` — 交叉引用有效性
- `check_empty_sections()` — 空章节检测

### 4.9 StyleAnalyzer（`workers/style_analyzer.py`）

**职责**：从工作区文档中学习写作风格。

**分析维度**：
- 段落长度分布（平均字数、短段、长段）
- 标题风格（名词短语 / 疑问句 / 操作指南）
- 正式度
- 常用术语

**输出**：`style_guide` 字符串，供 SectionWriter 使用。

### 4.10 DraftStore（`orchestrator/draft_manager.py`）

**职责**：草稿持久化存储（当前为内存实现）。

**关键方法**：
- `save_draft()` — 保存所有章节草稿
- `get_draft()` — 获取草稿
- `update_section()` — 更新单个章节
- `delete_draft()` — 删除草稿
- `get_merged_content()` — 合并所有章节为单个字符串

**键格式**：`{workspace_id}:{page_id}:{task_id}`

### 4.11 SSEOptimizer（`orchestrator/sse_optimizer.py`）

**职责**：减少 SSE 事件频率，防止代理超时。

**优化策略**：
- `content_delta` 事件缓冲 50ms 后合并发送
- `step_start`/`step_done` 事件先刷新缓冲区再立即发送
- 支持 15 秒心跳（防止代理/CDN 超时断连）

### 4.12 LLM Factory（`orchestrator/llm_factory.py`）

**职责**：根据配置创建 PydanticAI Model 实例。

**支持的 Provider**：
- `openai` — OpenAI 官方 API
- `gemini` — Google Gemini（GoogleModel + GoogleProvider）
- `ollama` — 本地 Ollama（自动追加 `/v1` 路径）
- `openai-compatible` — OpenAI 兼容接口（自定义 base_url）

### 4.13 ModelRouter（`orchestrator/model_router.py`）

**职责**：按角色分配不同 LLM 模型。

**角色**：`ORCHESTRATOR`, `WRITER`, `EVALUATOR`, `FIXER`, `BRIEF`, `BLUEPRINT`

**配置方式**：环境变量（如 `ORCHESTRATOR_MODEL=claude-sonnet-4-20250514`, `WRITER_MODEL=gpt-4o-mini`）。未配置时使用默认模型。

---

## 5. 数据流

### 5.1 Level 1 — 简单编辑

```
用户: "把这段翻译成英文"
    │
    ▼
OrchestratorEngine.run()
    │
    ├─ emit(step_start: analyze_complexity)
    ├─ analyze_task_complexity() → Level 1 (intent=selection_edit 或 L1 关键词)
    ├─ emit(step_done: "Complexity Level 1")
    │
    ├─ execute_simple_edit()
    │   ├─ 构建 prompt（system_prompt + template_prompt + page_content + selected_text + user_message）
    │   ├─ LLM 流式调用
    │   └─ emit(content_delta) × N（流式内容块）
    │
    └─ finalize_and_emit()
        ├─ 合并内容
        └─ emit(done, final_content=...)
```

**耗时**：5-15 秒
**交互点**：无

### 5.2 Level 2 — 中等创作

```
用户: "根据上传的文档写一篇总结" [附带 1 个文件]
    │
    ▼
OrchestratorEngine.run()
    │
    ├─ analyze_task_complexity() → Level 2 (单文件)
    │
    ├─ parse_assets_tool(files)
    │   └─ AssetParser.parse() → AssetMap
    │
    ├─ generate_brief(user_message, asset_map, ...)
    │   └─ LLM → CreationBrief
    │
    ├─ emit(ask_user, phase="brief", brief=...)  ◀── 暂停点 1
    │   └─ 前端渲染 SmartBriefCard
    │   └─ 用户确认/修改后 POST /agent/resume
    │
    ├─ generate_blueprint(user_message, brief, asset_map, ...)
    │   └─ LLM → CreationBlueprint
    │
    ├─ emit(ask_user, phase="blueprint", blueprint=...)  ◀── 暂停点 2
    │   └─ 前端渲染 BlueprintModal
    │   └─ 用户确认/修改后 POST /agent/resume
    │
    ├─ execute_simple_edit()（L2 当前仍用 simple_edit 作为写作器占位）
    │   └─ emit(content_delta) × N
    │
    └─ finalize_and_emit()
        └─ emit(done, final_content=...)
```

**耗时**：30-90 秒
**交互点**：Brief 确认、Blueprint 确认

### 5.3 Level 3 — 完整创作

```
用户: "根据这 3 个文档撰写一篇完整的技术方案" [附带 3 个文件]
    │
    ▼
OrchestratorEngine.run()
    │
    ├─ analyze_task_complexity() → Level 3 (多文件)
    │
    ├─ parse_assets_tool(files) → AssetMap
    │
    ├─ generate_brief() → CreationBrief
    │
    ├─ emit(await_input, phase="brief")  ◀── 暂停点 1
    │   └─ interaction_registry.register() → wait_for_response()
    │   └─ 用户确认后 → submit_response() 唤醒
    │   └─ 如果用户修改了 brief → 更新 CreationBrief
    │
    ├─ generate_blueprint() → CreationBlueprint
    │
    ├─ emit(await_input, phase="blueprint")  ◀── 暂停点 2
    │   └─ 用户确认后继续
    │
    ├─ write_all_sections()  ◀── 分段写作
    │   └─ 对每个 SectionPlan:
    │       ├─ generate_section_visuals()（AI 图片生成）
    │       ├─ emit(section_progress, current=i, total=N)
    │       ├─ write_section()（带滑动窗口上下文）
    │       └─ → SectionDraft
    │
    ├─ draft_store.save_draft()  ◀── 持久化草稿
    │
    ├─ run_consistency_checks()  ◀── 跨章节一致性
    │
    ├─ evaluate_quality()  ◀── 质量评估
    │   └─ 确定性检查 + LLM 评估 → ReviewReport
    │
    ├─ apply_auto_fixes()  ◀── 自动修复格式问题
    │
    ├─ （如有用户决策问题）
    │   ├─ emit(await_input, phase="review")  ◀── 暂停点 3
    │   │   └─ 前端渲染 ReviewModal
    │   │   └─ 用户勾选需修复的问题 → resume
    │   └─ fix_selected_issues()  ◀── 针对性修复
    │
    └─ finalize_and_emit()
        ├─ 合并所有章节（标题 + 内容）
        └─ emit(done, final_content=...)
```

**耗时**：2-5 分钟
**交互点**：Brief 确认、Blueprint 确认、Review 选择性修复

---

## 6. 结构化中间态

### 6.1 CreationBrief

```python
class CreationBrief(BaseModel):
    audience: str = ""            # 目标受众
    goal: str = ""                # 创作目标
    target_length: int = 0        # 目标字数
    length_tolerance: float = 0.1 # 字数容差（默认 ±10%）
    style: str = ""               # 写作风格
    tone: str = ""                # 语气基调
    structure_strategy: Literal[   # 结构策略
        "copy_source",            # 复制源文档结构
        "ai_recommend",           # AI 推荐结构
        "user_defined"            # 用户自定义
    ] = "ai_recommend"
    image_strategy: Literal[       # 图片策略
        "reuse_source",           # 复用源文档图片
        "generate_new",           # AI 生成新图片
        "mixed",                  # 混合
        "none"                    # 不使用图片
    ] = "mixed"
    constraints: list[str] = []   # 其他约束条件
```

### 6.2 AssetMap

```python
class AssetItem(BaseModel):
    id: str                       # 素材唯一 ID
    type: Literal["text", "image", "table", "code", "mermaid", "heading_structure"]
    source: str = ""              # 来源文件名
    content: str = ""             # 素材内容
    summary: str = ""             # 内容摘要
    suggested_usage: str = ""     # 建议用途
    reuse_decision: Literal["reuse", "adapt", "skip"] | None = None

class AssetMap(BaseModel):
    items: list[AssetItem] = []
    source_structure: list[dict] = []       # 源文档标题结构
    source_word_count: int = 0              # 源文档总字数
    source_section_counts: dict[str, int] = {}  # 源文档各章节字数
```

**辅助方法**：
- `items_by_type(type)` — 按类型筛选素材
- `reusable_items()` — 获取标记为 `reuse` 的素材

### 6.3 CreationBlueprint

```python
class VisualPlan(BaseModel):
    type: Literal["mermaid", "ai_image", "reuse_image", "table"]
    description: str = ""
    source_asset_id: str | None = None  # 关联素材 ID
    position: Literal["before_section", "after_paragraph", "end_of_section"] = "end_of_section"

class SectionPlan(BaseModel):
    id: str                        # 章节唯一 ID
    title: str                     # 章节标题
    level: int = 2                 # 标题级别（H2/H3 等）
    word_budget: int = 0           # 字数预算
    description: str = ""          # 章节描述
    assets: list[str] = []         # 分配的素材 ID 列表
    visuals: list[VisualPlan] = [] # 视觉元素计划
    must_cover: list[str] = []     # 必须覆盖的要点

class CreationBlueprint(BaseModel):
    title: str = ""                # 文档标题
    sections: list[SectionPlan] = []
    total_word_budget: int = 0     # 总字数预算
    style_guide: str = ""          # 风格指南
    visual_plan_summary: str = ""  # 视觉计划摘要
```

**辅助方法**：
- `section_by_id(id)` — 按 ID 查找章节
- `validate_word_budgets()` — 验证各章节预算之和 ≈ 总预算（±10%）

### 6.4 SectionDraft

```python
class SectionDraft(BaseModel):
    section_id: str            # 对应 SectionPlan.id
    content: str = ""          # 章节内容（Markdown）
    word_count: int = 0        # 实际字数
    budget_compliance: float = 1.0  # 字数合规率（实际/预算）
    assets_used: list[str] = []     # 实际使用的素材 ID
    visuals_generated: list[str] = []  # 生成的视觉元素 URL
```

### 6.5 ReviewReport

```python
class ReviewIssue(BaseModel):
    id: str                         # 问题唯一 ID（issue-{hex8}）
    section_id: str | None = None   # 关联章节 ID（None 表示全局问题）
    severity: Literal["error", "warning", "info"]
    category: Literal["length", "structure", "content", "style", "asset", "visual", "format"]
    description: str                # 问题描述
    suggestion: str = ""            # 修复建议
    auto_fixable: bool = False      # 是否可自动修复
    fixed: bool = False             # 是否已修复

class ReviewReport(BaseModel):
    overall_score: int = 0          # 总分（0-100）
    length_compliance: float = 0.0  # 字数合规率
    asset_reuse_rate: float = 0.0   # 素材复用率
    issues: list[ReviewIssue] = []
    auto_fixed_count: int = 0       # 已自动修复数量
    user_decision_needed: list[str] = []  # 需用户决策的问题 ID
```

**辅助方法**：
- `pending_issues()` — 未修复且非自动修复的问题
- `auto_fixable_issues()` — 可自动修复但尚未修复的问题

### 6.6 CreationState

```python
class CreationState(BaseModel):
    # 用户输入
    user_message: str = ""
    conversation_history: list[dict] = []
    uploaded_files: list[dict] = []
    template_id: str | None = None
    system_prompt: str | None = None
    template_prompt: str | None = None

    # 任务分析
    complexity_level: Literal[1, 2, 3] = 3

    # 结构化中间态
    brief: CreationBrief | None = None
    asset_map: AssetMap | None = None
    blueprint: CreationBlueprint | None = None
    section_drafts: list[SectionDraft] = []
    review_report: ReviewReport | None = None

    # 页面上下文
    page_id: str | None = None
    page_title: str | None = None
    page_content: str | None = None
    selected_text: str | None = None
    workspace_id: str = ""

    # 进度
    phase: str = "init"
    final_content: str = ""
    task_id: str = ""
    thread_id: str = ""
```

---

## 7. SSE 事件协议

### 7.1 事件类型总览

| 事件类型 | Pydantic 模型 | 方向 | 说明 |
|----------|---------------|------|------|
| `step_start` | `StepEvent` | Server → Client | 步骤开始（step_name + description） |
| `step_done` | `StepEvent` | Server → Client | 步骤完成（step_name + result_summary） |
| `content_delta` | `ContentEvent` | Server → Client | 流式内容块（chunk, 可选 section_id） |
| `content_cleared` | `ContentEvent` | Server → Client | 清除当前内容 |
| `await_user_input` / `await_input` | `InteractionEvent` | Server → Client | 暂停等待用户输入（phase + data） |
| `section_progress` | `SectionProgressEvent` | Server → Client | 章节写作进度（current/total + section_title） |
| `complexity_analyzed` | `ComplexityEvent` | Server → Client | 复杂度分析结果（level + reasoning） |
| `done` | `CompletionEvent` | Server → Client | 任务完成（final_content） |
| `error` | `CompletionEvent` | Server → Client | 任务出错（error_message） |
| `cancelled` | `CompletionEvent` | Server → Client | 任务已取消 |

### 7.2 InteractionEvent 详细

**phase="brief"**：
```json
{
  "type": "await_input",
  "phase": "brief",
  "data": {
    "audience": "技术团队",
    "goal": "撰写系统设计文档",
    "target_length": 3000,
    "length_tolerance": 0.1,
    "style": "technical",
    "tone": "professional",
    "structure_strategy": "ai_recommend",
    "image_strategy": "mixed",
    "constraints": []
  }
}
```

**phase="blueprint"**：
```json
{
  "type": "await_input",
  "phase": "blueprint",
  "data": {
    "title": "系统设计文档",
    "sections": [
      {
        "id": "sec-001",
        "title": "概述",
        "level": 2,
        "word_budget": 500,
        "description": "系统背景与目标",
        "assets": ["asset-a1"],
        "visuals": [],
        "must_cover": ["项目背景", "设计目标"]
      }
    ],
    "total_word_budget": 3000,
    "style_guide": "",
    "visual_plan_summary": ""
  }
}
```

**phase="review"**：
```json
{
  "type": "await_input",
  "phase": "review",
  "data": {
    "overall_score": 78,
    "length_compliance": 0.92,
    "asset_reuse_rate": 0.85,
    "issues": [
      {
        "id": "issue-a1b2c3d4",
        "section_id": "sec-002",
        "severity": "warning",
        "category": "length",
        "description": "章节'架构设计'字数不足：实际 380 字，预算 500 字（76%）",
        "suggestion": "建议扩展内容至约 500 字",
        "auto_fixable": false,
        "fixed": false
      }
    ],
    "auto_fixed_count": 2,
    "user_decision_needed": ["issue-a1b2c3d4"]
  }
}
```

### 7.3 Resume 响应格式

**Brief 确认**：
```json
{
  "thread_id": "xxx",
  "resume_value": {
    "brief": { "audience": "...", "goal": "...", ... }
  }
}
```

**Blueprint 确认**：
```json
{
  "thread_id": "xxx",
  "resume_value": {
    "blueprint": { "title": "...", "sections": [...], ... }
  }
}
```

**Review 选择修复**：
```json
{
  "thread_id": "xxx",
  "resume_value": {
    "selected_issue_ids": ["issue-a1b2c3d4", "issue-e5f6g7h8"]
  }
}
```

---

## 8. 前端集成

### 8.1 事件路由流程

```
用户提交 prompt
    │
    ▼
use-ai-create-session.ts
    │
    ├─ runAgentAiCreate() → POST /api/agent/run
    │
    ▼
SSE 事件流到达
    │
    ├─ normalizeAgentRunEvent() 或 normalizeV2Event()
    │   └─ 统一转换为 AiCreateRunEvent
    │
    ▼
handleRunEvent() 按事件类型分发：
    │
    ├─ content_delta → 累积到 assistant message bubble
    │
    ├─ await_input (phase="brief")
    │   └─ createInteractiveMessage(phase="brief", data)
    │   └─ 渲染 BriefMessageItem → SmartBriefCard
    │
    ├─ await_input (phase="blueprint")
    │   └─ createInteractiveMessage(phase="blueprint", data)
    │   └─ 渲染 BlueprintMessageItem → BlueprintModal (弹窗)
    │
    ├─ await_input (phase="review")
    │   └─ createInteractiveMessage(phase="review", data)
    │   └─ 渲染 ReviewMessageItem → ReviewModal (弹窗)
    │
    ├─ section_progress → 更新进度状态
    │
    └─ done → 完成，auto-insert（如果启用）
```

### 8.2 交互组件

| 组件 | 触发条件 | 用户操作 | 恢复值 |
|------|----------|----------|--------|
| `SmartBriefCard` | `phase="brief"` | 编辑受众/目标/字数/风格 → 确认 | `{ brief: CreationBrief }` |
| `BlueprintModal` | `phase="blueprint"` | 调整章节顺序/字数/视觉计划 → 确认 | `{ blueprint: CreationBlueprint }` |
| `ReviewModal` | `phase="review"` | 查看评分 → 勾选需修复的问题 → 确认 | `{ selected_issue_ids: string[] }` |
| `ReviewScoreBoard` | ReviewModal 内部 | 只读展示 | 无 |
| `IssueCard` | ReviewModal 内部 | 勾选/取消 | 无 |
| `AutoFixSummary` | ReviewModal 内部 | 只读展示 | 无 |

### 8.3 消息气泡渲染

`ai-creator-message-item.tsx` 中根据消息类型渲染不同子组件：

- **普通 assistant 消息** → 使用隔离的 `bubbleMarked` 实例 + hljs 高亮 + DOMPurify 消毒
- **交互消息**（带 `phase` 字段）→ 渲染对应的交互卡片组件
- **agent step 消息** → 渲染 `AiCreatorAgentSteps`

**关键约定**：气泡渲染使用 `new Marked()` 隔离实例，编辑器插入使用 `markdownToHtml` from `@docmost/editor-ext`，两者不可混用。

### 8.4 尚未集成的组件

以下组件已创建但尚未接入主面板：
- `DraftProgressBar` — 需要在 L3 写作阶段显示
- `SectionNav` — 需要在 L3 写作阶段显示
- `SectionActions` — 需要在草稿编辑时显示
- `DraftPanel` / `DraftMergeActions` — 需要在草稿管理时显示
- `AiCreatorInputV2` — 需要替换现有输入组件
- `LoadingSkeleton` — 需要在加载状态时显示

---

## 9. API 端点

### 9.1 Python Agent Service

| 方法 | 路径 | 说明 | 请求体 | 响应 |
|------|------|------|--------|------|
| POST | `/agent/run` | 启动编排器 | `OrchestratorRequest` (JSON) | SSE 事件流 |
| POST | `/agent/resume` | 恢复暂停的任务 | `{ thread_id, resume_value }` | `{ status: "ok" }` |
| POST | `/agent/stop` | 取消任务 | `{ task_id }` | `{ status: "ok" }` |
| POST | `/v2/draft/get` | 获取草稿 | `{ workspace_id, page_id, task_id }` | `DraftState` |
| POST | `/v2/draft/merge` | 获取合并后的草稿内容 | `{ workspace_id, page_id, task_id }` | `{ content: string }` |
| POST | `/v2/draft/delete` | 删除草稿 | `{ workspace_id, page_id, task_id }` | `{ status: "ok" }` |

### 9.2 NestJS Gateway

| 方法 | 路径 | 说明 | 代理目标 |
|------|------|------|----------|
| POST | `/api/agent/run` | SSE 代理 — 解析 template + system prompt 后转发 | `POST /agent/run` |
| POST | `/api/agent/resume` | 恢复代理 | `POST /agent/resume` |
| POST | `/api/agent/stop` | 取消任务 | `POST /agent/stop` |
| POST | `/api/agent/tools` | 获取可用工具列表 | 直接返回 |

**关键实现细节**：
- NestJS Gateway 使用 `http.request`（Node.js 原生模块）代理 SSE，**不使用 `fetch`**（fetch 会缓冲 SSE 流）
- `run` 端点在代理前解析 `templateId` → 查询数据库获取模板 prompt
- `run` 端点读取 `workspace.settings.ai.systemPrompt` 作为系统提示词
- SSE 响应头：`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
- `X-Task-Id` 从 Python 服务的响应头透传到客户端
- `X-Internal-Secret` 用于 Python 服务的内部认证

### 9.3 前端 API 调用

| 函数 | 文件 | API 路径 |
|------|------|----------|
| `runAgentAiCreate()` | `agent-service.ts` | `POST /api/agent/run` |
| `resumeAgentAiCreate()` | `agent-service.ts` | `POST /api/agent/resume` |
| `stopAgentAiCreate()` | `agent-service.ts` | `POST /api/agent/stop` |
| `getDraft()` | `draft-service.ts` | `POST /api/agent/draft/get` |
| `getMergedDraft()` | `draft-service.ts` | `POST /api/agent/draft/merge` |
| `deleteDraft()` | `draft-service.ts` | `POST /api/agent/draft/delete` |

---

## 10. 测试覆盖

### 10.1 总览

**总计：610 个测试函数**（全部为 Python 后端测试，前端无测试）

### 10.2 按模块分布

#### 模型测试（`tests/models/`）— 49 个

| 文件 | 测试数 | 覆盖内容 |
|------|--------|----------|
| `test_brief.py` | 3 | CreationBrief 序列化/默认值 |
| `test_asset_map.py` | 4 | AssetItem/AssetMap 过滤和方法 |
| `test_blueprint.py` | 12 | SectionPlan/CreationBlueprint/VisualPlan 验证 |
| `test_draft_review.py` | 9 | SectionDraft + ReviewIssue + ReviewReport 方法 |
| `test_events.py` | 13 | SSE 事件序列化和类型区分 |
| `test_state.py` | 8 | CreationState 完整状态管理 |

#### 编排器测试（`tests/orchestrator/`）— ~278 个

| 文件 | 测试数 | 覆盖内容 |
|------|--------|----------|
| `test_complexity.py` | 40 | 复杂度分类器全路径覆盖 |
| `test_create_blueprint.py` | 33 | Blueprint 生成逻辑 |
| `test_create_brief.py` | 20 | Brief 生成逻辑 |
| `test_engine.py` | 23 | OrchestratorEngine L1/L2/L3 |
| `test_finalize.py` | 23 | 合并和事件发送 |
| `test_user_interaction.py` | 21 | 暂停/恢复机制 |
| `test_simple_edit.py` | 17 | 简单编辑流式调用 |
| `test_draft_manager.py` | 13 | 草稿存储 CRUD |
| `test_llm_factory.py` | 12 | 模型工厂各 provider |
| `test_write_tools.py` | 12 | 分段写作调度 |
| `test_evaluate.py` | 9 | 质量评估 |
| `test_parse_assets.py` | 9 | 素材解析工具 |
| `test_parse_assets_parallel.py` | 6 | 并行解析 |
| `test_sse_optimizer.py` | 8 | SSE 优化器 |
| `test_merge_proposals.py` | 8 | 修复合并 |
| `test_model_router.py` | 7 | 模型路由 |
| `test_fix_tools.py` | 6 | 修复工具 |
| `test_rewrite_section.py` | 5 | 章节重写 |
| `test_e2e_level2.py` | 2 | L2 端到端 |
| `test_e2e_level3.py` | 2 | L3 端到端 |
| `test_e2e_review.py` | 1 | Review 端到端 |
| `test_v2_endpoints.py` | 2 | v2 API 端点 |

#### Worker 测试（`tests/workers/`）— ~250 个

| 文件 | 测试数 | 覆盖内容 |
|------|--------|----------|
| `test_asset_parser.py` | 46 | 文档解析全场景 |
| `test_section_writer.py` | 38 | 分段写作/上下文构建/字数控制 |
| `test_visual_planner.py` | 38 | 视觉建议规则 |
| `test_evaluator.py` | 35 | 双阶段评估 |
| `test_fixer.py` | 31 | 自动修复 + LLM 修复 |
| `test_style_analyzer.py` | 23 | 风格分析 |
| `test_consistency_checker.py` | 17 | 一致性检查 |
| `test_researcher.py` | 14 | 搜索接口 |
| `test_generate_section_visuals.py` | 8 | 视觉生成 |

#### 工具和集成测试

| 文件 | 测试数 | 覆盖内容 |
|------|--------|----------|
| `tests/utils/test_text.py` | 5 | 中英文字数统计 |
| `tests/test_integration_final.py` | 14 | 跨模块集成验证 |
| `tests/test_main.py` | 1 | FastAPI 应用启动 |
| `tests/test_event_queue.py` | 2 | 事件队列 |
| `tests/test_cancellation.py` | 2 | 取消机制 |
| `tests/test_protocol_schemas.py` | 4 | 协议 schema 验证 |
| `tests/test_tools/test_nanobana_imggen.py` | 3 | 图片生成工具 |
| `tests/conftest.py` | 1 | 测试配置 fixture |

---

## 11. 已知限制与后续工作

### 11.1 前端未完成集成

| 组件 | 状态 | 需要的工作 |
|------|------|-----------|
| `DraftProgressBar` | 已创建 | 接入 L3 写作阶段的主面板，监听 `section_progress` 事件 |
| `SectionNav` | 已创建 | 接入 L3 写作阶段，允许用户在章节间跳转 |
| `SectionActions` | 已创建 | 接入草稿编辑模式 |
| `DraftPanel` / `DraftMergeActions` | 已创建 | 接入草稿管理流程 |
| `AiCreatorInputV2` | 已创建 | 替换现有输入组件 |
| `LoadingSkeleton` | 已创建 | 在加载状态时使用 |

### 11.2 Gateway 草稿路由缺失

前端 `draft-service.ts` 调用 `/api/agent/draft/get`、`/api/agent/draft/merge`、`/api/agent/draft/delete`，但 NestJS Gateway（`agent-gateway.controller.ts`）**尚未添加这些代理路由**。需要在 controller 中新增 draft 相关端点，代理到 Python 的 `/v2/draft/*`。

### 11.3 草稿存储

当前 `DraftStore` 使用内存字典实现。Python 进程重启后草稿丢失。计划在 Phase 5 迁移到 Redis（带 TTL 过期）。

### 11.4 模型路由

`ModelRouter` 已实现但**尚未应用到各 Worker**。所有 Worker 仍使用默认模型。需要将 `get_model_for_role()` 集成到 SectionWriter、Evaluator、Fixer 等 Worker 的 LLM 调用中。

### 11.5 风格学习

`StyleAnalyzer` 已实现但**尚未集成到写作管线**。需要在 L3 流程中调用 `analyze_style()` 并将 `style_guide` 传递给 SectionWriter。

### 11.6 一致性检查结果

`ConsistencyChecker` 在 L3 流程中运行，但其结果**未包含在展示给用户的 ReviewReport 中**。需要将 `ConsistencyIssue` 转换为 `ReviewIssue` 并合并到报告中。

### 11.7 前端测试

目前只有 Python 后端测试（610 个）。前端交互组件无自动化测试。需要补充：
- SmartBriefCard / BlueprintModal / ReviewModal 的组件测试
- 事件路由逻辑的单元测试
- SSE 事件处理的集成测试

### 11.8 TypeScript 编译

`pnpm build` 未经验证。新增的前端类型文件和组件可能存在编译问题，需要检查。

### 11.9 L2 写作器

当前 L2 路径的写作步骤仍使用 `simple_edit`（整篇生成），而非基于 Blueprint 的分段写作。后续应考虑在 L2 也使用 `write_all_sections`（或简化版本）。

---

## 12. 测试指南

### 12.1 启动服务

**终端 1 — Docmost 主服务**：
```bash
cd E:\test\Docmost
pnpm dev
```

**终端 2 — Agent Service**：
```bash
cd E:\test\Docmost\agent-service
pip install -e ".[dev]"
uvicorn app.main:app --port 8100 --reload
```

**环境变量**（`.env` 或系统环境变量）：
```env
# 必需
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
APP_SECRET=...

# AI 配置
LLM_PROVIDER=openai-compatible  # 或 openai / gemini / ollama
LLM_MODEL=...
LLM_API_KEY=...
LLM_API_URL=...                 # openai-compatible 必需

# Agent Service
AGENT_SERVICE_URL=http://localhost:8100
AGENT_INTERNAL_SECRET=...       # Gateway ↔ Agent 内部认证
```

### 12.2 运行 Python 测试

```bash
cd E:\test\Docmost\agent-service

# 运行全部测试
pytest tests/ -v

# 运行特定模块
pytest tests/models/ -v              # 模型测试
pytest tests/orchestrator/ -v        # 编排器测试
pytest tests/workers/ -v             # Worker 测试
pytest tests/test_integration_final.py -v  # 集成测试

# 运行单个测试文件
pytest tests/orchestrator/test_complexity.py -v

# 查看覆盖率
pytest tests/ --cov=app --cov-report=term-missing
```

### 12.3 手动测试 Level 1

1. 打开 Docmost 页面编辑器
2. 选中一段文字
3. 在 AI Creator 面板输入："翻译成英文"
4. 预期：
   - SSE 流开始，显示 `step_start: analyze_complexity`
   - 复杂度判定为 Level 1
   - 流式内容生成
   - 5-15 秒内完成
   - 无中间交互卡片

### 12.4 手动测试 Level 2

1. 打开 Docmost 页面编辑器
2. 上传 1 个文档文件
3. 输入："根据上传的文档扩展内容"
4. 预期：
   - 复杂度判定为 Level 2
   - 显示 SmartBriefCard（受众/目标/字数等）
   - 用户确认后显示 BlueprintModal（章节结构）
   - 用户确认后开始生成
   - 30-90 秒内完成

### 12.5 手动测试 Level 3

1. 打开 Docmost 页面编辑器
2. 上传 2+ 个文档文件
3. 输入："根据这些文档撰写一篇完整的技术方案"
4. 预期：
   - 复杂度判定为 Level 3
   - SmartBriefCard → 确认
   - BlueprintModal → 确认
   - 分段写作（`section_progress` 事件，显示 1/N, 2/N...）
   - 质量评审 → ReviewModal（如有问题）
   - 2-5 分钟内完成

### 12.6 手动测试 Review 流程

1. 触发 L3 任务
2. 等待写作完成后出现 ReviewModal
3. 检查：
   - 评分板（总分、字数合规率、素材复用率）
   - 自动修复摘要（已自动修复 N 个格式问题）
   - 问题列表（每个问题有严重度、描述、建议）
   - 勾选部分问题 → 确认修复
   - 等待修复完成 → 最终内容生成

### 12.7 直接测试 Python API

```bash
# Level 1 — 简单编辑
curl -X POST http://localhost:8100/agent/run \
  -H "Content-Type: application/json" \
  -d '{
    "thread_id": "test-001",
    "user_message": "翻译成英文",
    "page_content": "这是一段测试文本。",
    "selected_text": "这是一段测试文本。",
    "intent_route": "selection_edit"
  }'

# Resume — 提交用户响应
curl -X POST http://localhost:8100/agent/resume \
  -H "Content-Type: application/json" \
  -d '{
    "thread_id": "test-001",
    "resume_value": {"brief": {"audience": "开发者", "goal": "技术文档"}}
  }'

# 获取草稿
curl -X POST http://localhost:8100/v2/draft/get \
  -H "Content-Type: application/json" \
  -d '{
    "workspace_id": "ws-001",
    "page_id": "pg-001",
    "task_id": "test-001"
  }'
```

### 12.8 验证检查清单

- [ ] Python 测试全部通过（`pytest tests/ -v`）
- [ ] L1 路径可正常完成简单编辑
- [ ] L2 路径可展示 Brief + Blueprint 卡片并完成
- [ ] L3 路径完整流程可走通
- [ ] 分段写作进度事件正确推送
- [ ] ReviewModal 正确渲染评审结果
- [ ] Resume 机制正常工作（暂停→用户交互→恢复）
- [ ] SSE 事件流不中断
- [ ] `pnpm build` TypeScript 编译通过
- [ ] NestJS Gateway 正确代理 run/resume/stop
