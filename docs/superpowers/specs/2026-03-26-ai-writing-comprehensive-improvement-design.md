# AI 写作系统综合改进设计

**日期：** 2026-03-26
**状态：** Draft
**范围：** 内容管道 + 网页清洗 + UI/UX + Agent 工作流 + 安全修复

---

## 1. 背景与问题

### 1.1 用户反馈的核心痛点

| # | 痛点 | 严重程度 |
|---|------|----------|
| 1 | 上传文档后图片位置错乱、内容乱码 | 高 |
| 2 | 外链写作时导航栏/页头页脚等脏数据被写入文档 | 高 |
| 3 | AI 写作面板信息密度过高，卡片显隐逻辑混乱 | 高 |
| 4 | Agent 工作流不透明，用户不知道 Agent 在做什么/为什么 | 高 |
| 5 | 多文档综合写作质量低，内容重复/冲突 | 中 |

### 1.2 技术根因分析

**内容管道：**
- Docling 解析 PDF 后图片块没有按页面坐标排序，导致位置错乱
- Firecrawl 爬取时未传 `exclude_tags` / `only_main_content` 等清洗参数，导航栏、Logo 等全部进入输出
- 多文档合并仅做列表拼接（`combined.items.extend()`），无去重/对齐

**UI/UX：**
- `DocumentOperationCenter` 同时渲染所有子组件，无阶段感知
- 3 次确认弹窗（Brief + Blueprint + Review）中断写作流
- Agent 步骤名称直接展示后端术语（`preservation_patch`）

**Agent 工作流：**
- Level 1/2/3 路由基于硬编码关键词（50+），中英混合场景误判率高
- Level 3 研究分支硬编码 `has_sufficient_evidence=True`，Web 研究永不执行
- engine.py 1200+ 行，L3 和 structured_write 的 Review 循环代码重复
- Brief 生成无质量门控，默认值填充无信息量

**安全：**
- IDOR 漏洞：任意已认证用户可访问/操控任意 Agent 会话
- `@Public()` 端点 + 空 `AGENT_INTERNAL_SECRET` = 未认证读取任意页面
- 无并发 Agent 任务限制（财务 DoS 风险）
- Prompt Injection：文档/爬取内容直接注入 LLM 无隔离标记

### 1.3 设计目标

1. 文档解析后图片顺序正确，内容无乱码
2. 外链爬取输出只包含正文主体内容
3. AI 写作面板一次只展示一个阶段，用户始终知道在哪步
4. Agent 路由决策可见、可解释
5. 多文档综合写作有全局分析和冲突检测
6. 修复所有 Critical/High 安全漏洞

---

## 2. 内容摄入管道重构

### 2.1 总体架构

```
文档上传流
  ├── PDF / 图片
  │     └─→ MinerU API（主力，本地或云端）
  │           ├─ content_list.json 按 LayoutReader 阅读顺序
  │           ├─ 图片 bbox 坐标 + caption + footnote
  │           ├─ 表格 → HTML（保留合并单元格）
  │           ├─ 公式 → LaTeX
  │           └─ 图片 MD5 + pHash 去重
  ├── Word / PPT
  │     └─→ MinerU 云端 API（支持 Doc/Docx/Ppt/PPTx）
  │           └─ 本地部署不支持这些格式
  └── MinerU 不可用？
        └─→ 断路器（3 次失败后跳过）+ 返回明确错误

网页爬取流
  ├── Firecrawl（JS 渲染 + 反爬）
  │     ├─ only_main_content=True
  │     ├─ exclude_tags=[nav, header, footer, aside, ...]
  │     ├─ block_ads=True
  │     ├─ remove_base64_images=True
  │     └─ 返回 rawHtml + markdown
  └── Trafilatura 二次清洗（对 rawHtml）
        ├─ favor_precision=True
        ├─ include_images/tables/links=True
        ├─ include_comments=False
        └─ output_format="markdown"

降级路径
  ├── Firecrawl 不可用 → Trafilatura fetch_url()（无 JS 渲染）
  └── MinerU 不可用 → 断路器 + 明确错误消息
```

