# AI Creator v2 — 智能文档创作引擎规范

> **状态**: 待审批
> **日期**: 2026-03-14
> **关联分析**: [docs/plans/2026-03-14-ai-creator-deep-analysis-and-refactor.md](../plans/2026-03-14-ai-creator-deep-analysis-and-refactor.md)

---

## 1. 愿景与目标

将 AI Creator 从一个固定流水线式的 AI 写作工具，转型为智能文档创作引擎：能够理解任务复杂度、自适应编排工作流、逐章节精准写作、智能规划多模态素材，最终产出出版级质量的、结构清晰的、图文并茂的长文档。核心理念是"先理解，再规划，再执行，再精修"——把 40% 的算力投入理解、30% 投入规划、20% 投入执行、10% 投入精修，而非像当前系统将 90% 的算力堆在一次性执行上。

### 核心验收指标

| 指标 | 当前估值 | 目标值 | 测量方法 |
|------|----------|--------|----------|
| **篇幅保持率** | ~40%（5000→2000） | ≥90%（±10% 容差内） | `abs(实际字数 - 目标字数) / 目标字数 ≤ 0.1` 的比例 |
| **素材复用率** | ~0% | ≥80% | `已使用素材 / 可用素材总数` |
| **L3 任务确认轮次** | 3 次（固定） | 3-6 次（自适应） | 从用户首次提交到产出的交互次数 |
| **5000 字文档生成时间** | ~3-5 分钟（质量差） | ≤5 分钟（质量达标） | 从首次提交到最终草稿完成 |

---

## 2. 场景优先级

| 优先级 | 场景 | 说明 |
|--------|------|------|
| **P0** | 基于素材深度创作 | 仿写（结构复制 + 内容替换），提供 2-3 方案选择；多文档素材融合创作 |
| **P0** | 多文档合并 | 多份素材合成一篇文档，自动去重、结构重组、信息整合 |
| **P1** | 从零创建 | 给定主题生成完整文档，需要调研、规划、逐章写作 |
| **P2** | 局部编辑 | 选中文字做润色/改写/扩展，保持上下文一致性 |

---

## 3. 任务复杂度分级

### Level 1 — 直接执行

- **典型任务**：翻译、改错、精简、改语气、格式化
- **特征**：明确的单一操作指令，不需要规划或确认
- **耗时**：5-15 秒
- **路径**：用户输入 → 复杂度分析 → 单次 LLM 调用 → 输出结果

### Level 2 — 轻量确认

- **典型任务**：排版优化、续写、扩展、改写（保留原结构）
- **特征**：需要理解当前内容结构，轻量确认几个关键参数
- **耗时**：30-90 秒
- **路径**：用户输入 → 复杂度分析 → 素材提取 → Smart Brief（精简版） → 章节写作 → 自动格式修复 → 输出

### Level 3 — 完整流程

- **典型任务**：从零创作、仿写、多文档合并
- **特征**：需要深度理解、完整规划、多轮确认、逐章生成
- **耗时**：2-5 分钟
- **路径**：用户输入 → 复杂度分析 → 深度素材提取 → 调研 → Smart Brief → Creation Blueprint → 逐章写作 → 质量评审 → 定点修复 → 完成

### 复杂度判断机制

- **模板提示**：模板自身携带默认复杂度级别（如"翻译"模板默认 Level 1）
- **AI 语义分析**：Orchestrator 通过 `analyze_complexity` 工具综合分析用户指令、上传素材数量、当前页面内容等
- **用户覆盖**：用户可随时手动升降级（如在侧边栏切换"快速模式"/"深度模式"）
- **动态升级**：执行过程中发现任务比预期复杂，自动升级处理级别

---

## 4. 架构概述

