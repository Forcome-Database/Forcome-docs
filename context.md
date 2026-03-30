# Wiki AI 问答助手智能化优化 — 综合研究报告

> 生成时间：2026-03-29
> 研究方法：5 Claude 代理 + 5 Codex 代理并行探索 → Leader Agent 交叉验证 + 独立分析
> 目的：上下文接续，保留研究结论和架构决策，为实施计划提供依据

---

## 一、研究概况

### 代理部署

| # | 代理 | 任务 | 耗时 | 状态 |
|---|------|------|------|------|
| 1 | Claude Explore | Wiki AI 问答后端实现 | 195s | ✅ |
| 2 | Claude Explore | V2 Agent 写作文档流程 | 200s | ✅ |
| 3 | Claude General | Agentic RAG 技术研究（WebSearch） | 1387s | ✅ |
| 4 | Claude General | 业内最佳产品对比（WebSearch） | 954s | ✅ |
| 5 | Claude Explore | Wiki 前端 Q&A 用户体验 | 101s | ✅ |
| 6 | Codex | Wiki AI Q&A 实现分析 | ✅ | ✅ |
| 7 | Codex | V2 Agent vs Wiki Q&A 对比 | ✅ | ✅ |
| 8 | Codex | Agentic RAG 架构研究 | ✅ | ✅ |
| 9 | Codex | 最佳问答产品研究 | ✅ | ✅ |
| 10 | Codex | RAG 质量 + 意图理解研究 | ✅ | ✅ |

### 产品研究覆盖

Notion AI, Perplexity, GitBook AI, Google NotebookLM, Atlassian Rovo, OpenAI File Search, Guru, Slite, Slab, Glean, kapa.ai — 共 11 个产品

---

## 二、交叉验证结果

### Claude 与 Codex 一致的结论（高置信度）

| # | 结论 | Claude | Codex | 验证 |
|---|------|:------:|:-----:|:----:|
| 1 | 查询重写是 #1 ROI 改进 | ✅ | ✅ | Microsoft 数据: +4 NDCG@3 |
| 2 | 意图分类/路由是关键 | ✅ | ✅ | Adaptive-RAG 论文 + 所有产品实践 |
| 3 | 自适应路由（3-4 条线路）是正确架构 | ✅ | ✅ | Azure/Cohere/Perplexity 共识 |
| 4 | 推荐后续问题低成本高回报 | ✅ | ✅ | GitBook/Rovo/Perplexity 共同模式 |
| 5 | 需要服务端会话记忆 | ✅ | ✅ | V2 ConversationStore 可复用 |
| 6 | 引用 UX 需增强（snippet 展示） | ✅ | ✅ | NotebookLM 引用跳转是金标准 |
| 7 | 不要直接跳到全 Agentic — 渐进式 | ✅ | ✅ | NAACL 2025: 小型 KB 瓶颈是知识不完整 |
| 8 | Groundedness 验证比"提示词防幻觉"有效 | ✅ | ✅ | 57% 引用是事后合理化（GaRAGe） |
| 9 | 多轮对话后期 RAG 退化严重 | ✅ | ✅ | 需查询上下文化而非原始历史注入 |
| 10 | 双模式（快答+深度研究）是行业共识 | ✅ | ✅ | Perplexity/Notion/NotebookLM/Rovo |

### 分歧点（Leader 裁决）

| # | 分歧 | Claude | Codex | 裁决 |
|---|------|--------|-------|------|
| 1 | 限流默认值 | 60 次/60s | 10 次/60s | **Codex 正确**（代码验证: environment.service.ts:334 默认 '10'） |
| 2 | 分块基准 | 512 tokens 是 2026 冠军 | 未提及具体数字 | 我们 1600 字符 ≈ 400 tokens，接近基准，暂不改 |
| 3 | Contextual Retrieval 的投入 | 已实现 generateContextPrefix | 未识别到已有 | **我们已实现**（上轮 RAG 优化的 per-document 前缀） |

### Codex 独有发现（Claude 遗漏）