### 2.2 去掉 Docling

**决策依据：**
- MinerU 布局检测精度 97.5 mAP（Docling 93.1）
- MinerU 表格提取为 HTML 格式，保留合并单元格（Docling 复杂表头会丢失列对齐）
- MinerU 公式自动转 LaTeX，CDM 0.968（Docling 仅纯文本提取）
- MinerU 中文支持（PaddleOCR）是核心强项
- 许可证兼容：MinerU AGPL-3.0，Docmost 也是 AGPL-3.0

**影响范围：**
- 移除 `agent-service/app/tools/docling_parser.py`
- 移除 `docling` / `docling-core` 依赖
- 修改 `agent-service/app/workers/asset_parser.py` 移除 Docling 相关代码
- 修改 `agent-service/app/orchestrator/tools/parse_assets.py` 移除 `_parse_with_docling` 路径

### 2.3 MinerU 集成优化

**当前问题：** `MINERU_ENABLED=false`（默认关闭），需要升为默认路径。

**改造要点：**

1. **信任 content_list.json 的原始顺序**：MinerU 使用 LayoutReader 模型排序，已考虑多栏布局。不要自己做 bbox 排序。仅在需要二次校验时使用 `page_idx` + `bbox` 坐标。

2. **图片去重（两级哈希）：**
```python
import hashlib
import imagehash
from PIL import Image

def compute_image_hashes(image_bytes: bytes) -> tuple[str, str]:
    exact = hashlib.md5(image_bytes).hexdigest()
    try:
        img = Image.open(io.BytesIO(image_bytes))
        phash = str(imagehash.phash(img, hash_size=16))
    except Exception:
        phash = exact
    return exact, phash
```

3. **去重后的引用映射：** 建立 `redirect_map: dict[str, str]`（被删除图片 ID → 保留图片 ID），在 `_rewrite_text_asset_image_refs()` 中处理重定向。

4. **断路器模式（MinerU 云端 API）：**
```python
import pybreaker

mineru_breaker = pybreaker.CircuitBreaker(
    fail_max=3,
    reset_timeout=300,  # 5 分钟后重试
)
```

5. **扫描件 PDF 检测：** 上传前用 PyMuPDF (`fitz`) 快速检测，若超过 70% 页面无文本则强制 `is_ocr=True`。

6. **加密 PDF 前置检测：** 上传前检测，返回明确错误消息。

7. **超大文件保护：**
   - 单文件 50MB 上限
   - 并行解析用 `asyncio.Semaphore(2)` 限制
   - MinerU 轮询超时从 300s 降为 120s

8. **编码检测：** 用 `charset-normalizer` 在解码前检测编码，避免乱码。

### 2.4 Firecrawl 参数优化

**当前问题：** `client.scrape(url, formats=["markdown"])` 未传任何清洗参数。

**改造后：**
```python
result = client.scrape(url,
    formats=["markdown", "rawHtml"],
    only_main_content=True,
    exclude_tags=[
        "nav", "header", "footer", "aside",
        ".sidebar", ".navbar", ".navigation", ".menu",
        ".advertisement", ".ad", ".ads", ".banner",
        ".cookie-banner", ".cookie-consent", ".popup",
        ".social-share", ".share-buttons",
        ".breadcrumb", ".breadcrumbs",
        "#comments", ".comments-section",
    ],
    wait_for=1000,
    remove_base64_images=True,
    block_ads=True,
    timeout=30000,
)
```

**防御性策略：** 如果 `include_tags` 模式提取结果太短（<100 字），降级到仅 `exclude_tags` 模式。

### 2.5 Trafilatura 二次清洗

**定位：** 不是替代 Firecrawl，而是对 Firecrawl 返回的 `rawHtml` 做高精度二次提取。

**依据：**
- Trafilatura mean F1=0.909, precision=0.932（学术评测最高）
- 处理延迟 10-50ms，对 Agent 管线影响可忽略
- Apache 2.0 许可证，与 AGPL 3.0 兼容