采用**模式B：一个强大的大脑（Orchestrator）+多个专业手（Workers）**架构。

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React)                      │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ 侧边栏   │  │ 弹出工作台    │  │ 编辑器主区域      │  │
│  │ Chat UI  │  │ Blueprint    │  │ Live Draft 写入    │  │
│  │ Brief    │  │ Review Card  │  │                   │  │
│  └────┬─────┘  └──────┬───────┘  └────────┬──────────┘  │
│       │               │                    │             │
│  ┌────┴───────────────┴────────────────────┴──────────┐  │
│  │        AI Create Session Manager (重构)             │  │
│  │  状态机 + 草稿管理 + 事件路由 + 中间态管理           │  │
│  └─────────────────────┬──────────────────────────────┘  │
└────────────────────────┼────────────────────────────────┘
                         │ SSE / REST
                         ▼
┌────────────────────────────────────────────────────────┐
│               NestJS Gateway (精简)                     │
│  - 文件代理 + SSE 桥接 + 模板解析 + 认证               │
│  - 不再做意图路由（移交给 Python Orchestrator）          │
└────────────────────────┬───────────────────────────────┘
                         │ SSE / REST
                         ▼
┌────────────────────────────────────────────────────────┐
│          Python Agent Service (PydanticAI 重构)         │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │              Orchestrator (强推理模型)             │  │
│  │  ReAct Loop: 接收输入 → 分析复杂度 → 决定行动     │  │
│  │  → 调度 Worker → 需用户输入时 yield 暂停          │  │
│  │  → 循环直到完成                                   │  │
│  └──────┬───────────────────────────────────────────┘  │
│         │ Tool Calls                                    │
│  ┌──────┴───────────────────────────────────────────┐  │
│  │                 Worker Pool                       │  │
│  │  AssetParser   — 确定性代码，素材结构化提取        │  │
│  │  Researcher    — LLM+Tools，调研与信息搜集        │  │
│  │  SectionWriter — 快速模型，逐章写作+滑动窗口      │  │
│  │  VisualPlanner — 中等模型，配图规划+生成          │  │
│  │  Evaluator     — 确定性+LLM，质量评估             │  │
│  │  Fixer         — 快速模型，定点修复               │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │              Structured State Store               │  │
│  │  brief / asset_map / blueprint / draft / review   │  │
│  │  持久化：Redis (热数据) + PostgreSQL (冷数据)      │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

### 关键设计决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 编排框架 | PydanticAI React 循环 | 动态决策能力，替代 LangGraph 固定图拓扑 |
| 模型分配 | 每个 Worker 可配不同模型 | Orchestrator使用强推理模型，SectionWriter使用快速模型，降本增效 |
| 状态存储 | 悬垂模型 | 类型安全、可序列化、可验证，替代 TypedDict |
| 用户中断 | 自定义 yield + 状态序列化 | 比 LangGraph Interrupt() 更简单可控 |
| 意图路由 | 移至 Python Orchestrator | 语义级理解，替代 NestJS 网关的关键词匹配 |

---

## 5. 结构化中间态

系统在创作过程中维护 5 个核心中间态数据模型，每个中间态都是 Pydantic Model，支持序列化、验证和持久化。

### 5.1 CreationBrief — 创作简报

```python
from pydantic import BaseModel
from typing import Literal

class CreationBrief(BaseModel):
    audience: str                          # 目标读者
    goal: str                              # 创作目标
    target_length: int                     # 目标字数
    length_tolerance: float = 0.1          # 容差（±10%）
    style: str                             # 风格描述
    tone: str                              # 语气
    structure_strategy: Literal[            # 结构策略
        "copy_source",                     #   复制原文结构
        "ai_recommend",                    #   AI 推荐
        "user_defined"                     #   用户自定义
    ]
    image_strategy: Literal[               # 配图策略
        "reuse_source",                    #   复用素材图片
        "generate_new",                    #   AI 生成新图
        "mixed",                           #   混合
        "none"                             #   无需配图
    ]
    constraints: list[str]                 # 特殊约束
```

### 5.2 AssetMap + AssetItem — 素材清单

