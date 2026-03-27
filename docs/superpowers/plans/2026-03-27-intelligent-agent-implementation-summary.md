# Intelligent Agent 完整实施总结

> 覆盖范围：Phase 1（Agent Service 核心）→ Phase 2（AgentPanel 前端）→ Phase 3（文档智能增强）→ 思维深度增强 → UI 时间线重构

## 项目目标

将 Docmost AI Agent 从旧架构（LangGraph 多阶段工作流，engine.py 1266 行）重构为新架构（PydanticAI 单 Agent + 工具调用），对标 MiniMax Agent 的交互体验。

## 分支信息

- **分支**: `feat/intelligent-agent`
- **Worktree**: `.worktrees/feat-intelligent-agent/`
- **总提交**: 47 个
- **代码变更**: 63 文件，+4850 / -2956 行

---

## Phase 1：Agent Service 核心

### 完成内容

| 模块 | 文件 | 说明 |
|------|------|------|
| Agent 单例 | `agent.py` | PydanticAI Agent + `thinking="high"` + 动态 max_tokens |
| 依赖容器 | `deps.py` | 每请求独立的 AgentDeps（线程隔离） |
| Skill 提示词 | `skill.py` | Think-heavy 设计：分析维度 + few-shot + 深度校准 |
| 事件桥接 | `event_bridge.py` | PydanticAI 事件 → SSE 事件映射 |
| 执行引擎 | `runner.py` | 流式执行 + 会话管理 + 取消 + 后验证 + 重试 |
| 验证器 | `validator.py` | 5 维质量检查 + 0-1 评分 |
| Token 限制 | `model_limits.py` | Per-model 输出 token 上限查找表 |
| 5 个工具 | `tools/` | extract_document, describe_images, scrape_url, search_web, read_page |
| FastAPI 端点 | `main.py` | `POST /agent/v2/run` SSE 流式端点 |
| NestJS 网关 | `agent-gateway/` | `POST /api/agent/v2/run` 代理端点 |

### 关键设计决策

| 决策 | 理由 |
|------|------|
| PydanticAI 替代 LangGraph | 1266 行→~600 行，类型安全，零"魔法"抽象 |
| 模块级单例 Agent | Agent 本身无状态，deps/history 都是 run() 参数 |
| `thinking="high"` | PydanticAI v1.72.0 自动映射为 Gemini `thinking_level='HIGH'` |
| `end_strategy="early"` | 一旦模型输出文本即视为结果 |
| 工具返回 dict | Gemini 原生 JSON 支持（不被 return_value 包装） |

---

## Phase 2：AgentPanel 前端

### 完成内容

| 组件 | 文件 | 说明 |
|------|------|------|
| 面板容器 | `agent-panel.tsx` | aside 面板入口，Apply to page 按钮 |
| 消息渲染 | `agent-message.tsx` | **时间线渲染**：按事件到达顺序展示 |
| 用户消息 | `user-message.tsx` | 用户输入 + 文件列表 |
| 消息列表 | `message-list.tsx` | 自动滚动消息列表 |
| Markdown | `streaming-markdown.tsx` | 流式 Markdown 渲染 |
| 输入栏 | `input-bar.tsx` | 文本输入 + 文件上传 |
| 操作栏 | `action-bar.tsx` | Apply / Regenerate / 复制 |
| SSE 服务 | `agent-v2-service.ts` | EventSource 客户端 + base64 文件编码 |
| Hook | `use-agent-session.ts` | **时间线状态管理** + SSE 事件处理 |
| 类型 | `agent-v2.types.ts` | TimelineItem 联合类型 + AgentMessage |

### 时间线渲染（核心 UI 创新）

**问题**：模型在 ReAct 循环中每轮工具调用前输出叙述文本（如"需要先提取文档..."），与最终文档混在一起。

**解决方案**：时间线 + 回溯降级（非破坏性设计）

```
事件到达 → 按顺序渲染
tool_call 到达 → 前面的 text 回溯降级为可折叠"规划"块
最后一轮 text → 保持为文档内容（实时流式）
Apply to page → 使用 done.final_content（权威输出）
```