**集成方式：**
```python
async def extract_content(html: str, url: str) -> str | None:
    return await asyncio.to_thread(
        trafilatura.extract, html,
        output_format="markdown",
        favor_precision=True,
        include_images=True,
        include_tables=True,
        include_links=True,
        include_formatting=True,
        include_comments=False,
        url=url,
    )
```

**使用策略（方案 B — 回退模式）：**
1. 默认使用 Firecrawl 的 markdown 输出
2. 同时获取 rawHtml
3. 用 Trafilatura 提取 rawHtml → 如果结果 > 100 字，优先使用
4. Firecrawl 不可用时，Trafilatura `fetch_url()` 作为最后降级（无 JS 渲染）

### 2.6 跨文档合并改进

**当前问题：** `parse_assets_tool()` 的合并逻辑仅做列表拼接。

**改进方案：**
1. 合并时按 `content_hash` 去重图片，建立 `redirect_map`
2. 合并时按 `content_hash` 去重文本块（MD5 级别，非语义去重）
3. 增加 `max_tokens_budget` 参数，合并后超过预算时按优先级截断

### 2.7 依赖变更

| 操作 | 包 | 版本 | 理由 |
|------|------|------|------|
| 移除 | `docling` / `docling-core` | - | 用户要求 |
| 保留 | `firecrawl-py` | 现有 | 优化参数 |
| 新增 | `trafilatura` | >=2.0.0 | 网页二次清洗 |
| 新增 | `imagehash` | >=4.3 | 感知哈希去重 |
| 新增 | `pybreaker` | >=1.0 | 断路器模式 |
| 新增 | `charset-normalizer` | >=3.0 | 编码检测（trafilatura 已含） |

---

## 3. UI/UX 重设计

### 3.1 核心原则

1. **一次只看一个阶段**：当前阶段卡片全宽展示，其他阶段折叠为一行摘要
2. **减少确认次数**：Brief 自动确认（5s 倒计时），Review 无阻塞自动通过
3. **人类可读**：Agent 步骤名、模式名全部映射为用户友好文本

### 3.2 3 阶段模型（替代 5 步向导）

| 原 5 步 | 合并后 | 用户干预 |
|---------|--------|---------|
| 意图理解 + 资料解析 | **准备阶段** | 无（自动），展示进度 |
| 目标确认（Brief + Blueprint） | **确认阶段** | Brief 5s 自动确认；Blueprint 按需展示 |
| 写作执行 + 审阅应用 | **交付阶段** | Review 无阻塞自动通过；有 blocking issue 才拦截 |

**向导 vs 对话的取舍：**
- 简单操作（选中文本改写）：保持现有 `EditorAiMenu` 内联浮动菜单，不进面板
- 复杂操作（多文档综合写作）：面板内的 3 阶段引导

### 3.3 面板布局改造

```
+--------------------------------------+
| AI Assistant                   [+][X]|
+--------------------------------------+
| [Preparing ──●── Confirming ── Done] |  ← Badge 列表，非 Stepper
|                                      |
| ┌──────────────────────────────────┐ |
| │ [当前阶段卡片 — 全宽展示]        │ |
| │                                  │ |
| │ 阶段特定内容                     │ |
| │                                  │ |
| │ [主操作按钮]  [次操作链接]       │ |
| └──────────────────────────────────┘ |
|                                      |
| ▸ Parsed 3 files (done, 12s)         |  ← 已完成阶段折叠
| ▸ Latest: Writing section 2… (45s)   |  ← 最新 Agent 动态
|                                      |
+--------------------------------------+
| [📎][🔗][📋] [Input]         [Send] |
+--------------------------------------+
```

### 3.4 确认流程改造

**Brief 确认 → 自动确认模式：**
- 展示 AI 理解的意图摘要（一行文本 + Badge 标签）
- 5 秒 `RingProgress` 倒计时后自动确认
- 点击"Modify"暂停倒计时，展开完整编辑表单
- 用户可在设置中关闭自动确认