```python
class AssetItem(BaseModel):
    id: str                                # 唯一标识
    type: Literal["text", "image", "table", "code", "mermaid", "heading_structure"]
    source: str                            # 来源文件/URL
    content: str                           # 原始内容（或图片URL）
    summary: str                           # AI 生成的摘要
    suggested_usage: str                   # 建议用途
    reuse_decision: Literal["reuse", "adapt", "skip"] | None  # 用户/AI 决策

class AssetMap(BaseModel):
    items: list[AssetItem]
    source_structure: list[dict]           # 原文档的章节结构
    source_word_count: int                 # 原文总字数
    source_section_counts: dict[str, int]  # 原文每章字数
```

### 5.3 CreationBlueprint + SectionPlan + VisualPlan — 创作蓝图

```python
class VisualPlan(BaseModel):
    type: Literal["mermaid", "ai_image", "reuse_image", "table"]
    description: str                       # 图片描述
    source_asset_id: str | None            # 如果是复用，指向 AssetItem.id
    position: Literal["before_section", "after_paragraph", "end_of_section"]

class SectionPlan(BaseModel):
    id: str
    title: str
    level: int                             # 标题层级 (1-3)
    word_budget: int                       # 字数预算
    description: str                       # 本章目标
    assets: list[str]                      # 引用的 AssetItem.id 列表
    visuals: list[VisualPlan]              # 配图计划
    must_cover: list[str]                  # 必须覆盖的要点

class CreationBlueprint(BaseModel):
    title: str
    sections: list[SectionPlan]
    total_word_budget: int
    style_guide: str                       # 风格指南
    visual_plan_summary: str               # 配图规划摘要
```

### 5.4 SectionDraft — 章节草稿

```python
class SectionDraft(BaseModel):
    section_id: str
    content: str                           # Markdown 内容
    word_count: int                        # 实际字数
    budget_compliance: float               # 字数预算达标率
    assets_used: list[str]                 # 实际使用的素材 ID
    visuals_generated: list[str]           # 生成的图片 URL
```

### 5.5 ReviewReport + ReviewIssue — 评审报告

```python
class ReviewIssue(BaseModel):
    id: str
    section_id: str | None                 # 所在章节
    severity: Literal["error", "warning", "info"]
    category: Literal[
        "length",                          # 字数问题
        "structure",                       # 结构问题
        "content",                         # 内容问题
        "style",                           # 风格问题
        "asset",                           # 素材使用问题
        "visual",                          # 配图问题
        "format"                           # 格式问题
    ]
    description: str                       # 问题描述
    suggestion: str                        # 修复建议
    auto_fixable: bool                     # 是否可自动修复
    fixed: bool = False                    # 是否已修复

class ReviewReport(BaseModel):
    overall_score: int                     # 0-100 总分
    length_compliance: float               # 篇幅达标率
    asset_reuse_rate: float                # 素材复用率
    issues: list[ReviewIssue]
    auto_fixed_count: int                  # 已自动修复的数量
    user_decision_needed: list[str]        # 需要用户决定的 issue IDs
```

---

## 6. 用户交互点

系统定义 4 个结构化用户交互点，每个交互点有明确的触发条件、数据契约和 UI 形态。

### 6.1 Smart Brief — 创作简报确认

- **触发条件**：Level 2 任务（精简版）或 Level 3 任务（完整版）的素材解析完成后
- **UI 形态**：侧边栏内嵌卡片，字段为下拉选择 + 自由输入混合
- **数据契约**：
  - 输入：`CreationBrief`（AI 预填推荐默认值）+ `AssetMap` 摘要
  - 输出：用户确认/修改后的 `CreationBrief`
- **交互内容**：
  - 目标读者（下拉选择 + 自定义）
  - 文档目标（下拉选择 + 自定义）
  - 目标篇幅（数字输入，AI 推荐值）
  - 写作风格（下拉选择）
  - 配图策略（下拉选择）
  - 素材清单预览（N 张图片、N 个表格、N 段代码、原文结构摘要）