1. **Wiki RRF 融合丢失同页多 chunk 证据** — 上轮已做 multi-chunk RRF 但 Codex 认为仍不充分
2. **retry 丢失图片** — retry() 只重发文本，用户图片附件丢失
3. **SSE 无 heartbeat/resume** — 无事件 ID、无心跳、无断线重连
4. **死代码** — conversationId/Dify/StorageKey.ConversationId 实际未使用
5. **Embedding 新鲜度无检测** — 索引滞后时请求路径不感知
6. **`ts_rank` 不是 BM25** — 上轮已修正命名但 Codex 再次提醒

### Claude 独有发现（Codex 遗漏）

1. **四层 RAG 生态分类** — CAG / Hybrid RAG / Agentic RAG / GraphRAG
2. **Agentic RAG 成本** — 3-10x token 消耗 + 5-30s 延迟
3. **意图分类单独 4x 推理加速** — 跳过不必要检索
4. **RAGAS 目标基准** — faithfulness >90%, relevancy >85%, failure rate <3%

---

## 三、当前系统现状（已验证的架构）

### 请求全链路

```
用户输入 → AIChat.vue sendMessage()
  → POST /api/public-wiki/ai/answers (SSE)
  → PublicWikiController.aiAnswers()
    → enforceOrigin() + enforcePublicAiRateLimit() (Redis 10次/60s)
    → resolvePublicPageScope() (公共空间范围)
    → AiSearchService.answerWithContext()
      → loadCurrentPage() (当前页内容)
      → hybridSearch() (vector 20条 + BM25 20条 → RRF K=60 → 15条)
      → rerank() (外部 reranker 或 LLM fallback → top 5)
      → buildContextText() (当前页 20K + 检索页 2.5K each)
      → collectCitations() (页面引用 + 资产引用)
      → streamText() (系统提示词 + 上下文 + 历史 + 查询 → LLM 流式)
  → SSE: {sources} → {citations} → {content chunks} → [DONE]
```

### 关键参数

| 参数 | 值 | 文件 |
|------|-----|------|
| 分块 | Markdown 标题感知 + 1600 字符递归 + 20% overlap | chunker.ts |
| HNSW | m=16, ef_construction=200, ef_search=100 | ai-queue.processor.ts |
| 距离阈值 | 自适应 min(0.5, max(0.3, best*2.5)) | ai-search.service.ts |
| RRF K | 60 | ai-search.service.ts |
| 上下文 | 当前页 20K + 检索页 2.5K × 5 | ai-search.service.ts |
| Context prefix | per-document（1 次 LLM 调用） | ai-queue.processor.ts |
| 多轮历史 | 客户端 localStorage, 最多 10 条 | AIChat.vue |
| 限流 | 10 次/60 秒 (Redis 滑动窗口) | public-wiki.service.ts |

### 已确认的 Gap

| # | Gap | 影响 | 当前表现 |
|---|-----|------|---------|
| 1 | **无查询理解** | 高 | 原始问题直接 embedding，模糊/复杂查询失败率高 |
| 2 | **无意图分类** | 高 | 所有问题走同一管道、同一 prompt |
| 3 | **无查询重写** | 高 | 追问中的指代不消解，"它"/"这个"检索失败 |
| 4 | **固定检索策略** | 中 | 闲聊也跑全量 RAG，浪费且可能返回无关结果 |
| 5 | **无后续问题推荐** | 中 | 用户不知道还能问什么 |
| 6 | **无回答验证** | 中 | 幻觉无检测，错误引用无纠正 |
| 7 | **无服务端会话** | 中 | 历史可被篡改，无跨设备延续 |
| 8 | **引用 UX 弱** | 低 | snippet 已返回但前端未展示 |
| 9 | **建议问题硬编码** | 低 | 仅 3 个固定中文问题 |
| 10 | **歧义不反问** | 低 | 模糊问题猜测回答而非追问 |

---

## 四、用户画像与需求分析

### 用户：企业员工