**Blueprint 确认 → 直接展示摘要卡片：**
- 不经过 `ExpertCollabPanel` 中间层
- 直接显示章节列表 + 总字数
- `[Looks good]` + `[Edit blueprint]` 两个按钮

**Review 确认 → 条件拦截：**
- 无 blocking issue → 自动通过，面板显示"Review passed (score: 92/100)"一行
- 有 blocking issue → 弹出 ReviewModal 要求用户介入

### 3.5 Agent 进度展示改造

**步骤名称映射表：**
```typescript
const STEP_LABELS: Record<string, string> = {
  parse_assets: "Reading your source files",
  create_brief: "Understanding your goals",
  create_blueprint: "Planning the document structure",
  write_section: "Writing content",
  preservation_patch: "Preserving original formatting",
  review: "Checking quality",
  finalize: "Preparing final draft",
};
```

**增加经过时间：** 每秒更新 `"12s"` / `"2m 15s"`，缓解"卡住了吗"焦虑。

**消除冗余：** 删除 `TaskActivityFeed` 顶部的独立"Latest update"高亮卡片，合并到时间线最后一项。

### 3.6 DocumentTaskHeader 改造

- 三列 `Group grow` → 垂直 `Stack` 或一行 Badge 列表
- `formatDocumentTaskMode`：`"strict_preservation"` → `"精确编辑"`

### 3.7 面板可展开模式

- 新增"展开"按钮，侧面板从 380px 扩展到 800px
- 用于 Diff 预览和 Blueprint 编辑
- 使用 Mantine `Drawer` 的 `size` 属性切换

### 3.8 移动端适配（P3）

- 移动端 AI 面板改为底部抽屉（`Drawer position="bottom"`）
- 默认 120px（最新步骤 + 输入框），上拉展开到 50%

---

## 4. Agent 工作流重构

### 4.1 路由策略：语义分类替代 Level 编号

**当前问题：** Level 1/2/3 按"工程复杂度"分，混合了任务类型和执行深度。关键词路由（50+ 硬编码词）在中英混合场景下脆弱。

**改造方案：两步路由**

```
Step 1: 语义分类（LLM Intent Classification）
  输入: user_message, has_files, has_urls, page_content_length
  输出: { task_type, confidence, reason }
  回退: LLM 失败 → 现有关键词规则引擎

  task_type 枚举:
  - selection_edit      (选区操作：改写/翻译/润色)
  - preservation_patch  (结构保留式变换)
  - single_pass_create  (简短内容一次生成)
  - structured_create   (需要大纲的结构化创作)
  - multi_source_synthesis (多源综合)

Step 2: 执行策略映射
  selection_edit      → DirectEditPipeline
  preservation_patch  → DirectEditPipeline
  single_pass_create  → BriefThenEditPipeline
  structured_create   → FullPipeline
  multi_source_synthesis → FullPipeline + MultiSourceAnalysis
```

**路由决策透明度（新增 SSE 事件）：**
```json
{
  "type": "routing_decision",
  "task_type": "structured_create",
  "strategy": "full_pipeline",
  "reason": "用户要求写完整技术方案，含3份参考资料",
  "confidence": 0.92
}
```

**策略升级机制：** `DirectEditPipeline` 完成后如果输出质量低于阈值（字数偏差 > 30%），自动升级到 `BriefThenEditPipeline`。

### 4.2 engine.py 拆分

**当前：** 1200+ 行，职责混杂（路由 + 编排 + 工具调用 + 状态管理 + Review 循环重复代码）