### 6.2 创作蓝图 — 创作蓝图编辑

- **触发条件**：Level 3 任务，Brief 确认后、蓝图生成完成时
- **UI形态**：弹出式Modal（Mantine Modal, size="xl", 约80vw）
- **数据契约**：
  - 输入：`CreationBlueprint`（AI 生成）
  - 输出：用户编辑后的 `CreationBlueprint`
- **交互内容**：
  - 左侧 60%：章节列表（@dnd-kit 拖拽排序），每章显示标题、字数预算、配图计划
  - 右侧 40%：实时 Markdown 大纲预览
  - 底部工具栏：总字数统计、确认/重新生成按钮
- **用户操作**：
  - 拖拽调整章节顺序
  - 编辑章节标题和字数预算
  - 增删章节
  - 编辑配图计划（类型、描述、位置）
  - 确认或要求重新生成

### 6.3 Live Draft — 实时写作进度

- **触发条件**：开始逐章写作后持续展示
- **UI 形态**：侧边栏内进度条 + 章节导航
- **数据契约**：
  - 输入：`section_progress` 事件流（当前章节 N/M、字数、状态）
  - 输出：内容流式写入编辑器（或独立草稿区）
- **交互内容**：
  - 进度条：已完成章节数 / 总章节数
  - 章节导航列表：每章状态（等待中/写作中/已完成）
  - 实时字数统计
- **用户操作**：
  - 被动观察（内容自动流式输出）
  - 不中断写作过程

### 6.4 审查卡 — 评审报告决策

- **触发条件**：所有章节写作完成、质量评审后（仅当存在需用户决定的问题时触发）
- **UI形态**：弹出式Modal（Mantine Modal, size="xl"）
- **数据契约**：
  - 输入：`ReviewReport`
  - 输出：用户勾选的待修复 issue IDs + 可选的补充意见文本
- **交互内容**：
  - 顶部评分仪表盘：总分 + 4 个维度进度条（篇幅、结构、内容、风格）
  - 已自动修复摘要（N 项已处理）
  - 需用户决定的 Issue 卡片列表（可勾选，按章节分组）
  - 补充修改意见输入框
  - 操作按钮：修复选中项 / 跳过直接使用

---

## 7. 写作策略

采用 **大纲驱动逐章生成 + 滑动窗口** 策略（流派 1+3 结合），解决一次性全文生成导致的篇幅压缩和注意力衰减问题。

### 7.1 Section Context Package — 章节上下文包

每个章节独立生成时，传入精确裁剪的上下文包，而非全量素材堆砌：

| 上下文项 | 内容 | 来源 |
|----------|------|------|
| 全局信息 | 文档标题、创作目标、风格指南 | `CreationBrief` + `CreationBlueprint` |
| 全局大纲 | 所有章节标题列表（提供定位感） | `CreationBlueprint.sections` |
| 前文摘要 | 前一章的最后 2 段原文 + AI 摘要 | 已完成的 `SectionDraft` |
| 后文预告 | 后一章的标题 + 目标描述（提供过渡感） | `CreationBlueprint.sections[i+1]` |
| 当前章节 | 标题 + 目标 + 字数预算 + 必须覆盖点 | `SectionPlan` |
| 相关素材 | 仅当前章节引用的 `AssetItem` | `SectionPlan.assets` → `AssetMap` |
| 配图指令 | 当前章节的 `VisualPlan` 列表 | `SectionPlan.visuals` |

### 7.2 并行写作

- 独立性高的章节（无前后文依赖）可并行生成
- Orchestrator 根据章节间的引用关系决定并行度
- 每章完成后立即验证字数预算达标率

### 7.3 字数预算

- Blueprint 阶段为每章分配字数预算，所有章节预算之和 = `target_length`
- 每章字数允许 ±10% 容差
- 超出预算的章节会被标记为 `ReviewIssue(category="length")`
- 中文字数计算采用正则字符计数（`[\u4e00-\u9fff]` 字符数 + 英文单词数），替代当前错误的 `split()`