**调研支撑**：
- OpenAI Agents SDK：双层事件体系（Raw vs 高级）
- Semantic Kernel：`on_intermediate_message` 回调分离中间步骤
- Anthropic Claude：`tool_choice: any` 抑制前导文本
- Manus：CodeAct 模式消除叙述 + logit 掩码

---

## Phase 3：文档智能增强

### 完成内容

| 功能 | 说明 |
|------|------|
| 原生图片提取 | PyMuPDF (PDF) + zipfile (DOCX/PPTX) 直接提取嵌入图片 |
| VLM 图片描述 | `describe_images` 工具：批量 VLM 调用理解图片内容 |
| 图片上传 | 提取的图片上传到 Docmost，获得真实 URL |
| 图片尺寸 | NestJS commit 管线中 sharp 自动设置图片宽高 |
| MinerU 兜底 | 原生提取无结果时回退到 MinerU 图片 |

### 图片处理管线

```
用户上传 PDF/DOCX
  → extract_document 工具
      ├ MinerU 提取文本（full.md 结构化内容）
      ├ 原生提取图片（PyMuPDF/zipfile，零碎片化）
      ├ 上传图片到 Docmost → deps.uploaded_image_urls
      └ 保存 image_payloads → deps（供 describe_images 复用）
  → describe_images 工具
      └ VLM 批量描述每张图片内容
  → Agent 生成文档
      └ 图片按内容对应放置到正确位置
```

---

## 思维深度增强（交叉审视驱动）

### 诊断过程

通过**支持方（Advocate）+ 质疑方（Devil's Advocate）交叉审视**定位 5 个根因：

| # | 根因 | 来源 |
|---|------|------|
| 1 | Skill 提示词 80% 篇幅在约束行为，仅 3 行引导思考 | 代码分析 |
| 2 | "NEVER pad with filler" 通用压缩指令导致输出过度压缩 | arXiv "Concise Thoughts" |
| 3 | "任何两次工具调用后停止" 停止规则过于激进 | 代码分析 |
| 4 | 无多阶段思考可见性（用户只看到"已思考 Xs"） | MiniMax 对比 |
| 5 | 工具返回原始文本 blob，不利于模型推理 | Anthropic 工具设计指南 |

### 实施的改进

| 优先级 | 改进 | 来源/支撑 |
|--------|------|-----------|
| **P0** | Skill 提示词重构：思考框架 40%，格式 30%，工具策略 30% | Anthropic think-tool 54% 改善 |
| **P1** | 多阶段思考可见性：thinking_phase 计数 + 前端分阶段展示 | PydanticAI 源码验证 |
| **P2** | 工具输出结构化：5 个工具返回 dict 替代 str | PydanticAI Google provider 原生 JSON |
| **P3** | 质量验证闭环：5 维检查 + 0-1 评分 + 压缩比检测 | Cross-review 质疑方提出 |
| — | Gemini 截断检测：finish_reason == 'length' | Gemini CLI Issue #2104 |
| — | MAX_TOOL_CALLS 配置化：环境变量覆盖 | 生产灵活性 |
| — | 质量重试兜底：score < 0.4 时非流式重试 | PydanticAI Issue #3393 约束 |

---

## 关键踩坑记录

### FinalResultEvent 不可用作内容门控

**现象**：中间叙述文本泄漏到编辑器
**错误假设**：FinalResultEvent 只在最终轮触发 → 用作门控
**实际行为**（通过 debug 日志确认）：FinalResultEvent 在**每一轮**都触发
**正确解决**：前端时间线回溯降级（tool_call 到达时将前面的 text 降级为规划块）

### PydanticAI output_validator 流式 Bug

**Issue #3393**：在 `run_stream` 模式下抛出 `ModelRetry` 会导致未处理异常
**解决**：用流后验证（runner.py 循环结束后检查）替代 `@agent.output_validator`

### Gemini thinking 输出为空

**现象**：ThinkingPart 事件 start → end 之间无内容
**原因**：通过 openai-compatible 代理的 Gemini 模型，thinking 内容可能不返回
**影响**：前端思考阶段可能只有空块
**补偿**：模型的叙述文本（原本是 content）被回溯降级为规划块，充当可见的思考过程

### 工具调用间文本是叙述非文档