**拆分为：**
```
app/orchestrator/
  engine.py                     # 瘦分发层 (~100行)
  routing/
    __init__.py
    intent_classifier.py        # LLM 分类 + 规则回退
    strategy_selector.py        # task_type → pipeline 映射
  pipelines/
    __init__.py
    base.py                     # BasePipeline: _await_user_input, _emit 等
    direct_edit.py              # 原 _execute_level1 + _execute_preservation_patch
    brief_then_edit.py          # 原 _execute_level2
    full_pipeline.py            # 原 _execute_level3 + structured_write（合并）
  review/
    __init__.py
    review_loop.py              # 统一 Review 循环（消除代码重复）
    review_helpers.py           # 辅助函数
  helpers/
    asset_context.py            # _build_asset_summary 等
```

### 4.3 Brief/Blueprint 质量门控

**Brief 验证（确定性规则，无需 LLM）：**
```python
async def _validate_brief(brief, user_message):
    issues = []
    if brief.target_length <= 0:
        issues.append("target_length is zero")
    if brief.goal == "general-purpose writing":
        issues.append("goal not analyzed")
    # 检查与用户明确数字的一致性
    explicit = _extract_explicit_length(user_message)
    if explicit and abs(brief.target_length - explicit) > explicit * 0.5:
        issues.append(f"length diverges from user-specified {explicit}")
    return len(issues) == 0, issues
```

验证失败 → 重试 1 次（在 prompt 中附加失败原因）→ 仍失败 → 确定性回退。

**跳过 Brief/Blueprint 的快速模式：**
- intent 是 `single_pass_create` 且预估 < 800 字 → 跳过 Brief
- 用户消息已包含明确结构描述 → 跳过 Blueprint 生成

### 4.4 多文档综合写作改进

**新增：全局分析前置步骤（Brief 之前）**
```python
async def analyze_multi_source(asset_map, user_message):
    """分析多文档的共识、分歧、数据冲突。"""
    # 1. 提取每个文档的核心论点/数据点
    # 2. 交叉比对关键数据
    # 3. 标记冲突点
    # 4. 生成一致性矩阵
    return MultiSourceAnalysis(
        consensus=[...],
        conflicts=[...],
        unique_contributions={doc_id: [...]}
    )
```

**新增：任务级 RAG 索引**
- 文档总量超过 prompt 窗口 30% 时启用
- 解析后对每个文本 AssetItem 计算 embedding
- 存入临时向量索引（pgvector + session_id 标记）
- section_writer 按章节 `must_cover` 关键词检索 top-k 片段
- 任务结束后清理临时索引

**新增：跨节连贯性检查增强**
- 提取每节核心论点和关键术语
- 检查术语一致性（"用户" vs "客户" 不应混用）
- 检查论点推进逻辑链

### 4.5 新增 SSE 事件类型

| 事件 | 用途 |
|------|------|
| `routing_decision` | Agent 选择了什么路由及原因 |
| `token_usage` | 每步 LLM 调用的 token 消耗 |
| `section_quality` | 每节写完后的质量指标 |
| `strategy_escalation` | 策略自动升级通知 |
| `multi_source_conflicts` | 多文档冲突发现 |

### 4.6 修复已知 Bug

| Bug | 修复 |
|-----|------|
| L3 研究分支 `has_sufficient_evidence=True` 硬编码 | 改为 `bool(asset_map and asset_map.items)` |
| researcher.py 同步 `tool.invoke()` 阻塞 event loop | 包装 `asyncio.get_event_loop().run_in_executor()` |
| engine.py 中文乱码字符串 | 替换为英文 |
| asset_cache 内存泄漏 | 替换为 `cachetools.TTLCache(maxsize=50, ttl=3600)` |

---

## 5. 安全关键修复

### 5.1 P0 — Critical

**5.1.1 IDOR：任意用户访问任意 Agent 会话**

问题：`AgentGatewayController` 的 `GET /session/:id`、`POST /resume`、`POST /stop` 未验证会话所有权。

修复：
1. `SessionStore` 增加 `user_id` 和 `workspace_id` 字段
2. `OrchestratorRequest` 增加 `user_id` 字段
3. NestJS 每个会话相关端点验证 `session.user_id === currentUser.id`

**5.1.2 `@Public()` + 空 Secret = 未认证数据访问**