### 7.4 跨章节一致性扫描

所有章节合并后，执行一致性检查：
- 术语统一（同一概念是否使用一致的术语）
- 前后引用一致性（第 3 章提到的"第 5 章将详述"是否真的在第 5 章出现）
- 过渡段落自然度

---

## 8. 审核机制

核心原则：**评估 ≠ 重写**。评价和修复必须完全分离。

### 步骤1：确定性检查（Evaluator Worker — 代码逻辑，无LLM）

| 检查项 | 规则 | 产出 Issue 类型 |
|--------|------|-----------------|
| 章节字数 vs 预算 | 偏差超过 ±10% | `length` |
| 素材引用率 | 未使用的素材 | `asset` |
| 必须覆盖点 | Blueprint 中标记的 `must_cover` 缺失 | `content` |
| Mermaid 语法 | 正则/解析器检查语法错误 | `format` |
| 图片 URL 有效性 | HTTP HEAD 检查 | `visual` |
| 标题层级规范 | 禁止跳级（如 H1 直接到 H3） | `format` |

### 步骤2：LLM质量评估（Evaluator Worker — 中等模型）

- 输入：草稿 + Blueprint + Brief（不要求输出修改后内容）
- 评估维度：准确性、完整性、风格一致性、可读性、论据充分性
- 输出：`ReviewIssue[]`（每个问题附带严重性+类别+section_id+描述）
- 合并到 Step 1 的 Issue 列表

### 步骤3：自动修复（Fixer Worker — 快速模型）

- 遍历 `auto_fixable=true` 的 Issues（仅格式类问题）
- 每个 Issue 单独修复：传入目标章节 + Issue 描述 + 修复指令
- 修复后标记 `fixed=true`
- 不触碰非 `auto_fixable` 的内容

### 步骤4：用户决策（复习卡）

- 展示 `ReviewReport`：总分 + 各维度得分 + Issue 卡片列表
- 用户勾选需要修复的 Issue
- 用户可添加自定义修改意见
- 操作：修复选中项 / 跳过直接使用

### 步骤5：定向修复（Fixer Worker）

- 只修复用户勾选的 Issue
- 每个 Issue 独立修复：传入目标章节 + Issue + 修复指令
- 不改动其他内容——章节级定点修复，不是全文重写
- 修复完成后可选择再次评估

---

## 9. 多模态素材处理

### 9.1 AssetParser 基础 — 素材提取

```
用户上传文件/提供 URL
│
▼ AssetParser Worker（确定性代码 + VLM）
│
├─ 1. 文档解析（Docling）
│   ├─ 纯文本 → AssetItem(type="text")
│   ├─ 标题结构 → AssetItem(type="heading_structure")
│   ├─ 表格 → AssetItem(type="table", content=markdown_table)
│   ├─ 代码块 → AssetItem(type="code", content=code_with_lang)
│   └─ 内嵌图片 → 图片处理管线
│
├─ 2. 图片处理（VLM + Pillow）
│   ├─ 上传到 Docmost 获取 URL
│   ├─ 调用 VLM 理解图片内容 → summary
│   ├─ 判断图片类型：screenshot / diagram / photo / chart / illustration
│   └─ → AssetItem(type="image", content=url, summary=vlm_desc)
│
├─ 3. Mermaid/流程图检测
│   ├─ 检测 Mermaid 代码块 → AssetItem(type="mermaid")
│   └─ 检测描述流程/架构的段落 → 标记"可转化为 Mermaid"
│
└─ 4. 元数据计算
    ├─ 源文档总字数（中文字符计数 + 英文单词计数）
    ├─ 每章字数统计
    └─ 章节结构树
```

### 9.2 VisualPlanner 线路 — 配图规划