**现象**：模型在 ReAct 循环中每轮输出文本解释计划
**根因**：Gemini 即使启用 thinking 模式，仍会在 text 输出中包含叙述
**业界做法**：
- OpenAI：`phase: "commentary"` API 级标记
- Claude：`tool_choice: any` 强制抑制
- Manus：`toolChoice: required` + done 工具
- Semantic Kernel：`on_intermediate_message` 回调分离
**我们的做法**：时间线回溯降级（非破坏性，叙述保留为可折叠规划块）

---

## 测试覆盖

| 测试文件 | 测试数 | 覆盖范围 |
|---------|--------|---------|
| test_agent.py | 4 | Agent 创建、工具注册、ModelSettings |
| test_runner.py | 6 | 事件流、取消、内容累积、思考追踪、图片验证 |
| test_event_bridge.py | 10 | 所有事件类型映射 |
| test_validator.py | 9 | 基础验证（长度、图片、OCR、H1） |
| test_validator_enhanced.py | 8 | 增强验证（压缩比、评分） |
| test_skill.py | 9 | Skill 内容（callout、图片语法、禁止模式） |
| test_skill_structure.py | 6 | Skill 结构（思考框架位置、分析维度、few-shot） |
| test_tools_return_structure.py | 4 | 工具返回 dict 结构 |
| test_api_v2.py | 12 | V2 端点（请求解析、SSE 流、并发限制） |
| 5 个工具测试 | 15 | 各工具正常/异常/截断场景 |
| test_model_limits.py | 5 | Token 限制查找 |
| test_deps.py | 2 | 依赖容器初始化 |
| test_e2e_smoke.py | 4 | 端到端冒烟测试 |
| **总计** | **94** | **全部通过** |

---

## 文件变更清单

### 新增文件（Python Agent Service）

```
agent-service/app/agent/
├── __init__.py
├── agent.py              # Agent 单例
├── cancellation.py       # 任务取消
├── deps.py               # 依赖容器
├── event_bridge.py       # 事件映射
├── model_limits.py       # Token 限制
├── runner.py             # 执行引擎
├── skill.py              # Think-heavy Skill
├── validator.py          # 输出验证器
├── README.md             # 模块文档
└── tools/
    ├── __init__.py
    ├── extract_document.py
    ├── describe_images.py
    ├── native_image_extractor.py
    ├── scrape_url.py
    ├── search_web.py
    └── read_page.py
```

### 新增文件（前端 AgentPanel）

```
apps/client/src/ee/ai/
├── types/agent-v2.types.ts         # TimelineItem + AgentMessage
├── services/agent-v2-service.ts    # SSE 客户端
├── hooks/use-agent-session.ts      # 时间线状态管理
└── components/agent-panel/
    ├── agent-panel.tsx             # 面板容器
    ├── agent-message.tsx           # 时间线渲染
    ├── user-message.tsx
    ├── message-list.tsx
    ├── streaming-markdown.tsx
    ├── input-bar.tsx
    ├── action-bar.tsx
    └── agent-panel.module.css
```

### 修改文件

```
agent-service/app/main.py                   # POST /agent/v2/run 端点
agent-service/app/orchestrator/llm_factory.py  # OpenAI Responses 支持
agent-service/pyproject.toml                # pydantic-ai, pymupdf 依赖
apps/server/src/ee/ai/agent-gateway/       # NestJS v2 代理端点
```

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `AGENT_PORT` | `8100` | Agent Service 端口 |
| `AGENT_INTERNAL_SECRET` | — | 内部通信密钥（必填） |
| `AGENT_MAX_TOOL_CALLS` | `10` | 单次运行最大工具调用次数 |
| `AI_COMPLETION_MODEL` | — | LLM 模型名（如 gemini-3-pro-preview） |
| `AI_PROVIDER` | — | LLM 提供商（openai/gemini/ollama/openai-compatible） |

---

## 下一步

1. **会话持久化**：v2 端点的 session_store 接入 PostgreSQL
2. **i18n**：AgentPanel 组件国际化
3. **Phase 4 规划**：tool_progress 前端增强、更丰富的 Agent 交互 UI
4. **模型升级**：评估 Gemini 3.1 Pro（解决 3.0 的 21k token 截断问题）