**核心行为特征：**
- 时间敏感 — 问问题是因为**卡住了**，需要快速解除阻塞
- 信任要求高 — 回答错了可能导致操作失误
- 上下文隐含 — "怎么部署"隐含了"我在看这个页面、我可能是运维"
- 不愿多打字 — 越少输入越好
- 知识水平差异大 — 新员工 vs 资深员工需要不同深度的回答

### 问题类型分类（6 类）

| 类型 | 占比估计 | 例子 | 当前表现 | 需要的回答方式 |
|------|---------|------|---------|--------------|
| 事实查询 | ~35% | "SSH 端口是多少" | 还行 | 简洁直答 + 来源 |
| 操作步骤 | ~25% | "怎么部署新版本" | 碎片化 | 分步骤 + 代码块 |
| 概念解释 | ~15% | "什么是 CI/CD" | 可以 | 概述 + 展开 |
| 排障诊断 | ~10% | "502 怎么办" | 很差 | 排查思路 + 可能原因 |
| 对比分析 | ~10% | "A 和 B 哪个好" | 很差 | 对比表格 |
| 追问细化 | ~5% | "上一个问题详细解释" | 退化 | 基于上下文深入 |

---

## 五、业内最佳实践总结

### 跨产品共性模式

1. **双模式** — Quick Answer + Deep Research（Perplexity/Notion/NotebookLM/Rovo）
2. **来源范围可控** — 当前页/空间/全库/外部（Notion @提及、GitBook 页面感知）
3. **引用跳转原文** — 不只链接标题（NotebookLM 金标准）
4. **每答下推荐问题** — 低成本高参与（GitBook/Rovo/Perplexity）
5. **模糊先追问** — 不猜测（Perplexity Deep Research 追问澄清）
6. **长任务展示进度** — 不空白等待（Perplexity 研究中间结果）
7. **查询重写+分解+并行搜索** — OpenAI File Search 公开参数

### 技术栈共识

- **检索**：Hybrid (vector + BM25) + RRF + Cross-encoder Reranking ← 行业基线
- **查询**：重写 → 分解 → 路由 ← Agentic 核心
- **回答**：引用内联 + Groundedness 验证 ← 信任保障
- **会话**：服务端 + 查询上下文化 ← 多轮质量

---

## 六、优化架构设计

### 核心架构：分层路由 + 渐进式检索

```
┌─────────────────────────────────────────────────────┐
│                 用户输入层                            │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │ 智能推荐  │  │ 输入框   │  │ 当前页面上下文     │  │
│  │ (LLM生成)│  │(自由提问) │  │(自动注入 slugId)  │  │
│  └──────────┘  └──────────┘  └───────────────────┘  │
└─────────────────────┬───────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────┐
│         查询理解层 Query Understanding               │
│                                                      │
│  ┌─────────────────┐  ┌──────────────────────────┐  │
│  │ 意图分类         │  │ 查询重写                  │  │
│  │ (LLM 单次调用)   │  │ (消解指代+补全上下文)     │  │
│  │ → 6 种类型       │  │ → 追问→独立查询           │  │
│  │ + 复杂度(1-3)    │  │ + HyDE (可选, 复杂查询)  │  │
│  └────────┬────────┘  └────────────┬─────────────┘  │
│           └────────────┬───────────┘                 │
│                        ▼                             │
│  ┌─────────────────────────────────────────────────┐ │
│  │ 路由决策                                        │ │
│  │ 复杂度 1 + 闲聊 → Route A (不检索)              │ │
│  │ 复杂度 1 + 事实  → Route B (单次 RAG)           │ │
│  │ 复杂度 2         → Route C (增强 RAG)           │ │
│  │ 复杂度 3         → Route D (Agentic)            │ │
│  └─────────────────────────────────────────────────┘ │
└─────────────────────┬───────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────┐
│          自适应检索层 Adaptive Retrieval              │
│                                                      │
│  Route A: 直接回复（"这超出了知识库范围"或通用回答）   │
│                                                      │
│  Route B: 现有 RAG 管道（保持不变）                   │
│    重写查询 → hybridSearch → rerank → top5 → 回答    │
│                                                      │
│  Route C: 增强 RAG                                   │
│    重写查询 → hybridSearch → rerank → top5            │
│    → 证据充分性检查                                   │
│    → 不足则: 换个角度重写 → 二次检索 → 合并           │
│    → 回答                                            │
│                                                      │
│  Route D: Agentic RAG                                │
│    查询分解为 2-3 子问题                              │
│    → 子问题并行检索                                   │
│    → 各自 rerank + 证据检查                          │
│    → 合并上下文 → 综合回答                           │
│    （预算: 最多 2 轮检索，防止成本爆炸）              │
└─────────────────────┬───────────────────────────────┘
                      ▼
┌─────────────────────────────────────────────────────┐
│           回答生成层 Answer Generation                │
│                                                      │
│  1. 意图适配 System Prompt                           │
│     事实 → "简洁直答，一句话+来源"                    │
│     步骤 → "分步骤，每步含命令/操作"                  │
│     概念 → "概述+展开，由浅入深"                      │
│     排障 → "排查思路，可能原因+解决方案"               │
│     对比 → "表格对比+总结推荐"                        │
│     追问 → "基于上文深入，不重复已说内容"              │
│                                                      │
│  2. 引用内联 [1][2] + snippet 段落                   │
│  3. Groundedness 后验证（可选，Phase 2）              │
│  4. 推荐后续问题 × 3（基于意图+回答内容生成）         │
└─────────────────────────────────────────────────────┘
```