```
Blueprint 阶段，对每个章节分析配图需求：
│
├─ 描述流程/步骤 → Mermaid 流程图
├─ 描述架构/关系 → Mermaid 架构图
├─ 数据对比     → 表格或图表
├─ 概念说明     → AI 生成说明图
├─ 引用素材截图 → 复用原图（可选重新标注）
└─ 无明显需求   → 不配图
```

每个配图决策记录为 `VisualPlan`，包含类型（mermaid / ai_image / reuse_image / table）、描述、位置和关联素材 ID。

### 9.3 图片生成执行

| 类型 | 执行方式 |
|------|----------|
| `reuse_image` | 直接使用 AssetItem 中的 URL；如需标注，调用 `image_annotate` 工具 |
| `mermaid` | SectionWriter在章节内容中直接生成Mermaid代码块；Evaluator做语法检查 |
| `ai_image` | 调用配置的图片生成 API → 上传到 Docmost 获取 URL → 插入章节指定位置 |
| `table` | 复用素材表格直接插入 Markdown；新建由 SectionWriter 在章节中生成 |

---

## 10. 前端架构

采用 **侧边栏 + 弹出式工作台（Form B）** 形态，使用 Mantine 成熟组件库。

### 10.1 布局分工

| 区域 | 承载内容 | 组件技术 |
|------|----------|----------|
| **侧边栏** | 聊天 UI、Smart Brief 场景、Live Draft 细节条/章节导航 | 现有侧边栏增强 |
| **蓝图模态** | 章节列表（可拖拽排序）+ 字数预算 + 配图编辑 + 实时大纲预览 | Mantine 莫代尔(size="xl") + @dnd-kit/sortable |
| **审查模态** | 评分仪表盘 + Issue 卡片列表（可勾选） + 修复操作 | 曼汀莫代尔(尺寸=“xl”) |
| **编辑器主区域** | Live Draft 内容流式写入（或独立草稿区预览） | TipTap编辑器 |

### 10.2 草稿管理

- 生成内容不直接写入页面，先存储为独立草稿
- 草稿存储：Redis 临时存储（热数据）+ PostgreSQL 持久化（冷数据）
- 用户可在草稿区预览完整文档，对比与原文的差异
- 用户显式操作后才合并到正式页面

### 10.3 状态管理

- 会话状态：Jotai 原子化状态管理
- 中间状态数据：与远端 Pydantic Models 镜像的 TypeScript 类型
- 前端新增类型文件：`brief.types.ts`、`blueprint.types.ts`、`review.types.ts`、`draft.types.ts`

---

## 11. SSE 事件协议

新系统定义以下 SSE 事件类型：

### 流程控制事件

| 事件类型 | 数据 | 说明 |
|----------|------|------|
| `step_start` | `{step: string, description: string}` | Worker 开始执行 |
| `step_done` | `{step: string, duration_ms: number}` | Worker 执行完成 |
| `done` | `{final_content: string}` | 整个创作流程完成 |
| `error` | `{message: string, code: string}` | 错误 |
| `cancelled` | `{}` | 用户取消 |

### 内容流事件

| 事件类型 | 数据 | 说明 |
|----------|------|------|
| `content_delta` | `{chunk: string, section_id?: string}` | 流式文本内容块 |
| `content_cleared` | `{}` | 清除已有内容（重新生成时） |
| `section_progress` | `{current: number, total: number, section_title: string, status: string}` | 章节写作进度 |

### 中间态就绪事件

| 事件类型 | 数据 | 说明 |
|----------|------|------|
| `brief_ready` | `{brief: CreationBrief, asset_summary: object}` | Smart Brief 已生成，等待确认 |
| `blueprint_ready` | `{blueprint: CreationBlueprint}` | 创作蓝图已生成，等待编辑确认 |
| `review_ready` | `{report: ReviewReport}` | 评审报告已生成，等待用户决策 |
| `draft_complete` | `{sections: SectionDraft[], total_word_count: number}` | 全部章节草稿完成 |