问题：`AiInternalController` 的三个端点标记 `@Public()`，仅依赖 `X-Internal-Secret`。若 secret 未配置，任何人可读取任意页面。

修复：
1. 修复 `auth.py` 空 secret 绕过（`request.headers.get("X-Internal-Secret")` 去掉默认值 `""`）
2. 应用启动时 `AGENT_INTERNAL_SECRET` 为空则禁用 `AiInternalController`
3. `task_id` 从自增计数器改为 `uuid4()`

### 5.2 P1 — High

**5.2.1 Prompt Injection 防护**
- 用户文档和爬取内容用 `<user_document>...</user_document>` 标签包裹
- 系统 prompt 声明标签内内容为纯数据
- 可疑注入模式检测 + 日志告警

**5.2.2 并发 Agent 任务限制**
- NestJS 网关：每用户最多 3 个同时运行的 Agent 任务
- Agent Service：全局最大并发任务数限制
- 每用户每小时 LLM 调用次数上限

**5.2.3 SSE 连接安全**
- `http.request` 添加 660s 超时
- 每用户最多 5 个 SSE 连接
- Agent 端 `_event_generator` 增加 30 分钟硬上限
- SSE 错误事件使用通用消息，不泄露内部信息

### 5.3 P2 — Medium

- CORS 限制为 `APP_URL`（NestJS 侧）
- `conversation_history` 验证 role 只能是 `user`/`assistant`
- 文件上传添加魔数验证（PDF→`%PDF-`, DOCX→`PK`）
- 文件名清洗（`ai-internal.controller.ts` 的 `uploadPageImage`）
- 会话数据添加 `expires_at`，定时清理过期数据
- DTO 添加 `@MaxLength()`：`content` 50000, `prompt` 2000, `query` 2000

---

## 6. 并行推进线与边界

| 线 | 修改范围 | 不触碰 |
|----|---------|--------|
| **内容管道** | `asset_parser.py`, `parse_assets.py`, `firecrawl_scrape.py`, `mineru_parser.py`, `mineru_client.py` | LLM 调用逻辑, 前端组件 |
| **网页清洗** | `firecrawl_scrape.py`, `researcher.py`, 新增 `trafilatura_extract.py` | 路由决策, 文档解析 |
| **UI 重设计** | `ai-creator/` 前端组件 | 后端 SSE 协议（只新增事件）|
| **Agent 工作流** | `engine.py` 拆分, `routing/`, `pipelines/`, `review/` | 前端渲染逻辑 |
| **安全修复** | `auth.py`, `ai-internal.controller.ts`, `agent-gateway.controller.ts`, DTO | 功能逻辑 |

---

## 7. 验收标准

### 7.1 内容管道
- [ ] 上传 10 页 PDF（含图片、表格、公式），图片位置与原文一致
- [ ] 上传 Word/PPT 文件，内容完整提取
- [ ] 上传两份含相同 Logo 的文档，Logo 只出现一次

### 7.2 网页清洗
- [ ] 爬取 MinerU 官网（mineru.net），输出不含导航栏/页头页脚
- [ ] 爬取 5 个代表性中文网站，正文提取准确
- [ ] SPA 网站（React/Vue）正文可提取

### 7.3 UI/UX
- [ ] 面板打开后一次只显示一个阶段卡片
- [ ] Brief 5 秒自动确认，可手动 Modify
- [ ] Review 无 blocking issue 时自动通过
- [ ] Agent 步骤显示人类可读名称 + 经过时间

### 7.4 Agent 工作流
- [ ] 路由决策事件在前端可见
- [ ] engine.py 拆分后所有现有测试通过
- [ ] Brief 验证失败时自动重试一次
- [ ] L3 研究分支恢复功能

### 7.5 安全
- [ ] 用户 A 无法通过 API 访问用户 B 的 Agent 会话
- [ ] `AGENT_INTERNAL_SECRET` 为空时 AiInternalController 不可用
- [ ] 单用户最多 3 个并发 Agent 任务
- [ ] SSE 连接 660s 超时