### 与现有代码的映射

| 新增/修改 | 文件 | 变更内容 |
|----------|------|---------|
| **新增** | `ai-search.service.ts` 新方法 | `classifyAndRewrite()` — 意图分类+查询重写+路由 |
| **新增** | `ai-search.service.ts` 新方法 | `agenticSearch()` — 查询分解+并行检索+合并 |
| **修改** | `ai-search.service.ts` | `answerWithContext()` 调用 classifyAndRewrite，按路由走不同管道 |
| **修改** | `ai-search.service.ts` | 系统提示词根据意图类型切换 |
| **修改** | SSE 响应 | 新增 `intent`、`suggested_questions` 字段 |
| **修改** | `AIChat.vue` | 渲染推荐问题按钮、展示 snippet 引用 |
| **修改** | `AIChatSources.vue` | 展示 snippet 文本 |
| **修改** | `AIChatWelcome.vue` | 动态生成推荐问题（替代硬编码） |
| **新增**（P3） | `conversation-store.ts` | 服务端会话（复用 V2 的 Redis 模式） |

---

## 七、分阶段实施路线

### Phase 0：查询理解 + 推荐问题（1-2 天）

**目标**：让系统"听懂"用户在问什么

| Task | 内容 | 修改文件 | 预计 |
|------|------|---------|------|
| 0.1 | 意图分类 + 查询重写 + 复杂度判断（单次 LLM 调用） | ai-search.service.ts | 2h |
| 0.2 | 路由逻辑（4 条线路分发） | ai-search.service.ts | 1h |
| 0.3 | 意图适配系统提示词（6 套模板） | ai-search.service.ts | 1h |
| 0.4 | 推荐后续问题生成（回答后 LLM 一次调用） | ai-search.service.ts | 1h |
| 0.5 | 前端渲染推荐问题 + SSE 新字段 | AIChat.vue, types | 1h |
| 0.6 | 动态首页推荐问题（基于当前页标题） | AIChatWelcome.vue | 30min |

**关键设计**：classifyAndRewrite 用 lite model（GPT-4o-mini 级别）单次调用完成分类+重写+复杂度，额外延迟 <500ms，额外成本极低。

### Phase 1：自适应检索（2-3 天）

**目标**：复杂问题也能检索到正确内容

| Task | 内容 | 修改文件 | 预计 |
|------|------|---------|------|
| 1.1 | Route C 增强 RAG（证据充分性检查 + 二次检索） | ai-search.service.ts | 3h |
| 1.2 | Route D Agentic（查询分解 + 并行检索 + 合并） | ai-search.service.ts | 4h |
| 1.3 | Route A 直接回复（超范围/闲聊识别） | ai-search.service.ts | 1h |
| 1.4 | 追问查询上下文化（history → 独立查询） | ai-search.service.ts | 2h |