### 交互等待事件

| 事件类型 | 数据 | 说明 |
|----------|------|------|
| `await_user_input` | `{interaction_point: string, data: object}` | 等待用户输入，`interaction_point` 为 `brief` / `blueprint` / `review` |

### 修复事件

| 事件类型 | 数据 | 说明 |
|----------|------|------|
| `fix_applied` | `{issue_id: string, section_id: string, success: bool}` | 单个 Issue 修复完成 |

---

## 12. 技术栈变更

| 组件 | 当前 | 变更后 | 理由 |
|------|------|--------|------|
| Agent 编排 | LangGraph 状态图 | PydanticAI React 循环 | 动态编排，替代固定图拓扑 |
| 状态管理 | TypedDict（45+ 字段） | Pydantic Models (5个独立模型) | 类型安全、可验证、职责清晰 |
| 图拓扑 | 编译时固定，3 条路径 | 协调器动态决策 | 自适应工作流 |
| 中断恢复 | LangGraph 中断() | 自定义 yield + 状态序列化 | 更简单可控 |
| 中文字数 | `split()`（对中文完全错误） | `len(re.findall(r'[\u4e00-\u9fff]', text)) + len(text.split())` | 准确计数 |
| 写作模式 | 一次性全文生成 | 逐章节 + 滑动窗口 | 篇幅保障，注意力集中 |
| 审核模式 | LLM 全文重写 | 确定性检查 + LLM 评估 + 定点修复 | 消除内容漂移 |
| 意图路由 | NestJS 关键词匹配 | Python Orchestrator 语义分析 | 准确率提升 |
| 前端弹出面板 | 无 | Mantine 莫代尔 (尺寸=“xl”) | 蓝图/回顾需要大面积展示 |
| 前端拖拽 | 无 | @dnd-kit/可排序 | 蓝图章节排序 |
| 草稿存储 | 直接写页面 | Redis 临时 + DB 持久化 | 独立草稿，预览后再合并 |

---

## 13. 不在范围内

以下功能明确不在本次重构范围内：

| 功能 | 原因 | 时间规划 |
|------|------|----------|
| Dify 集成（方向 A：Docmost 作为 Dify 数据源） | 核心功能完成后再扩展 | 后续独立项目 |
| 风格学习（从工作区文档自动提取写作风格） | 依赖大量语料积累，技术复杂度高 | Phase 5 探索 |
| 模型路由（不同任务级别自动选择不同模型） | 属于优化项，非核心功能 | Phase 5 实现 |
| 多用户协作冲突解决 | 保持当前乐观锁机制，无在线多用户场景 | 暂不规划 |
| 实时协作编辑草稿 | 草稿为单用户操作，不涉及 Yjs 协作 | 暂不规划 |

---

## 14. 分阶段交付

### 阶段 0: 基础设施准备（1-2 周）

| 交付物 | 说明 |
|--------|------|
| 悬垂模型 | 5 个核心中间态模型定义（`models/` 目录） |
| SSE 事件协议 | 事件类型定义 + Python 事件发射器 + TypeScript 类型镜像 |
| PydanticAI 工件 | 基础项目结构、配置、依赖 |
| 前端组件骨架 | 新组件目录结构、空组件文件、路由注册 |

**里程碑**：模型定义和事件协议可供后续 Phase 使用。

### 阶段 1: 核心编排层（2-3 周）

| 交付物 | 说明 |
|--------|------|
| Orchestrator 反应循环 | 核心编排引擎，接收输入、决策、调度 Worker |
| `analyze_complexity` 工具 | Level 1/2/3 复杂度分级 |
| `ask_user` 工具 + 中断恢复 | 通过 SSE 推送结构化交互数据，等待用户响应 |
| Level 1 端到端 | 简单任务（翻译、改错）可正常完成 |
| NestJS 网关适配 | SSE 代理适配新事件协议 |

**里程碑**：Level 1 任务可端到端运行。

