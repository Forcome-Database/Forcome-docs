# Docmost AI 创作助手：深度分析与重构方案

> **文档版本**：v1.0
> **日期**：2026-03-14
> **状态**：需求澄清完成，方案待审批
> **分支**：待创建

---

## 目录

1. [需求澄清结论汇总](#1-需求澄清结论汇总)
2. [当前实现执行链路拆解](#2-当前实现执行链路拆解)
3. [核心设计缺陷清单](#3-核心设计缺陷清单)
4. [根因分析](#4-根因分析)
5. [业务思维误区总结](#5-业务思维误区总结)
6. [行业对标与差距分析](#6-行业对标与差距分析)
7. [新架构设计](#7-新架构设计)
8. [审核机制重构方案](#8-审核机制重构方案)
9. [多模态素材与图片规划改造方案](#9-多模态素材与图片规划改造方案)
10. [前端 UI 重构方案](#10-前端-ui-重构方案)
11. [分阶段落地路线图](#11-分阶段落地路线图)
12. [可量化评估指标](#12-可量化评估指标)

---

## 1. 需求澄清结论汇总

通过 19 轮逐项澄清，确认以下核心决策：

### 1.1 场景优先级

| 优先级 | 场景 | 说明 |
|--------|------|------|
| **P0** | 基于素材深度创作 | 仿写（结构复制 + 内容替换），提供 2-3 方案选择 |
| **P0** | 多文档合并 | 多份素材合成一篇文档 |
| **P1** | 从零创建 | 给主题生成完整文档 |
| **P2** | 局部编辑 | 选中文字做润色/改写/扩展 |

### 1.2 关键设计决策

| 决策项 | 结论 |
|--------|------|
| 素材处理深度 | 提取图片 → 理解内容 → 决定复用/位置/标注；表格、代码块、Mermaid 同样提取复用 |
| 篇幅控制精度 | 总字数 ±10%，达标率 ≥90% |
| 任务复杂度分级 | Level 1（直接执行）/ Level 2（轻量确认）/ Level 3（完整流程），模板+语义分析结合判断，用户可手动覆盖 |
| 澄清机制 | 多轮对话式，UI 选择为主 + 自定义输入，AI 推荐默认值 |
| 交互点 | 4个：智能简报 → 创作蓝图 → 现场草稿 → 复习卡 |
| 写作策略 | 大纲驱动逐章生成 + 滑动窗口保持连贯（流派 1+3 结合） |
| Agent 架构 | 一个强大的大脑（Orchestrator）+多个专业手（Workers），模式B |
| 技术栈 | 保持Python微服务，用PydanticAI替代LangGraph |
| 图片规划 | AI 自动判断配图类型/位置/数量，在 Blueprint 中展示给用户确认 |
| 审核机制 | 结构化评审报告 → 用户勾选修复项 → 定点修复，格式问题自动修复 |
| 草稿机制 | 独立草稿区，预览对比后按需合并到正式页面 |
| 前端形态 | 侧边栏 + 弹出式工作台（形态 B），使用 Mantine 成熟组件 |
| 模型偏好 | Claude Opus/Sonnet、GPT-5.4、Gemini 3.1 Pro，支持任务级别路由 |
| Dify 集成 | 方向 A（Docmost 作为 Dify 数据源），核心完成后扩展 |
| 实施方式 | 一人开发（AI 辅助），做好做透，无在线用户无兼容负担 |

### 1.3 验收标准

| 指标 | 目标值 |
|------|--------|
| 篇幅保持率 | ≥90%（±10% 容差内） |
| 素材复用率 | ≥80% |
| L3 任务确认轮次 | 3-6 轮 |
| 5000 字文档生成时间 | ≤5 分钟 |

---

## 2. 当前实现执行链路拆解

### 2.1 完整数据流

```
用户输入（前端）
│
├─ prompt + files + template + selection + agentMode
│
▼
NestJS 网关（agent-gateway.controller.ts）
│
├─ 1. 多部件文件解析 → 文件缓冲
├─ 2. resolveAiDocumentStrategy() → 文档策略（意图路由 + 范围 + 源策略 + 长度策略）
├─ 3. deriveEvidencePreflight() → 证据需求列表（URL/文档/图片/页面/搜索）
├─ 4. resolveTemplate() → 三层模板合并（系统 → 工作区 → 用户）
├─ 5. http.request SSE 代理 → Python Agent Service
│
▼
Python Agent Service（FastAPI main.py）
│
├─ POST /agent/run → 创建 asyncio.Queue → 编译 LangGraph 图 → astream()
│
▼
LangGraph 固定图拓扑（graph.py）
│
├─ Node 1: router（line 22）
│   └─ 仅设置 phase="router"，无决策逻辑
│
├─ Edge: route_after_router（line 26）
│   ├─ selection_edit → 直接跳到 writer
│   └─ 其他 → evidence_acquirer
│
├─ Node 2: evidence_acquirer（evidence_acquirer.py）
│   ├─ 按 evidence_items 列表执行：URL抓取 / 文档解析 / 图片理解 / 页面读取 / 网络搜索
│   ├─ Docling 提取文档文本 + 图片
│   ├─ 图片上传到 Docmost 获取真实 URL
│   └─ 结果存入 state.research_results / parsed_files / generated_images
│
├─ Node 3: evidence_gate（evidence_gate.py）
│   └─ 如果必需证据获取失败 → phase="blocked" → END
│
├─ Edge: route_after_evidence_gate（line 40）
│   ├─ blocked → END
│   ├─ selection_edit → writer
│   └─ 其他 → explorer
│
├─ Node 4: explorer（explorer.py line 139）
│   ├─ document_transform → 跳过研究规划，直接 build_source_first_plan()
│   ├─ 其他 → LLM 生成研究计划（最多 10 步）
│   └─ 按计划执行：parse / crawl / search / page_read / knowledge_search / vision / image
│
├─ Edge: route_after_explorer（line 33）
│   ├─ document_transform → writer（跳过澄清、方案、规划、大纲）
│   └─ 其他 → clarifier
│
├─ Node 5: clarifier（clarifier.py）[INTERRUPT]
│   └─ LLM 生成最多 3 个问题 → 等待用户回答
│
├─ Node 6: proposer（proposer.py）[INTERRUPT]
│   └─ LLM 生成最多 3 个方案 → 等待用户选择
│
├─ Node 7: planner（planner.py line 46）
│   └─ LLM 生成 JSON 文档计划：sections[{title, goal, artifacts, must_cover, evidence}]
│
├─ Node 8: outliner（outliner.py line 48）[INTERRUPT]
│   └─ LLM 生成 Markdown 大纲 → 等待用户确认/修改/重新生成
│
├─ Node 9: writer（writer.py line 132）
│   ├─ 拼接超长 prompt：策略 + 计划 + 意图 + 长度指令 + 系统提示 + 模板 + 修订反馈 + 大纲 + 页面内容(32k) + 选区 + 解析文件(每个12k) + 研究结果(每个12k)
│   ├─ 一次性调用 LLM 生成完整文档
│   ├─ _strip_empty_images() 清理无效图片
│   └─ 流式推送内容块
│
├─ Node 10: reviewer（reviewer.py line 77）
│   ├─ _auto_fix() 预清理
│   ├─ evaluate_document_quality() 确定性检查：缺失章节/工件/覆盖点/过度压缩
│   ├─ LLM 评审：返回 JSON {passes, issues, needs_rewrite, revised_content}
│   ├─ 合并确定性 + LLM 的 issues 和 needs_rewrite
│   └─ 如果 needs_rewrite → 用 revised_content 替换原稿
│
├─ Edge: route_after_reviewer（line 46）
│   ├─ needs_revision AND iteration_count < 3 → writer（重写全文）
│   └─ 否则 → END
│
▼
SSE 事件流（asyncio.Queue → http.request 代理 → 浏览器）
│
▼
前端事件处理（use-ai-create-session.ts）
│
├─ handleRunEvent(): content_delta / step_start / step_done / await_input / done / error
├─ 累积 Markdown 内容
├─ 交互式气泡（clarify / propose / outline）
├─ finalizeRun() → creatorCommit() 写入页面
└─ 或保留在聊天面板供用户手动插入
```

### 2.2 关键代码位置索引

| 模块 | 文件路径 | 关键行号 |
|------|----------|----------|
| 图拓扑 | `agent-service/app/agent/graph.py` | 61-107（build_agent_graph） |
| 路由决策 | `agent-service/app/agent/graph.py` | 26-58（4 个 route 函数） |
| 状态定义 | `agent-service/app/agent/state.py` | 14-70（45+字段TypedDict） |
| 证据获取 | `agent-service/app/agent/nodes/evidence_acquirer.py` | 16-183 |
| 研究规划 | `agent-service/app/agent/nodes/explorer.py` | 139-411 |
| 澄清问答 | `agent-service/app/agent/nodes/clarifier.py` | 全文 |
| 方案提议 | `agent-service/app/agent/nodes/proposer.py` | 全文 |
| 文档规划 | `agent-service/app/agent/nodes/planner.py` | 46-116 |
| 大纲生成 | `agent-service/app/agent/nodes/outliner.py` | 48-146 |
| 内容写作 | `agent-service/app/agent/nodes/writer.py` | 132-265 |
| 长度指令 | `agent-service/app/agent/nodes/writer.py` | 88-101 |
| 图片指令 | `agent-service/app/agent/nodes/writer.py` | 52-71 |
| 质量审核 | `agent-service/app/agent/nodes/reviewer.py` | 77-179 |
| 确定性检查 | `agent-service/app/agent/quality_checks.py` | 61-141 |
| 文档策略 | `apps/server/src/ee/ai/document-strategy.ts` | 163-256 |
| 证据预检 | `apps/server/src/ee/ai/evidence-preflight.ts` | 261-320 |
| 前端意图 | `apps/client/src/ee/ai/services/ai-intent.ts` | 全文 |
| 会话管理 | `apps/client/src/ee/ai/hooks/use-ai-create-session.ts` | 全文 |
| 事件规范化 | `apps/client/src/ee/ai/services/ai-create-runner.utils.ts` | 全文 |
| 编辑器写入 | `apps/client/src/ee/ai/components/ai-creator/ai-creator-writeback.ts` | 全文 |

---

## 3. 核心设计缺陷清单

### 缺陷 D1：固定流水线拓扑，无动态编排能力
- **位置**：`graph.py:61-107`
- **现象**：所有任务走同一张图，只有3个条件分支（selection_edit 跳writer、document_transform 跳writer、其他走全流程）
- **影响**："翻译这段"和"基于 5 份资料写一篇 PRD"走几乎相同的路径
- **优先级**：P0
- **复杂度**：高（需要重新设计编排层）
- **预期收益**：简单任务 10x 加速，复杂任务质量显著提升

### 缺陷 D2：一次性全文生成，无分块写作能力
- **位置**：`writer.py:132-265`
- **现象**：Writer 节点一次 LLM 调用生成完整文档，所有素材、大纲、上下文塞进一个 prompt
- **影响**：5000 字被压缩到 2000 字；LLM 天然的长度衰减无法对抗
- **优先级**：P0
- **复杂度**：中（分章节调用，每章传入全局大纲 + 前章摘要 + 当前章节要求）
- **预期收益**：篇幅保持率从 ~40% 提升到 ≥90%

### 缺陷 D3：审核 = 重写，不是评估 + 定点修复
- **位置**：`reviewer.py:77-179`
- **现象**：Reviewer 让 LLM 返回 `revised_content`（全文重写），needs_rewrite 时直接替换原稿
- **影响**：内容漂移、信息丢失、截断；每次"审核"都是一次不可控的重写
- **优先级**：P0
- **复杂度**：中
- **预期收益**：消除审核引发的内容漂移

### 缺陷 D4：图片处理完全被动，无规划能力
- **位置**：`writer.py:52-71`（图片指令），`explorer.py:254-298`（图片提取）
- **现象**：
  - 图片生成在 evidence 阶段，与最终文档结构脱节
  - Writer 的 `_build_image_instructions` 只是列出可用图片让 LLM 自己放
  - 永远只生成一张图（如果有的话）
  - 不会基于内容判断哪里需要配图
- **影响**：用户期望图文并茂，实际产出几乎无图或图文不匹配
- **优先级**：P0
- **复杂度**：高
- **预期收益**：从"无图/单图"进化到"智能多图配置"

### 缺陷 D5：素材提取浅层化，无结构化资产管理
- **位置**：`explorer.py:254-298`
- **现象**：
  - Docling 提取文档文本，但只作为一个大字符串存入 `parsed_files`
  - 图片提取后只记录 URL 和简单描述，不做内容理解
  - 表格、代码块、Mermaid 图不做提取
  - 排版优化时原图信息丢失
- **影响**：素材复用率极低，"优化排版"时丢失原文图片
- **优先级**：P0
- **复杂度**：中
- **预期收益**：素材复用率从 ~0% 提升到 ≥80%

### 缺陷 D6：意图识别在网关侧静态完成，Agent 无自主判断能力
- **位置**：`document-strategy.ts:163-202`，`ai-intent.ts`（前端），`evidence-preflight.ts:261-320`
- **现象**：
  - 意图路由由 NestJS 网关通过关键词匹配确定，在 Agent 启动前就锁定
  - Agent 无法质疑或调整意图判断
  - 缺少复杂度评估机制
- **影响**：用户说"优化排版"但系统判断为 document_transform 走重写逻辑
- **优先级**：P1
- **复杂度**：中
- **预期收益**：意图识别准确率显著提升

### 缺陷 D7：长度控制靠 prompt 请求，无架构级保障
- **位置**：`writer.py:88-101`（长度指令），`reviewer.py:127-131`（压缩检查）
- **现象**：
  - `_build_length_instruction` 用 `split()` 计数（对中文不准确）
  - 只告诉 LLM 目标字数，无执行保障
  - Reviewer 只检查总字数比例，不检查章节级字数
- **影响**：LLM 忽略字数约束，章节级压缩不均
- **优先级**：P0
- **复杂度**：中（分块写作 + 章节字数预算自然解决）
- **预期收益**：篇幅保持率 ≥90%

### 缺陷 D8：上下文窗口当垃圾桶，无注意力管理
- **位置**：`writer.py:178-244`
- **现象**：所有素材、大纲、研究结果、页面内容拼接到一个 prompt，总长可达 10 万+ token
- **影响**：关键信息被淹没在大量无关上下文中，LLM 注意力衰减
- **优先级**：P1
- **复杂度**：中（分块写作自然解决——每章只传入相关素材）
- **预期收益**：生成质量提升，token 成本下降

### 缺陷 D9：澄清机制僵硬，一次触发一批问题
- **位置**：`clarifier.py`
- **现象**：
  - 最多 3 个问题，一次性抛出
  - 不基于用户回答追问
  - 没有 UI 选项化，用户必须手打答案
  - 不区分任务复杂度（简单任务也可能被问）
- **影响**：澄清深度不足，用户体验差
- **优先级**：P1
- **复杂度**：中
- **预期收益**：意图理解准确率提升，用户满意度提升

### 缺陷 D10：document_transform 跳过所有规划
- **位置**：`graph.py:33-37`（route_after_explorer），`explorer.py:80-111`（build_source_first_plan）
- **现象**：document_transform类型从explorer直接跳到writer，跳过clarifier→proposer→planner→outliner全部规划阶段
- **影响**：最高优先级场景（基于素材深度创作）反而得到最少的思考和规划
- **优先级**：P0
- **复杂度**：低（路由调整）
- **预期收益**：P0 场景质量大幅提升

---

## 4. 根因分析

### 4.1 Prompt 设计问题

| 问题 | 代码位置 | 根因 | 影响 |
|------|----------|------|------|
| 长度指令是"请求"不是"保障" | `writer.py:88-101` | prompt 级约束无法强制执行，LLM 有天然的长度衰减倾向 | 5000→2000 压缩 |
| 中文字数用 `split()` 计数 | `writer.py:91` | `split()` 按空白分割，中文无空格，一整段中文算一个"词" | 字数目标完全不准 |
| 作者提示过长 | `writer.py:178-244` | 所有上下文无差别拼接 | 注意力衰减，关键约束被忽略 |
| 反 AI 风格规则是静态的 | `writer.py:36-45` | 硬编码在 system prompt 中，不随文档类型/风格调整 | 技术文档也被强制"混合段落长度" |

### 4.2 Agent 决策机制问题

| 问题 | 代码位置 | 根因 | 影响 |
|------|----------|------|------|
| 路由在编译时确定 | `graph.py:61-107` | LangGraph 的静态图拓扑 | 无法动态调整工作流 |
| 无复杂度评估 | 全局缺失 | 没有 Level 1/2/3 判断机制 | 简单任务过度处理，复杂任务处理不足 |
| 无置信度评估 | 全局缺失 | Agent 从不说"我不确定" | 不确定时猜测而非提问 |

### 4.3 缺少意图识别与任务规划

| 问题 | 代码位置 | 根因 | 影响 |
|------|----------|------|------|
| 意图由网关静态判断 | `document-strategy.ts:163-202` | 关键词匹配，非语义理解 | "优化排版"被误判为"重写" |
| P0 场景跳过规划 | `graph.py:33-37` | document_transform 的路由硬编码跳过 clarifier/proposer/planner/outliner | 仿写/改写任务无规划 |
| 无任务分解 | 全局缺失 | 没有"这个任务需要几步"的分析 | 一次性执行所有步骤 |

### 4.4 上下文窗口与长文处理策略

| 问题 | 代码位置 | 根因 | 影响 |
|------|----------|------|------|
| 一次性生成全文 | `writer.py:132-265` | 没有分块写作机制 | 长文被压缩 |
| 每个素材截断到 12k 字符 | `writer.py:108` | 简单粗暴的截断，不做摘要 | 素材后半段信息丢失 |
| 页面内容截断到 32k | `writer.py` | 同上 | 长页面的尾部内容丢失 |
| 上下文无优先级 | `writer.py:178-244` | 所有上下文平等拼接 | 关键信息被淹没 |

### 4.5 工作流设计过于僵化

| 问题 | 代码位置 | 根因 | 影响 |
|------|----------|------|------|
| 3 条固定路径 | `graph.py:26-58` | 只有selection_edit / document_transform /其他清晰路由 | 无法适应"仅排版"、"多文档合并"等场景 |
| 修订 = 全文重写 | `graph.py:46-51` | need_revision → 重新走 writer 节点 | 修一个错别字也要重写全文 |
| 最多 3 次修订 | `graph.py:47` | 硬编码 max_iterations=3 | 无法保证质量就截止 |

### 4.6 缺少素材预处理与资源复用

| 问题 | 代码位置 | 根因 | 影响 |
|------|----------|------|------|
| 素材只提取文本 | `explorer.py:254-298` | Docling 的结构化输出未被利用 | 表格、代码块、图片内容丢失 |
| 图片只记录 URL | `explorer.py:267-290` | 提取后只存 `{url, desc, context}` | Writer 不知道图片内容，无法做智能放置 |
| 无资产清单 | 全局缺失 | 没有资产地图概念 | 无法做素材复用决策 |
| 每次运行重新获取 | 全局缺失 | 无素材缓存 | 修改草稿要重跑全部素材解析 |

### 4.7 审核机制设计错误

| 问题 | 代码位置 | 根因 | 影响 |
|------|----------|------|------|
| 审核 = 重写 | `reviewer.py:156-159` | LLM 返回 revision_content 全文 | 内容漂移、信息丢失 |
| 确定性检查 + LLM 审核未分离 | `reviewer.py:115-156` | 两者混在一起，结果混合 | 无法区分"格式问题"和"内容问题" |
| 压缩阈值过于粗糙 | `reviewer.py:127` | `len(draft) < max(400, int(len(source_text) * 0.7))` 只看总字符数 | 章节级压缩检测不到 |
| 审核结果用户不可见 | 全局设计 | 内部决策，不呈现给用户 | 用户无法参与质量决策 |

### 4.8 模型能力与调用方式不匹配

| 问题 | 代码位置 | 根因 | 影响 |
|------|----------|------|------|
| 所有节点用同一个模型 | `agent-service/app/agent/llm.py` | 没有模型路由 | 成本高、效率低 |
| 没有延伸思考 | 全局缺失 | LLM 调用不使用思考模式 | 复杂任务推理不足 |
| 图片生成模型固定 | `agent-service/app/config.py` | 硬编码一种后端 | 不同类型图片需要不同模型 |

---

## 5. 业务思维误区总结

### 误区 1：把复杂创作任务当成固定流水线

**表现**：当前的 LangGraph 图是一条带少量分支的流水线，所有文档创作任务都走相同的路径。

**根本问题**：文档创作不是制造业流水线。一篇产品 PRD 和一份会议纪要的创作过程完全不同——前者需要深度调研、需求分析、多方案对比；后者只需要把已有信息结构化。用同一条流水线处理这两种任务，要么过度处理简单任务（浪费时间），要么欠缺处理复杂任务（质量差）。

**正确思维**：动态编排——一个智能 Orchestrator 根据任务特征实时决定下一步做什么，而不是沿着预设轨道滑行。

### 误区 2：没有"先理解目标，再生成计划，再执行"的分层思维

**表现**：`document_transform`（P0 场景）直接从 explorer 跳到 writer，跳过所有规划环节。

**根本问题**：系统假设"素材 + prompt = 足够的上下文"，但实际上用户的 prompt 通常是模糊的（"帮我仿写一份类似的"），需要大量隐含知识的澄清（受众是谁？哪些章节要保留？配图要不要？篇幅什么要求？）。

**正确思维**：创作 = 理解（40%） + 规划（30%） + 执行（20%） + 精修（10%）。当前系统把 90% 的计算花在执行上。

### 误区 3：审核 = 重写，而不是评估 + 定点修复

**表现**：Reviewer 让 LLM 同时输出 `issues` 和 `revised_content`，实际使用 `revised_content` 作为最终产出。

**根本问题**：让一个模型同时做"评价者"和"修改者"，两个角色会互相干扰。作为评价者应该苛刻客观，作为修改者应该保守谨慎——但合在一个调用里，模型倾向于"既然我要改，那我按自己的理解改好了"，导致过度修改。

**正确思维**：评价和修复必须分离——先有独立的评价报告（结构化、可量化），再基于报告做定向修复（只改被标记的问题，其余文字一个字不动）。

### 误区 4：把文档当成一维文本流，而不是多维创作对象

**表现**：Writer 只输出 Markdown 文本，图片、表格、Mermaid 图都是"内嵌在文本中的字符串"，没有独立的生命周期。

**根本问题**：一篇高质量文档是一个包含文本、结构、图片、表格、代码、流程图的复合对象。每种元素有自己的创建逻辑、质量标准和展示方式。把它们全部压缩成 Markdown 字符串，意味着：
- 图片没有独立的规划和生成流程
- 表格没有独立的数据验证
- Mermaid 图没有语法检查
- 排版优化时无法区分"改文字"和"改结构"

**正确思维**：文档 = 骨架（大纲结构） + 血肉（文本内容） + 器官（图表、代码、流程图） + 皮肤（排版格式）。每层独立管理，最后合成。

### 误区 5：缺少对创作维度的显式建模

**表现**：当前系统只有粗糙的 `length_policy`（preserve/compress/expand）和 `source_policy`（preserve/transform/create），缺少对篇幅、结构、风格、素材、受众、配图等维度的独立控制。

**根本问题**：用户的需求是多维的——"保持原文结构，但换一种更轻松的语气，篇幅缩短 30%，原图保留但加上中文标注"——但系统只能理解"preserve"或"transform"这种一维标签。

**正确思维**：每个创作维度（结构、篇幅、风格、素材、受众、配图）应该有独立的策略参数，在 Smart Brief 阶段显式确认，在 Blueprint 中体现为具体计划，在写作中逐项执行。

---

## 6. 行业对标与差距分析

### 6.1 对标矩阵

| 能力维度 | Claude Code | 光标 | Devin | Manus | Notion AI | Docmost | 差距 |
|----------|-------------|--------|-------|-------|-----------|-------------|------|
| 动态编排 | ✅ 单循环自适应 | ✅ 代理模式 RL | ✅ 动态规划 | ✅ todo.md 驱动 | ✅ 中央推理 | ❌ 固定图 | 🔴 根本性 |
| 复杂度判断 | ✅ 拓展思维 | ✅ 多模式（选项卡/聊天/作曲家） | ✅ 置信度升级 | ✅ 任务分解 | ✅ 模型路由 | ❌ 无 | 🔴 根本性 |
| 分块执行 | ✅ 子 Agent 并行 | ✅ 多文件协调 | ✅ 子任务拆分 | ✅ 并行子 Agent | ✅ 子 Agent | ❌ 一次性全文 | 🔴 根本性 |
| 中间态可见 | ✅ 工具调用透明 | ✅ diff 预览 | ✅ 计划可修改 | ✅ 文件可查看 | ⚠️ 部分 | ⚠️3个中断 | 🟡 需扩展 |
| 质量验证 | ✅ 运行测试 | ✅ 棉绒/类型检查 | ✅ Critic 独立模型 | ⚠️ 基础 | ⚠️ 基础 | ❌ 审核=重写 | 🔴 设计错误 |
| 上下文管理 | ✅ 内存压缩 | ✅ 嵌入索引 | ⚠️ 事件溯源 | ✅ KV 缓存优化 | ✅ block 结构 | ❌ 全量拼接 | 🔴 根本性 |
| 风格/品牌 | N/A | ✅ .cursorrules | N/A | ⚠️ 基础 | ✅ 品牌声音 | ⚠️ 硬编码反AI | 🟡 需升级 |
| 多模态资产 | N/A | N/A | ⚠️ 基础 | ⚠️ 基础 | ✅ block元数据 | ❌ 被动处理 | 🔴 缺失 |
| 中断恢复 | ✅ h2A 双缓冲 | ✅ 实时编辑 | ✅ 中途协作 | ✅ 进度文件 | ⚠️ 基础 | ⚠️固定中断 | 🟡 需增强 |
| 模型路由 | ⚠️ 单模型 | ✅ 混合模型 | ✅ 规划者/编码者/评审家 | ⚠️ 基础 | ✅ 任务路由 | ❌ 单模型 | 🟡 需增加 |

### 6.2 外部 Skills 借鉴分析

来源：`C:\Users\leo\Desktop\AI教程\.agents\skills`

| Skill | 核心设计 | 可借鉴到 Docmost 的点 |
|-------|----------|---------------------|
| **内容研究作家** | 协作伙伴模型 + 逐章节反馈 + 声音匹配 + 引用管理 | ① 逐章节写作+反馈循环 ② 风格学习机制 ③ 引用追踪 |
| **深入研究** | 5 步系统研究 + 置信度 + 共识/争议分离 | ① 研究结果带置信度 ② 发现-共识-争议结构化输出 |
| **技术写作** | 同行语气 + 段落优于列表 + 避免懒惰描述词 | ① 丰富反 AI 风格规则库 ② 文档类型特化的风格约束 |
| **教程文档** | "You should see" 确认模式 + 学习即实践 | ① 教程类文档的分步验证机制 |
| **教程生成器** | 12 部分结构 + 品牌声音 + 故障排除段 | ① 结构化模板的深度定义 ② 故障排除作为标准章节 |
| **网络研究** | 文件式通信 + 并行子 Agent + 研究计划先行 | ① 研究计划文件化 ② 并行子 Agent 研究模式 |

---

## 7. 新架构设计

### 7.1 整体架构

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
│  │              Orchestrator (强模型)                 │  │
│  │                                                  │  │
│  │  ReAct Loop:                                     │  │
│  │  1. 接收用户输入 + 当前状态                        │  │
│  │  2. 分析复杂度（Level 1/2/3）                     │  │
│  │  3. 决定下一步 action（tool call）                │  │
│  │  4. 调度 Worker 执行                              │  │
│  │  5. 需要用户输入 → yield 暂停                     │  │
│  │  6. 循环直到 "done"                               │  │
│  └──────┬───────────────────────────────────────────┘  │
│         │ Tool Calls                                    │
│  ┌──────┴───────────────────────────────────────────┐  │
│  │                 Worker Pool                       │  │
│  │                                                  │  │
│  │  ┌─────────────┐  ┌─────────────┐               │  │
│  │  │ AssetParser │  │ Researcher  │               │  │
│  │  │ (确定性代码) │  │ (LLM+Tools) │               │  │
│  │  │ - Docling   │  │ - Tavily    │               │  │
│  │  │ - 图片提取  │  │ - Firecrawl │               │  │
│  │  │ - 表格提取  │  │ - RAG       │               │  │
│  │  │ - 代码块提取│  │ - Page Read │               │  │
│  │  │ - Mermaid   │  │             │               │  │
│  │  └─────────────┘  └─────────────┘               │  │
│  │                                                  │  │
│  │  ┌─────────────┐  ┌─────────────┐               │  │
│  │  │ SectionWriter│  │ VisualPlanner│              │  │
│  │  │ (快速模型)   │  │ (中等模型)   │               │  │
│  │  │ - 单章节写作 │  │ - Mermaid生成│               │  │
│  │  │ - 滑动窗口  │  │ - 图片生成   │               │  │
│  │  │ - 字数预算  │  │ - 图片选择   │               │  │
│  │  │ - 风格约束  │  │ - 标注建议   │               │  │
│  │  └─────────────┘  └─────────────┘               │  │
│  │                                                  │  │
│  │  ┌─────────────┐  ┌─────────────┐               │  │
│  │  │ Evaluator   │  │ Fixer       │               │  │
│  │  │ (确定性+LLM) │  │ (快速模型)  │               │  │
│  │  │ - 结构检查  │  │ - 定点修复  │               │  │
│  │  │ - 字数验证  │  │ - 只改标记项│               │  │
│  │  │ - 素材覆盖  │  │ - 格式自动修│               │  │
│  │  │ - Issue 卡片│  │             │               │  │
│  │  └─────────────┘  └─────────────┘               │  │
│  │                                                  │  │
│  │  ┌─────────────┐                                │  │
│  │  │ UserInteract│  ← ask_user / show_brief /     │  │
│  │  │ (事件推送)  │    show_blueprint / show_review │  │
│  │  └─────────────┘                                │  │
│  └──────────────────────────────────────────────────┘  │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │              Structured State Store               │  │
│  │                                                  │  │
│  │  - brief: {audience, goal, length, style, ...}   │  │
│  │  - asset_map: {texts[], images[], tables[], ...} │  │
│  │  - blueprint: {sections[], visual_plan[], ...}   │  │
│  │  - draft: {sections[{content, word_count}], ...} │  │
│  │  - review: {issues[], auto_fixes[], ...}         │  │
│  │  - progress: {current_phase, completed[], ...}   │  │
│  │                                                  │  │
│  │  持久化：Redis (热数据) + PostgreSQL (冷数据)      │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

### 7.2 Orchestrator详细设计

```python
# 核心编排循环（伪代码）
from pydanticai import Agent, Tool

orchestrator = Agent(
    model="claude-sonnet",  # 或根据配置选择
    system_prompt=ORCHESTRATOR_SYSTEM_PROMPT,
    tools=[
        analyze_complexity,    # → Level 1/2/3
        parse_assets,          # → AssetMap
        research,              # → ResearchResults
        ask_user,              # → 暂停等用户（Brief/Blueprint/Review）
        create_blueprint,      # → Blueprint（含大纲+字数预算+配图规划）
        write_section,         # → SectionDraft（单章）
        write_sections_parallel,  # → SectionDraft[]（多章并行）
        generate_visual,       # → Mermaid/Image URL
        evaluate_quality,      # → ReviewReport
        fix_issues,            # → 定点修复
        finalize,              # → 合并所有章节为最终文档
    ],
)

async def run_creation(user_input, state):
    async for event in orchestrator.run_stream(user_input, state):
        if event.type == "tool_call":
            yield SSEEvent(step_start=event.tool_name)
        elif event.type == "tool_result":
            yield SSEEvent(step_done=event.tool_name)
            state.update(event.result)
        elif event.type == "user_interrupt":
            yield SSEEvent(await_input=event.data)
            user_response = await wait_for_resume()
            state.update(user_response)
        elif event.type == "content":
            yield SSEEvent(content_delta=event.chunk)
        elif event.type == "done":
            yield SSEEvent(done=state.final_content)
            break
```

### 7.3 Orchestrator系统提示设计

```markdown
你是一个文档创作 Orchestrator。你的职责是理解用户的创作意图，
制定计划，协调多个 Worker 执行，并确保最终产出满足用户期望。

## 决策原则

1. **先理解，再规划，再执行**
   - 收到任务后，首先用 analyze_complexity 判断任务级别
   - Level 1：直接调用相应工具执行（翻译、改错、精简）
   - Level 2：快速确认关键参数后执行（排版优化、续写）
   - Level 3：完整走 Brief → Blueprint → Write → Review 流程

2. **动态调整**
   - 如果执行过程中发现任务比预期复杂，升级处理级别
   - 如果用户反馈不满意，分析原因后调整策略
   - 不要机械执行，要思考每一步是否合理

3. **素材优先**
   - 用户上传了素材，必须先 parse_assets 提取所有可用资源
   - 在 Blueprint 中明确标注每个素材的使用位置
   - 素材复用率目标 ≥80%

4. **篇幅保障**
   - 在 Blueprint 中为每个章节分配字数预算
   - 每个章节独立生成，字数预算 ±10% 容差
   - 生成后用 evaluate_quality 验证字数

5. **用户交互**
   - 使用 ask_user 时，提供结构化选项 + AI 推荐默认值
   - Brief 阶段：受众、目标、篇幅、风格、配图需求
   - Blueprint 阶段：章节结构 + 字数 + 配图计划
   - Review 阶段：Issue 卡片列表，用户勾选修复项

6. **图片规划**
   - 在 Blueprint 阶段判断每个章节是否需要配图
   - 区分：Mermaid 图（可自动生成）/ AI 图片（需生成）/ 素材图（可复用）
   - 在 ask_user 展示 Blueprint 时包含配图规划

7. **质量控制**
   - 写作完成后，用 evaluate_quality 做结构化评估
   - 格式类问题（错别字、标题层级）自动用 fix_issues 修复
   - 内容类问题生成 Issue 卡片，通过 ask_user 让用户决定
```

### 7.4 结构化中间态定义

```python
from pydantic import BaseModel
from typing import Literal

# 1. Smart Brief — 创作简报
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

# 2. Asset Map — 素材清单
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

# 3. Creation Blueprint — 创作蓝图
class SectionPlan(BaseModel):
    id: str
    title: str
    level: int                             # 标题层级 (1-3)
    word_budget: int                       # 字数预算
    description: str                       # 本章目标
    assets: list[str]                      # 引用的 AssetItem.id 列表
    visuals: list[VisualPlan]              # 配图计划
    must_cover: list[str]                  # 必须覆盖的要点

class VisualPlan(BaseModel):
    type: Literal["mermaid", "ai_image", "reuse_image", "table"]
    description: str                       # 图片描述
    source_asset_id: str | None            # 如果是复用，指向 AssetItem.id
    position: Literal["before_section", "after_paragraph", "end_of_section"]

class CreationBlueprint(BaseModel):
    title: str
    sections: list[SectionPlan]
    total_word_budget: int
    style_guide: str                       # 风格指南
    visual_plan_summary: str               # 配图规划摘要

# 4. Section Draft — 章节草稿
class SectionDraft(BaseModel):
    section_id: str
    content: str                           # Markdown 内容
    word_count: int                        # 实际字数
    budget_compliance: float               # 字数预算达标率
    assets_used: list[str]                 # 实际使用的素材 ID
    visuals_generated: list[str]           # 生成的图片 URL

# 5. Review Report — 评审报告
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

### 7.5 分块写作详细流程

```
Orchestrator 决定开始写作
│
├─ 1. 从 Blueprint 提取章节列表
│
├─ 2. 为每个章节准备上下文包：
│     ┌─────────────────────────────────────────┐
│     │ Section Context Package                  │
│     │                                         │
│     │ - 全局信息：文档标题、目标、风格指南      │
│     │ - 全局大纲：所有章节标题（定位感）        │
│     │ - 前文摘要：前一章的最后 2 段 + 摘要      │
│     │ - 后文预告：后一章的标题 + 目标（过渡感）  │
│     │ - 当前章节：标题 + 目标 + 字数预算        │
│     │ - 相关素材：仅当前章节引用的 AssetItem    │
│     │ - 配图指令：当前章节的 VisualPlan        │
│     │ - 必须覆盖：must_cover 清单              │
│     └─────────────────────────────────────────┘
│
├─ 3. 调用 write_section（可并行多章节）
│     - 每章独立 LLM 调用
│     - 流式输出，前端实时显示进度
│     - 完成后立即验证字数预算
│
├─ 4. 章节间一致性扫描
│     - 术语统一检查
│     - 前后引用一致性
│     - 过渡段落自然度
│
└─ 5. 合并所有章节 → Draft
```

### 7.6 Level 1/2/3 执行路径对比

```
Level 1（直接执行）— 翻译、改错、精简、改语气
─────────────────────────────────────────────
用户输入 → analyze_complexity → Level 1
         → 直接调用对应工具（单次 LLM 调用）
         → 输出结果
         → 完成
耗时：5-15 秒

Level 2（轻量确认）— 排版优化、续写、扩展
─────────────────────────────────────────────
用户输入 → analyze_complexity → Level 2
         → parse_assets（提取当前页面素材）
         → ask_user（Smart Brief 精简版：确认风格/配图/保留项）
         → write_section（可能多章，保持原结构）
         → 自动格式修复
         → 输出结果
         → 完成
耗时：30-90 秒

Level 3（完整流程）— 从零创作、仿写、多文档合并
─────────────────────────────────────────────
用户输入 → analyze_complexity → Level 3
         → parse_assets（深度素材提取）
         → research（如需要）
         → ask_user（Smart Brief 完整版）
         → create_blueprint
         → ask_user（Creation Blueprint 展示+编辑）
         → write_sections_parallel（分章节并行写作）
         → generate_visual（配图生成）
         → evaluate_quality
         → ask_user（Review Card — 如有需要用户决定的 issue）
         → fix_issues（定点修复）
         → finalize（合并+一致性扫描）
         → 完成
耗时：2-5 分钟
```

---

## 8. 审核机制重构方案

### 8.1当前问题（reviewer.py）

```
当前流程：
LLM 同时输出 issues + revised_content
   → needs_rewrite? → 用 revised_content 替换原稿（全文重写）
   → 再次走 writer → reviewer 循环（最多 3 次）

问题：
1. 审核者和修改者是同一个 LLM 调用 → 角色冲突
2. revised_content 是全文重写 → 内容漂移
3. 每次修订重走 writer → 等于从头写 → 丢失之前的好内容
4. 用户不可见 → 无法参与决策
```

### 8.2 新审核流程

```
新流程：

步骤 1：确定性检查（Evaluator Worker — 代码逻辑，不用 LLM）
├─ 每章字数 vs 预算 → 偏差超过 ±10% 标记为 length issue
├─ 素材引用率 → 未使用的素材标记为 asset issue
├─ 必须覆盖点 → 缺失的标记为 content issue
├─ Mermaid 语法检查 → 语法错误标记为 format issue
├─ 图片 URL 有效性 → 无效链接标记为 visual issue
├─ 标题层级规范 → 跳级标记为 format issue
└─ 输出：ReviewIssue[]（severity + category + auto_fixable）

步骤 2：LLM 质量评估（Evaluator Worker — 中等模型）
├─ 输入：草稿 + Blueprint + Brief（不要求输出修改后内容）
├─ 输出：JSON {overall_score, issues[{description, severity, section_id}]}
├─ 评估维度：准确性、完整性、风格一致性、可读性、论据充分性
└─ 合并到 ReviewIssue[]

步骤 3：自动修复（Fixer Worker — 快速模型）
├─ 遍历 auto_fixable=true 的 issues
├─ 每个 issue 单独修复（传入目标章节 + issue 描述 + 修复指令）
├─ 修复后标记 fixed=true
└─ 不触碰非 auto_fixable 的内容

步骤 4：用户决策（ask_user — Review Card）
├─ 展示 ReviewReport：总分 + 各维度得分 + Issue 卡片列表
├─ 用户勾选需要修复的 issue
├─ 用户可以添加自定义修改意见
└─ 点击"修复选中项"

步骤 5：定向修复（Fixer Worker）
├─ 只修复用户勾选的 issue
├─ 每个 issue 独立修复：传入目标章节 + issue + 修复指令
├─ 不改动其他内容
└─ 修复完成后可选择再次评估

关键区别：
- 评估和修复完全分离
- 修复是章节级定点修复，不是全文重写
- 格式问题自动修复，内容问题用户决定
- 用户可以看到评审报告，参与决策
```

### 8.3 Review Card接口交互设计

```
┌──────────────────────────────────────────────────────┐
│  📋 质量评审报告                          总分：82/100 │
├──────────────────────────────────────────────────────┤
│                                                      │
│  篇幅达标率：94%  ✅    素材复用率：85%  ✅           │
│  结构完整性：90%  ✅    风格一致性：75%  ⚠️           │
│                                                      │
├──────────────────────────────────────────────────────┤
│  ✅ 已自动修复（3 项）                                │
│  ├─ 修正 2 处标题层级跳级                            │
│  ├─ 修正 1 处 Mermaid 语法错误                       │
│  └─ 清理 1 处无效图片链接                            │
│                                                      │
├──────────────────────────────────────────────────────┤
│  ⚠️ 需要您决定（2 项）                               │
│                                                      │
│  ☐ [warning] 第 3 章"系统架构"字数偏少               │
│     预算 800 字，实际 520 字（-35%）                  │
│     建议：补充架构决策理由和性能考量                    │
│                                                      │
│  ☐ [warning] 第 5 章未引用上传的数据表格               │
│     素材 asset_03（产品对比表）未被使用                 │
│     建议：在竞品分析段落中引用该表格                    │
│                                                      │
│  ┌─────────────────────────────────────────────┐     │
│  │ 补充修改意见（可选）                          │     │
│  │                                             │     │
│  └─────────────────────────────────────────────┘     │
│                                                      │
│          [修复选中项]        [跳过，直接使用]          │
└──────────────────────────────────────────────────────┘
```

---

## 9. 多模态素材与图片规划改造方案

### 9.1 素材创作流程（AssetParser Worker）

```
用户上传文件/提供URL
│
▼
AssetParser Worker（确定性代码 + VLM）
│
├─ 1. 文档解析（Docling）
│   ├─ 提取纯文本 → AssetItem(type="text")
│   ├─ 提取标题结构 → AssetItem(type="heading_structure")
│   ├─ 提取表格 → AssetItem(type="table", content=markdown_table)
│   ├─ 提取代码块 → AssetItem(type="code", content=code_with_lang)
│   └─ 提取内嵌图片 → 下一步
│
├─ 2. 图片处理（VLM + Pillow）
│   ├─ 对每张提取的图片：
│   │   ├─ 上传到 Docmost 获取 URL
│   │   ├─ 调用 VLM 理解图片内容 → summary
│   │   ├─ 判断图片类型：screenshot / diagram / photo / chart / illustration
│   │   └─ → AssetItem(type="image", content=url, summary=vlm_desc)
│   └─ 对用户直接上传的图片：同上
│
├─ 3. Mermaid/流程图检测
│   ├─ 检测文本中的 Mermaid 代码块 → AssetItem(type="mermaid")
│   └─ 检测文本中描述流程/架构的段落 → 标记为"可转化为 Mermaid"
│
├─ 4. 元数据计算
│   ├─ 源文档总字数（正确处理中文：按字符计数而非 split）
│   ├─ 每章字数统计
│   └─ 章节结构树
│
└─ 输出：AssetMap
```

### 9.2 配图规划流程（VisualPlanner Worker）

```
Blueprint 阶段，Orchestrator 调用 VisualPlanner
│
├─ 输入：AssetMap + Blueprint.sections + Brief
│
├─ 对每个章节：
│   ├─ 判断是否需要配图（基于内容分析）
│   │   ├─ 描述流程/步骤 → 需要 Mermaid 流程图
│   │   ├─ 描述架构/关系 → 需要 Mermaid 架构图
│   │   ├─ 数据对比 → 需要表格（已有）或图表
│   │   ├─ 概念说明 → 可能需要 AI 生成说明图
│   │   ├─ 引用素材中的截图 → 复用原图
│   │   └─ 无明显需求 → 不配图
│   │
│   ├─ 如果素材中有可复用的图片：
│   │   ├─ 匹配图片内容与章节主题
│   │   ├─ 决定是否需要重新标注
│   │   └─ → VisualPlan(type="reuse_image", source_asset_id=xxx)
│   │
│   ├─ 如果需要新图：
│   │   ├─ Mermaid → VisualPlan(type="mermaid", description=xxx)
│   │   └─ AI 图片 → VisualPlan(type="ai_image", description=xxx)
│   │
│   └─ → 添加到 SectionPlan.visuals
│
└─ 输出：更新后的 Blueprint（含完整配图规划）
```

### 9.3 图片生成执行

```
写作阶段，每个章节的 VisualPlan 会被执行：

reuse_image：
  → 直接使用 AssetItem 中的 URL
  → 如果需要标注，调用 image_annotate 工具

mermaid：
  → SectionWriter 在章节内容中直接生成 Mermaid 代码块
  → Evaluator 做 Mermaid 语法检查

ai_image：
  → 调用 nanobana_imggen（或其他配置的图片生成 API）
  → 上传到 Docmost 获取 URL
  → 插入到章节指定位置

table：
  → 如果是复用素材表格，直接插入 Markdown 表格
  → 如果是新建，SectionWriter 在章节中生成
```

---

## 10. 前端 UI 重构方案

### 10.1 组件架构

```
apps/client/src/ee/ai/
├── components/
│   ├── ai-creator/
│   │   ├── AiCreatorPanel.tsx              # 侧边栏主面板（保留，重构）
│   │   ├── AiCreatorMessages.tsx           # 消息列表（保留，增强）
│   │   ├── AiCreatorInput.tsx              # 输入区域（保留，增强）
│   │   ├── AiCreatorSelection.tsx          # 选区预览（保留）
│   │   ├── AiCreatorFileList.tsx           # 文件列表（保留）
│   │   ├── AiCreatorMessageItem.tsx        # 消息渲染（保留）
│   │   ├── AiCreatorProgress.tsx           # 【新】进度指示器
│   │   │
│   │   ├── smart-brief/                    # 【新】Smart Brief 卡片
│   │   │   ├── SmartBriefCard.tsx          #   Brief 展示+编辑卡片
│   │   │   ├── BriefFieldSelector.tsx      #   单字段选择器（下拉/标签）
│   │   │   └── AssetMapPreview.tsx         #   素材清单预览
│   │   │
│   │   ├── blueprint/                      # 【新】Creation Blueprint 弹出面板
│   │   │   ├── BlueprintModal.tsx          #   弹出面板容器
│   │   │   ├── SectionList.tsx             #   章节列表（可拖拽排序）
│   │   │   ├── SectionCard.tsx             #   单章节卡片（标题+字数+配图）
│   │   │   ├── VisualPlanGrid.tsx          #   配图规划网格
│   │   │   ├── WordBudgetBar.tsx           #   字数预算可视化
│   │   │   └── BlueprintPreview.tsx        #   实时大纲预览
│   │   │
│   │   ├── live-draft/                     # 【新】实时草稿控制
│   │   │   ├── DraftProgressBar.tsx        #   章节进度条
│   │   │   ├── SectionNav.tsx              #   章节导航（侧边栏内）
│   │   │   └── SectionActions.tsx          #   单章操作（满意/重写）
│   │   │
│   │   ├── review/                         # 【新】Review Card 弹出面板
│   │   │   ├── ReviewModal.tsx             #   弹出面板容器
│   │   │   ├── ReviewScoreBoard.tsx        #   评分面板
│   │   │   ├── IssueCard.tsx               #   单 Issue 卡片（可勾选）
│   │   │   ├── IssueList.tsx               #   Issue 列表
│   │   │   ├── AutoFixSummary.tsx          #   自动修复摘要
│   │   │   └── UserFeedbackInput.tsx       #   用户补充意见输入
│   │   │
│   │   └── draft-manager/                  # 【新】草稿管理
│   │       ├── DraftPanel.tsx              #   草稿预览面板
│   │       ├── DraftDiffView.tsx           #   草稿 vs 原文对比
│   │       └── DraftMergeActions.tsx       #   合并/放弃操作
│   │
│   └── ai-templates/                       # 保留现有模板管理
│
├── hooks/
│   ├── use-ai-create-session.ts            # 重构：状态机 + 中间态管理
│   ├── use-draft-manager.ts                # 【新】草稿管理 Hook
│   ├── use-blueprint-editor.ts             # 【新】蓝图编辑 Hook
│   └── use-review-actions.ts               # 【新】审核操作 Hook
│
├── services/
│   ├── agent-service.ts                    # 重构：适配新 SSE 事件协议
│   ├── draft-service.ts                    # 【新】草稿 CRUD
│   └── ai-intent.ts                        # 精简：复杂度判断移到 Python 侧
│
├── types/
│   ├── agent.types.ts                      # 重构：新事件类型
│   ├── brief.types.ts                      # 【新】Brief 类型
│   ├── blueprint.types.ts                  # 【新】Blueprint 类型
│   ├── review.types.ts                     # 【新】Review 类型
│   └── draft.types.ts                      # 【新】Draft 类型
│
└── stores/
    ├── creation-session.store.ts           # 【新】Jotai store 重构
    ├── draft.store.ts                      # 【新】草稿状态
    └── blueprint.store.ts                  # 【新】蓝图编辑状态
```

### 10.2 弹出式工作台设计

使用Mantine的`Modal`组件（size="xl"，约80vw）：

**蓝图模态**：
- 左侧 60%：章节列表（`@dnd-kit` 拖拽排序） + 每章的字数/配图编辑
- 右侧 40%：实时大纲预览（Markdown 渲染）
- 底部工具栏：总字数统计 + 确认/重新生成按钮

**评审模式**：
- 顶部：评分仪表盘（总分 + 4 个维度进度条）
- 中部：Issue 卡片列表（可勾选，按章节分组）
- 底部：补充意见输入 + 修复选中项/跳过按钮

### 10.3 Smart Brief 卡片设计（侧边栏内）

```
┌──────────────────────────────────┐
│ 📝 创作简报                       │
├──────────────────────────────────┤
│ 目标读者   [技术团队 ▾]  ✏️       │
│ 文档目标   [产品介绍 ▾]  ✏️       │
│ 目标篇幅   [5000 字]    ✏️       │
│ 写作风格   [专业严谨 ▾]  ✏️       │
│ 配图策略   [混合复用 ▾]  ✏️       │
├──────────────────────────────────┤
│ 📎 发现的素材                     │
│ ├─ 3 张图片（2 截图, 1 图表）     │
│ ├─ 2 个表格                      │
│ ├─ 1 段代码                      │
│ └─ 原文结构：5 章 / 4200 字      │
├──────────────────────────────────┤
│      [确认开始]  [修改详情]        │
└──────────────────────────────────┘
```

---

## 11. 分阶段落地路线图

### 阶段 0：基础设施准备（1-2 周）

| 任务 | 优先级 | 复杂度 | 产出 |
|------|--------|--------|------|
| PydanticAI 环境搭建 + 基础学习 | P0 | 低 | PydanticAI 基础代码构建 |
| 定义制定中间状态 Pydantic 模型 | P0 | 低 | `models/` 目录下的所有 Pydantic 模型 |
| 设计新 SSE 事件协议 | P0 | 低 | 事件类型文档 + TypeScript 类型定义 |
| 前端新组件目录结构搭建 | P0 | 低 | 空组件骨架 + 路由注册 |

### 阶段 1：核心编排层重构（2-3 周）

| 任务 | 优先级 | 复杂度 | 产出 | 风险 |
|------|--------|--------|------|------|
| Orchestrator React Loop 实现 | P0 | 高 | 核心编排引擎 | PydanticAI 学习曲线 |
| 分析复杂性工具 | P0 | 中 | Level 1/2/3 分级能力 | 分级准确率需迭代 |
| ask_user 工具 + 中断恢复 | P0 | 中 | 用户交互能力 | SSE 协议需对齐 |
| Level 1 路径打通 | P0 | 低 | 简单任务端到端 | — |
| NestJS 网关适配 | P0 | 低 | SSE 代理 + 文件转发 | 兼容性 |

### 阶段 2：素材与规划能力（2-3 周）

| 任务 | 优先级 | 复杂度 | 产出 | 风险 |
|------|--------|--------|------|------|
| AssetParser 工作者 | P0 | 中 | 结构化素材提取 | Docling 结构化输出需探索 |
| Smart Brief 生成 + 前端辅助 | P0 | 中 | 交互点 1 | UI 交互体验需打磨 |
| 创建蓝图工具 | P0 | 中 | 创作蓝图生成 | 字数预算算法需迭代 |
| 蓝图模态前端 | P0 | 高 | 交互点 2（拖拽、配图编辑） | dnd-kit 集成 |
| 视觉规划师 | P1 | 中 | 智能配图规划 | VLM 调用延迟 |
| Level 2 路径打通 | P0 | 中 | 轻量确认任务端到端 | — |

### 阶段 3：分块写作引擎（2-3 周）

| 任务 | 优先级 | 复杂度 | 产出 | 风险 |
|------|--------|--------|------|------|
| 部门作家工人 | P0 | 高 | 逐章生成 + 滑动窗口 | 章节间一致性 |
| write_sections_parallel 工具 | P0 | 中 | 多章并行写作 | 并发控制 |
| 中文字数精确计算 | P0 | 低 | 替换 split() 为正则计数 | — |
| 字数预算执行 + 验证 | P0 | 中 | 每章字数 ±10% | 超预算时的重试策略 |
| Live Draft 简介 | P1 | 中 | 进度条 + 章节导航 | 流式渲染性能 |
| 草稿管理系统 | P1 | 中 | 独立草稿 + 预览 + 合并 | 草稿存储方案 |
| Level 3 路径打通 | P0 | 高 | 完整流程端到端 | 多组件联调 |

### 阶段 4：审核与修复（1-2 周）

| 任务 | 优先级 | 复杂度 | 产出 | 风险 |
|------|--------|--------|------|------|
| 评估员（确定性检查） | P0 | 中 | 结构化质量评估 | — |
| 评估员（LLM评估） | P0 | 中 | 内容质量评分 | 评估准确率 |
| 固定工（定点修复） | P0 | 中 | 章节级精准修复 | 修复不引入新问题 |
| 回顾模态前端 | P0 | 中 | 交互点 4 | Issue 卡片交互 |
| 自动修复流程 | P1 | 低 | 格式问题自动修 | — |

### 阶段 5：打磨与优化（2-3 周）

| 任务 | 优先级 | 复杂度 | 产出 | 风险 |
|------|--------|--------|------|------|
| 模型路由（不同 Worker 不同模型） | P1 | 中 | 成本优化 + 质量优化 | 配置复杂度 |
| 风格学习（从工作区文档提取风格） | P2 | 高 | 风格一致性 | 风格量化难度 |
| 单章重写能力 | P1 | 中 | 对不满意的章节独立重写 | 一致性维护 |
| 多文档合并场景优化 | P1 | 高 | 多素材合成 | 去重 + 冲突解决 |
| 前端 UI 精修 | P1 | 中 | 动画、过渡、响应式 | — |
| 性能优化（SSE、并行、缓存） | P2 | 中 | 生成速度提升 | — |
| Dify 集成（方向 A） | P2 | 中 | Docmost 作为 Dify 数据源 | API 设计 |

### 阶段 6：旧代码清理（1 周）

| 任务 | 优先级 | 复杂度 | 产出 |
|------|--------|--------|------|
| 删除 LangGraph 相关代码 | P1 | 低 | graph.py,nodes/*.py 旧实现 |
| 删除旧前端组件 | P1 | 低 | 澄清气泡、提议气泡、轮廓气泡 |
| 删除旧事件类型 | P1 | 低 | 过去 AgentSSEEvent 定义 |
| 更新文档 | P2 | 低 | 新架构文档 |

### 总时间线

```
Phase 0 ──┐
           ├── Phase 1 ──┐
           │              ├── Phase 2 ──┐
           │              │             ├── Phase 3 ──┐
           │              │             │             ├── Phase 4 ──┐
           │              │             │             │             ├── Phase 5 ──── Phase 6
           │              │             │             │             │
Week 1-2   Week 3-5       Week 5-7      Week 7-9      Week 9-10     Week 11-14     Week 15
```

**预计总工期：12-15 周**（一人 + AI 辅助开发）

---

## 12. 可量化评估指标

### 12.1 核心指标

| 指标 | 当前估值 | 目标值 | 测量方法 |
|------|----------|--------|----------|
| **篇幅保持率** | ~40%（5000→2000） | ≥90% | `abs(output_words - target_words) / target_words ≤ 0.1` 的比例 |
| **章节字数达标率** | 无（一次性生成） | ≥85% | 每章实际字数 vs 预算，±10% 内的章节比例 |
| **素材复用率** | ~0% | ≥80% | `used_assets / total_available_assets` |
| **审核截断率** | ~30%（每次审核丢内容） | 0% | 审核后字数减少 >5% 的比例 |
| **意图识别准确率** | 未测量 | ≥90% | 用户是否需要手动覆盖 Level 判断 |
| **L3 任务确认轮次** | 3 次（固定） | 3-6 次（自适应） | 从输入到产出的用户交互次数 |
| **5000 字生成时间** | ~3-5 分钟（但质量差） | ≤5 分钟（质量达标） | 从用户首次提交到最终草稿完成 |

### 12.2 质量指标

| 指标 | 当前估值 | 目标值 | 测量方法 |
|------|----------|--------|----------|
| **结构保持率**（仿写场景） | ~50% | ≥85% | 原文章节标题与产出章节标题的匹配率 |
| **配图覆盖率** | ~10%（通常 0-1 张图） | ≥70% | Blueprint 中计划配图的实际生成率 |
| **Review 定点修复率** | 0%（全文重写） | ≥90% | 修复操作只修改目标段落的比例 |
| **内容漂移率** | ~30% | ≤5% | 审核修复后非目标区域的文本变化率 |

### 12.3 用户体验指标

| 指标 | 当前估值 | 目标值 | 测量方法 |
|------|----------|--------|----------|
| **Level 1 响应时间** | 10-30s（走代理流程） | ≤10s | 简单任务从提交到完成 |
| **蓝图满意率** | N/A | ≥80% | 用户不修改 Blueprint 直接确认的比例 |
| **一次性满意率** | ~20% | ≥60% | 用户不需要走 Review 修复的比例 |
| **草稿采用率** | ~50% | ≥80% | 用户最终将草稿合并到页面的比例 |

---

## 附录 A：技术栈变更清单

| 组件 | 当前 | 变更后 | 理由 |
|------|------|--------|------|
| Agent 编排 | 郎图 | 派丹蒂克人工智能 | 动态编排、多供应商、类型安全 |
| 状态管理 | LangGraph StateGraph + PostgreSQL 检查点 | Pydantic 模型 + Redis/PostgreSQL | 更轻量、更灵活 |
| 图拓扑 | 编译时固定 | 协调器动态决策 | 自适应工作流 |
| 中断恢复 | LangGraph 中断() | 自定义 yield + 状态序列化 | 更简单可控 |
| 中文字数 | `split()` | `len(re.findall(r'[\u4e00-\u9fff]', text)) + len(text.split())` | 准确计数 |
| 写作模式 | 一次性全文 | 分章节 + 滑动窗口 | 篇幅保障 |
| 审核模式 | LLM 重写 | 确定性检查 + LLM 评估 + 定点修复 | 消除漂移 |
| 前端弹出面板 | 无 | Mantine 莫代尔 (尺寸=“xl”) | 蓝图/审查需要空间 |
| 前端拖拽 | 无 | @dnd-kit/可排序 | 蓝图章节排序 |
| 草稿存储 | 直接写页面 | Redis 临时存储 + DB 持久化 | 独立草稿机制 |

## 附录 B：删除清单（旧代码）

重构完成后应删除：

| 文件/目录 | 原因 |
|----------|------|
| `agent-service/app/agent/graph.py` | LangGraph拓扑，被Orchestrator替代 |
| `agent-service/app/agent/nodes/` 全部 | 被工人替代 |
| `agent-service/app/agent/state.py` | 被 Pydantic Models 替代 |
| `agent-service/app/agent/quality_checks.py` | 被 Evaluator Worker 替代 |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-clarify-bubble.tsx` | 被 SmartBriefCard 替代 |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-propose-bubble.tsx` | 被 BlueprintModal 替代 |
| `apps/client/src/ee/ai/components/ai-creator/ai-creator-outline-bubble.tsx` | 被 BlueprintModal 替代 |
| `apps/client/src/ee/ai/services/ai-create-runner.utils.ts` | 事件规范化逻辑重构 |
| `apps/server/src/ee/ai/document-strategy.ts` | 策略逻辑移植到 Python Orchestrator |
| `apps/server/src/ee/ai/evidence-preflight.ts` | 证据预检已转移到 Python AssetParser |

## 附录 C：新增文件清单

| 文件路径 | 用途 |
|----------|------|
| `agent-service/app/orchestrator/engine.py` | Orchestrator ReAct Loop 核心 |
| `agent-service/app/orchestrator/tools.py` | Orchestrator 可用工具注册 |
| `agent-service/app/orchestrator/prompts.py` | Orchestrator 系统提示 |
| `agent-service/app/workers/asset_parser.py` | 素材解析 Worker |
| `agent-service/app/workers/researcher.py` | 科研工作者 |
| `agent-service/app/workers/section_writer.py` | 章节写作 Worker |
| `agent-service/app/workers/visual_planner.py` | 配图规划 Worker |
| `agent-service/app/workers/evaluator.py` | 质量评估 Worker |
| `agent-service/app/workers/fixer.py` | 定点修复 Worker |
| `agent-service/app/models/brief.py` | CreationBrief Pydantic 模型 |
| `agent-service/app/models/asset_map.py` | AssetMap Pydantic 模型 |
| `agent-service/app/models/blueprint.py` | 创造蓝图 Pydantic 模型 |
| `agent-service/app/models/review.py` | 评审报告 Pydantic 模型 |
| `agent-service/app/models/draft.py` | 剖面图 Pydantic 模型 |
| `agent-service/app/models/events.py` | SSE 事件类型定义 |
| `apps/client/src/ee/ai/components/ai-creator/smart-brief/` | 智能简报组件目录 |
| `apps/client/src/ee/ai/components/ai-creator/blueprint/` | 蓝图组件目录 |
| `apps/client/src/ee/ai/components/ai-creator/live-draft/` | Live Draft 组件目录 |
| `apps/client/src/ee/ai/components/ai-creator/review/` | Review 组件目录 |
| `apps/client/src/ee/ai/components/ai-creator/draft-manager/` | 草稿管理组件目录 |
| `apps/client/src/ee/ai/types/brief.types.ts` | 简要 TypeScript 类型 |
| `apps/client/src/ee/ai/types/blueprint.types.ts` | 蓝图 TypeScript 类型 |
| `apps/client/src/ee/ai/types/review.types.ts` | 查看 TypeScript 类型 |
| `apps/client/src/ee/ai/types/draft.types.ts` | 草稿 TypeScript 类型 |
| `apps/client/src/ee/ai/services/draft-service.ts` | 草稿管理 API |
| `apps/client/src/ee/ai/hooks/use-draft-manager.ts` | 草稿管理 Hook |
| `apps/client/src/ee/ai/hooks/use-blueprint-editor.ts` | 蓝图编辑 Hook |
| `apps/client/src/ee/ai/hooks/use-review-actions.ts` | 审核操作 Hook |