### Phase 2：回答质量 + 引用增强（1-2 天）

**目标**：回答可信、引用可验证

| Task | 内容 | 修改文件 | 预计 |
|------|------|---------|------|
| 2.1 | Groundedness 后验证（lite model 检查声明 vs 证据） | ai-search.service.ts | 3h |
| 2.2 | 引用 snippet 展示（前端渲染已有 snippet 数据） | AIChatSources.vue | 1h |
| 2.3 | 引用内联 [1][2] 格式（系统提示词调整） | ai-search.service.ts | 1h |

### Phase 3：会话 + 高级功能（2-3 天）

**目标**：完整 Agentic 体验

| Task | 内容 | 修改文件 | 预计 |
|------|------|---------|------|
| 3.1 | 服务端会话存储（复用 V2 Redis ConversationStore 模式） | public-wiki.service.ts + 新文件 | 3h |
| 3.2 | 歧义检测与反问（"您是指 X 还是 Y？"） | ai-search.service.ts | 2h |
| 3.3 | 深度研究模式（前端切换 + 后端解除检索轮次限制） | 前后端 | 4h |

---

## 八、成本与延迟预估

| 路由 | 额外 LLM 调用 | 额外延迟 | 额外 token 成本 | 使用频率 |
|------|-------------|---------|---------------|---------|
| Route A (不检索) | +1 (分类) | +300ms | ~200 tokens | ~5% |
| Route B (单次) | +1 (分类+重写) | +400ms | ~300 tokens | ~60% |
| Route C (增强) | +1 (分类) +1 (二次检索) | +1.5s | ~1000 tokens | ~25% |
| Route D (Agentic) | +1 (分类) +1 (分解) +N (并行) | +3-5s | ~3000 tokens | ~10% |
| 推荐问题 | +1 (每次回答后) | +0 (异步) | ~200 tokens | 100% |

**总体预估**：平均每次问答增加 ~400 tokens（~$0.001），延迟增加 ~500ms。对企业场景完全可接受。

---

## 九、技术风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 意图分类误判 | 中 | 走错路由浪费 token 或回答不合适 | 分类信心度阈值 + 默认走 Route B |
| 二次检索仍无结果 | 中 | 延迟增加但无改善 | 最多 1 次重试，证据分不提升则停 |
| 查询分解不当 | 低 | 子问题脱离原意 | 分解后校验子问题覆盖原始意图 |
| 推荐问题质量差 | 低 | 用户不点击 | 异步生成，不影响主回答 |
| LLM 调用链过长 | 低 | 延迟不可控 | 每条路由硬性超时上限 |

---

## 十、参考资源

### 论文/技术报告
- Adaptive-RAG (2024): https://arxiv.org/abs/2403.14403
- Self-RAG (2023): https://arxiv.org/abs/2310.11511
- CRAG (2024): https://arxiv.org/abs/2401.15884
- HyDE (2022): https://arxiv.org/abs/2212.10496
- Step-back Prompting (2023): https://arxiv.org/abs/2310.06117
- IRCoT Multi-hop (2022): https://arxiv.org/abs/2212.10509
- Late Chunking (2024): https://arxiv.org/abs/2409.04701
- FaithfulRAG (ACL 2025): https://aclanthology.org/2025.acl-long.1382/
- VeriCite (2025): https://arxiv.org/abs/2506.00384
- GaRAGe Benchmark: 57% 引用事后合理化

### 产品/平台
- Azure Agentic Retrieval: https://learn.microsoft.com/en-us/azure/search/search-agentic-retrieval-concept
- Azure Query Rewriting: +4 NDCG@3, +40% 复杂查询相关性
- OpenAI File Search: chunk 800, overlap 400, embedding-3-large@256d
- Cohere Agentic RAG: https://docs.cohere.com/page/agentic-multi-stage-rag
- RAGAS: https://docs.ragas.io/en/v0.4.3/concepts/metrics/

### 评估基准目标
- Faithfulness > 90%
- Answer Relevancy > 85%
- Retrieval Failure Rate < 3%