### 阶段 2: 素材与规划能力（2-3 周）

| 交付物 | 说明 |
|--------|------|
| AssetParser 工作者 | Docling 结构化提取 + VLM 图片理解 + 元数据计算 |
| 智能简报前端补充 | 侧边栏内嵌，字段选择 + 素材摘要 |
| `create_blueprint` 工具 | 基于Brief + AssetMap生成创作蓝图 |
| 蓝图模态前端 | 弹出面板，拖拽排序 + 字数预算 + 配图编辑 |
| 视觉规划师 | 逐章节配图需求分析 + 素材匹配 |
| Level 2 端到端 | 轻量确认任务可正常完成 |

**里程碑**：素材提取和创作规划能力可用。

### 阶段 3: 分块写作引擎（2-3 周）

| 交付物 | 说明 |
|--------|------|
| 部门作家工人 | 逐章生成 + 滑动窗口上下文 + 字数预算执行 |
| 并行写作 | 独立章节可并行生成 |
| 中文字数精确计算 | 替换 `split()` 为正则字符计数 |
| Live Draft 简介 | 进度条 + 章节导航 + 实时字数统计 |
| 草稿管理系统 | 独立草稿存储 + 预览 + 与原文对比 + 合并 |
| Level 3 端到端 | 完整流程（简要→蓝图→编写→评审）可运行 |

**里程碑**：核心创作流程完整可用。

### 阶段 4: 审核与修复（1-2 周）

| 交付物 | 说明 |
|--------|------|
| 评估员（确定性检查） | 字数、素材覆盖、Mermaid 语法、标题层级等 |
| 评估员（LLM评估） | 内容质量多维评分 |
| 修理工 | 章节级定点修复，格式问题自动修 |
| 回顾模态前端 | 评分仪表盘 + Issue 卡片 + 勾选修复 |

**里程碑**：质量保障闭环完成。

### 阶段 5: 打磨与优化（2-3 周）

| 交付物 | 说明 |
|--------|------|
| 模型路由 | 不同 Worker 配置不同模型（强/中/快） |
| 风格学习 | 从工作区文档提取风格特征（探索性） |
| 单章重写 | 对不满意的章节独立重写 |
| 多文档合并优化 | 多素材去重、冲突解决、结构重组 |
| UI 精修 | 动画、过渡、响应式适配 |
| 旧代码清理 | 删除 LangGraph 相关代码、旧前端组件、旧事件类型 |

**里程碑**：生产可用。

### 总时间线

```
Phase 0 ──┐
           ├── Phase 1 ──┐
           │              ├── Phase 2 ──┐
           │              │             ├── Phase 3 ──┐
           │              │             │             ├── Phase 4 ──┐
           │              │             │             │             ├── Phase 5
           │              │             │             │             │
Week 1-2   Week 3-5       Week 5-7      Week 7-9      Week 9-10     Week 11-14
```

**预计总工期：12-15 周**（一人 + AI 辅助开发）
## 实施更新 (2026-03-19)

- 上传的源图像现在可以作为一流资产保留下来，具有出处、源页面/标题元数据、内容哈希和稳定的重新托管 Docmost URL。
- 蓝图审查现在显示每个部分排名的源图像候选者和规范图像策略：`reuse_source_only`、`prefer_source_then_generate`、`generate_new_only`、`none`。
- 现在，章节写作遵循一份初稿以及同一草案的最多一项有针对性的修订。重复的全节重写不再是默认的 3 级路径的一部分。
- 生成的图像仅在部分文本稳定后才会具体化。部分快照公开 `write_attempts`、图像生命周期状态、源资产 ID 和降级原因。
- 审查门控现在基于严重性。错误级别的问题仍然受阻；警告/信息问题可以通过 `Continue with current draft` 明确接受。
- 浏览器接受范围现在包括空白页烟雾、大纲/审查/插入、带有生成后备的源图像重用以及表格、Mermaid和图像的持续 Markdown 验证。
