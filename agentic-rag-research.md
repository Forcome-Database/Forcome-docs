# Agentic RAG & Intelligent Knowledge Base Q&A: Research Report (2025-2026)

> Research completed: 2026-03-29
> Scope: Latest advances in Agentic RAG, retrieval optimization, answer quality, conversation management, and evaluation metrics.
> Purpose: Inform potential upgrades to a wiki-style knowledge base Q&A system (Docmost).

---

## Table of Contents

1. [The RAG Landscape in 2025-2026](#1-the-rag-landscape-in-2025-2026)
2. [Agentic RAG Architecture](#2-agentic-rag-architecture)
3. [Query Understanding & Rewriting](#3-query-understanding--rewriting)
4. [Retrieval Optimization](#4-retrieval-optimization)
5. [Answer Generation Quality](#5-answer-generation-quality)
6. [Conversation & Context Management](#6-conversation--context-management)
7. [Evaluation & Metrics](#7-evaluation--metrics)
8. [Practical Applicability to Wiki-Style Knowledge Base Q&A](#8-practical-applicability-to-wiki-style-knowledge-base-qa)
9. [Sources](#9-sources)

---

## 1. The RAG Landscape in 2025-2026

### The Architecture Split

The RAG ecosystem has bifurcated into distinct tiers by 2026:

**Tier 1 -- Cache-Augmented Generation (CAG):** For small, stable corpora under ~100K tokens (product catalogs, compliance rules updated weekly or less), CAG preloads the entire knowledge base into the LLM context window using prompt caching. This eliminates retrieval latency and retrieval errors entirely. CAG is cheaper and faster for these use cases but cannot scale to large or frequently updated corpora.

**Tier 2 -- Hybrid RAG (production baseline):** For most enterprise knowledge bases, hybrid retrieval (vector + keyword + reranking) is the recommended default in 2026. It captures both semantic meaning and exact terminology -- critical for technical, legal, and regulatory domains.

**Tier 3 -- Agentic RAG:** For complex multi-step reasoning (research assistants, cross-document synthesis, questions requiring API calls or live data), agentic RAG adds autonomous planning, iterative retrieval, tool use, and self-verification loops. Higher latency and cost, but dramatically better for complex queries.

**Tier 4 -- Graph RAG:** For questions requiring understanding of entity relationships across documents (e.g., "How are these three projects related?"), GraphRAG extracts knowledge graphs and uses community summaries for global reasoning. Microsoft's LazyGraphRAG (2025) reduced indexing costs to 0.1% of original GraphRAG while maintaining quality.

### Long-Context LLMs vs RAG

Long-context LLMs (128K-1M+ tokens) have not replaced RAG. Research consistently shows:
- Small stable corpus (<100K tokens) + conversational queries: long context may win
- Large, dynamic corpus or cross-document synthesis: hybrid RAG wins on cost, latency, and precision
- Winning 2025-2026 pattern: use RAG to retrieve relevant context, then use long-context windows to reason across that retrieved context

### RAG as Context Engine

RAG has evolved from a standalone Q&A tool into a foundational "Context Engine" for AI agents. Three data types now require coordinated retrieval:
1. Domain knowledge (traditional RAG)
2. Tool metadata and usage guides (tool retrieval)
3. Dynamic conversation state and memory

---

## 2. Agentic RAG Architecture

### What Is Agentic RAG?

Agentic RAG embeds autonomous AI agents into the RAG pipeline. Instead of a fixed retrieve-then-generate step, agents autonomously decide:
- **What** to fetch (which knowledge source, which tool)
- **When** to fetch (adaptive retrieval -- skip if parametric knowledge suffices)
- **How many times** to fetch (iterative refinement loops)
- **Whether the result is good enough** (self-reflection and verification)

### Core Agentic Patterns

| Pattern | Description | Use Case |
|---------|-------------|----------|
| **Single-Agent RAG** | One agent with retrieval tools in a loop | Most knowledge base Q&A |
| **Corrective RAG (CRAG)** | Evaluates retrieved documents, classifies as Correct/Incorrect/Ambiguous, adjusts strategy | When retrieval quality varies |
| **Self-RAG** | Model generates reflection tokens to decide when to retrieve and critique its own output | When hallucination risk is high |
| **Adaptive RAG** | Classifier routes queries to different pipelines based on complexity | Mixed-complexity workloads |
| **Multi-Agent RAG** | Parallel agents search different systems, aggregator synthesizes | Multi-source knowledge bases |
| **Deep Research** | Extended multi-minute research with accumulated notes | Complex research questions |

### Key Design Decisions

**When to use Agentic RAG vs simpler approaches:**
- Simple factual lookup from a single knowledge base: standard hybrid RAG is sufficient
- Multi-hop questions, cross-document reasoning, or questions requiring live data: agentic RAG
- Static, small corpus: consider CAG (no retrieval at all)

**Agentic workflow (typical 5-step):**
1. Agent receives query and plans retrieval strategy
2. Agent generates specific sub-queries for each knowledge source
3. Retrieval engine searches and returns candidate documents
4. Agent evaluates relevance, may re-query or search elsewhere
5. Agent generates grounded response with citations

### Frameworks (2025-2026)

- **LangGraph**: First-class state machines for multi-actor workflows; most popular for agentic RAG
- **LlamaIndex**: Agentic Document Workflows (2025) combining document processing, retrieval, and orchestration
- **PydanticAI**: Python-native agent framework with structured outputs
- **OpenAI Agents SDK** (March 2025): Lightweight framework with Agents, Handoffs, and Guardrails
- **Microsoft AutoGen / CrewAI**: Multi-agent coordination

### Trade-offs

| Aspect | Standard RAG | Agentic RAG |
|--------|-------------|-------------|
| Latency | 1-3 seconds | 5-30 seconds |
| Token cost | 1x | 3-10x |
| Accuracy on simple queries | High | Same or slightly higher |
| Accuracy on complex queries | Low-Medium | Significantly higher |
| Implementation complexity | Low | Medium-High |
| Debugging/observability | Easy | Requires tracing tools |

---

## 3. Query Understanding & Rewriting

### Why Query Rewriting Matters

User queries are often vague, ambiguous, or use different vocabulary than the knowledge base. Query rewriting bridges the gap between how users ask questions and how documents are indexed.

### Technique Catalog

#### 3.1 Multi-Query Expansion
Generate multiple reformulations of the same query and retrieve for all of them simultaneously. Casts a broader net for relevant documents.

- **MQRF-RAG framework**: Universal multi-query rewriting strategy designed to enhance diversity of retrieved documents and improve recall rates
- Implementation: Use LLM to generate 3-5 query variants, retrieve for each, deduplicate results
- Trade-off: Higher retrieval cost (3-5x), better recall, risk of noise

#### 3.2 HyDE (Hypothetical Document Embedding)
Instead of embedding the query directly, use the LLM to generate a hypothetical answer document, then embed that document and search for similar real documents.

- Converts question-answer comparison to answer-answer comparison
- Process: Query -> LLM generates 5 hypothetical answers -> embed each -> average vectors -> search
- Best for: Queries with vocabulary mismatch (user asks differently than docs are written)
- Trade-off: +1 LLM call per query (~200ms), significantly better for technical/domain-specific queries
- Caution: Can amplify LLM biases if the hypothetical answer is wrong

#### 3.3 Step-Back Prompting
Generate a more abstract, higher-level version of the query to retrieve background information before answering the specific question.

- Example: "What happens to GDP when unemployment rises in Q3?" -> Step-back: "What is the relationship between GDP and unemployment?"
- Best for: Questions requiring conceptual understanding before factual retrieval
- Trade-off: +1 LLM call, retrieves broader context

#### 3.4 Query Decomposition (Sub-Questions)
Break complex multi-part questions into independent sub-questions, retrieve and answer each, then synthesize.

- **DecomposeRAG** (UC Berkeley, 2025): Automated framework achieving state-of-the-art on multi-hop QA benchmarks
- **DeepRAG** (Guan et al., 2025): Models decomposition as a Markov Decision Process, dynamically deciding at each step whether to retrieve or use parametric knowledge
- Best for: Multi-hop questions ("Compare X and Y", "What caused A and how did it affect B?")
- Trade-off: Multiple retrieval cycles, but dramatically better for complex questions

#### 3.5 Intent Classification & Routing
Classify the query intent before deciding the retrieval strategy.

- **REIC** (2025, EMNLP): RAG-enhanced intent classification at scale, outperforms fine-tuning and few-shot methods
- **Semantic Router**: Analyzes queries semantically to control which knowledge resources, prompts, and tools to use
- **Adaptive RAG**: T5-large classifier categorizes queries into three tiers:
  - Simple -> single-step retrieval
  - Complex -> decompose into sub-queries
  - General knowledge -> skip retrieval (use parametric knowledge)
- Performance: 4x inference speedup by skipping unnecessary retrieval

#### 3.6 RAG-EVO (2025)
Extended evolutionary learning with persistent vector memory, achieving 92.6% composite accuracy against Self-RAG, HyDE, and ReAct baselines.

#### 3.7 A-RAG Framework (February 2026)
Exposes keyword, semantic, and chunk-level retrieval tools directly to the agent, improving QA accuracy by 5-13% over flat retrieval.

### Recommendation for Wiki Knowledge Base Q&A

Start with: **Intent classification** (trivial/factual/complex) + **multi-query expansion** for factual queries + **query decomposition** for complex queries. HyDE is worth testing for domain-specific terminology mismatch.

---

## 4. Retrieval Optimization

### 4.1 Hybrid Search (Vector + Keyword)

**Status in 2026**: Hybrid retrieval is the default recommended approach for production systems.

**Architecture:**
- Run dense retriever (vector/embedding search) and sparse retriever (BM25/SPLADE) in parallel
- Combine results using Reciprocal Rank Fusion (RRF): `RRF(d) = Sum(1/(k + rank(d)))`
- Or use weighted combination: `H = (1-alpha) * Keyword_Score + alpha * Vector_Score`

**Performance:**
- +7.2% increase in Recall@5 and +18.5% boost in MRR over dense-only
- MRR improvement from 0.410 to 0.486 with tuned hybrid
- Critical: untuned hybrid can *underperform* dense-only; alpha parameter tuning is essential
- Latency cost: ~201ms (24.5%) increase per query

**Implementation notes:**
- Alpha=0.7 (favoring vectors) is a good starting point for most knowledge bases
- For exact matches (error codes, product IDs, proper names), weight keywords higher
- RRF constant k=60 is the standard default

### 4.2 Contextual Retrieval (Anthropic)

**Technique:** Prepend chunk-specific explanatory context (50-100 tokens) to each chunk before embedding and BM25 indexing. The context explains what the chunk is about within the full document.

**Performance:**
- Contextual Embeddings alone: 35% reduction in retrieval failure (5.7% -> 3.7%)
- Combined Contextual Embeddings + Contextual BM25: 49% reduction (5.7% -> 2.9%)
- With Reranking: 67% reduction (5.7% -> 1.9%)

**Cost:** $1.02 per million document tokens (one-time, using prompt caching)

**Key insight:** This is particularly valuable for wiki-style content where chunks often lose their section/page context after splitting. A chunk saying "This feature was added in v2.0" is much more retrievable when prefixed with context about which product/feature it belongs to.

### 4.3 Reranking (Two-Stage Retrieval)

**Architecture:** Fast retriever gets top 50-100 candidates -> cross-encoder reranker scores top-N -> return best 5-10 to LLM.

**Performance:**
- Cross-encoder reranking: up to +48% retrieval quality improvement
- Retrieve top-100, rerank to top-10: +33% accuracy, +120ms latency

**Leading reranker models (2025-2026):**
- **Cohere Rerank 4 Pro**: +170 ELO over v3.5, best on business/finance
- **BGE Reranker v2-m3**: <600M params, runs on consumer GPUs, open-source
- **ZeroEntropy**: 95% of LLM accuracy at 3x faster response
- **Vectara HHEM-2.1-Open**: T5-based, free/open-source hallucination detection model

**Production recommendation:** Retrieve 50-100, rerank to 10. Use Cohere Rerank for API-based, BGE Reranker for self-hosted.

### 4.4 Late Chunking

Instead of chunking first then embedding, late chunking processes the full document through the embedding model first (getting token-level contextual embeddings), then chunks the embeddings while preserving full-document context.

**Advantages:**
- Each chunk's embedding reflects its position in the full document
- More computationally efficient than contextual retrieval (no LLM calls needed)
- Better contextual understanding than traditional chunking

**Trade-offs:**
- Requires embedding models that support this approach (e.g., Jina AI models)
- Storage requirements can be 10-100x higher for token-level approaches

### 4.5 ColBERT / Late Interaction Models

ColBERT computes token-level contextualized embeddings and uses MaxSim (maximum similarity) between each query token and document tokens for scoring.

**ColPali/ColQwen (multimodal):** Use vision language models instead of text-only, computing interactions between text tokens and image patches. Enables RAG over PDF documents without complex preprocessing or chunking.

**Trade-offs:**
- 10-100x storage increase vs single-vector embeddings
- Much better for fine-grained semantic matching
- PLAID + quantization techniques mitigate storage costs
- Best for: document-heavy knowledge bases with complex formatting

### 4.6 SPLADE (Learned Sparse Retrieval)

Neural model that learns sparse vector representations, combining lexical matching with semantic understanding via BERT's MLM head.

- **Echo-Mistral-SPLADE** (2024): Uses decoder-only LLM backbone, surpasses all previous SPLADE variants
- **DF-FLOPS regularization** (May 2025): Reduces posting list lengths, improves latency
- Query latency: 10-100ms range on benchmark datasets
- Best as BM25 replacement in hybrid search setups

### 4.7 Chunking Strategies

**2025-2026 consensus:**
- Structure-aware chunking (markdown headers, HTML sections) outperforms naive fixed-size by 5-10 percentage points
- Simple overlapping chunking is often more effective than complex semantic splitting
- ~250 tokens (~1000 characters) is a good starting point, but document structure matters more than token count
- 2026 upgrades like contextual retrieval and late chunking deliver bigger gains than overlap tuning

**For wiki/documentation:** Markdown header-aware chunking is the single biggest and easiest improvement. Split on section headers, preserve parent heading context in each chunk.

### 4.8 Embedding Model Selection

**Top models (2025-2026 MTEB rankings):**

| Model | MTEB Score | Cost | Notes |
|-------|-----------|------|-------|
| Gemini-embedding-001 | 68.32 | Google pricing | Newest leader |
| Voyage 4 family | -- | $0.12/1M tokens | MoE architecture, +14% over OpenAI on NDCG@10 |
| Cohere embed-v4 | 65.2 | $0.10/1M tokens | 128K context, best multilingual |
| OpenAI text-embedding-3-large | 64.6 | $0.13/1M tokens | Most developers' first choice |
| OpenAI text-embedding-3-small | -- | $0.02/1M tokens | Best price/performance for 90% of projects |
| BGE-M3 | -- | Free (self-hosted) | Best open-source multilingual |

**Key consideration:** Switching embedding providers requires re-indexing everything. Start with OpenAI text-embedding-3-small, upgrade only when benchmarks on your data show meaningful improvement.

### 4.9 Adaptive Retrieval

Not all queries need retrieval. Adaptive systems use lightweight classifiers to decide:
- **Retrieve**: Query matches indexed content scope
- **Web search**: Query is outside knowledge base scope
- **Skip retrieval**: LLM parametric knowledge suffices (general knowledge)

This reduces unnecessary retrieval by ~30-40% and improves both speed and accuracy.

---

## 5. Answer Generation Quality

### 5.1 Self-RAG (Self-Reflective RAG)

The model generates special "reflection tokens" at generation time to:
- Decide whether retrieval is needed for the current segment
- Assess whether retrieved passages are relevant
- Verify whether the generated text is supported by evidence
- Check overall utility of the response

**Performance:** Self-RAG (7B, 13B) significantly outperforms larger LLMs and other RAG approaches on diverse tasks. The model learns to self-critique without external verifier overhead.

**Trade-off:** Requires fine-tuned model with reflection token vocabulary. Not applicable to API-only LLM access without prompt-based approximation.

### 5.2 CRAG (Corrective RAG)

Evaluates retrieved documents *before* generation:
1. **Correct**: Retrieved docs are relevant -> proceed to generate
2. **Incorrect**: Retrieved docs are irrelevant -> trigger web search or expanded retrieval
3. **Ambiguous**: Partially relevant -> refine query and re-retrieve

**Complementary to Self-RAG:** CRAG improves evidence quality (pre-generation), Self-RAG improves reasoning over evidence (during/post-generation). Both can be combined.

### 5.3 MEGA-RAG Framework (2025)

Multi-stage evidence aggregation pipeline:
1. Dense retrieval with cross-encoder re-ranking
2. Weighted entailment scoring
3. Stricter semantic-factual alignment enforcement
4. Reduces spurious matches while retaining relevant evidence

Designed specifically for high-stakes domains (healthcare, public policy).

### 5.4 Citation & Attribution

**Citation-Aware RAG:** Insert lightweight citation anchors into text and store fragment-specific metadata as chunk metadata. This keeps text clean while enabling fine-grained citations.

**Key 2025 finding (GaRAGe benchmark):** Up to 57% of citations in RAG systems are "post-rationalized" -- the model generates the answer from parametric knowledge and retroactively assigns citations. True citation faithfulness remains an open challenge.

**CiteFix (2025):** Post-processing algorithm to correct citations using keyword + semantic matching, fine-tuned models with BERTScore, and lightweight LLM-based techniques.

**Best practices:**
- Include source document titles and section headers in retrieved chunks
- Use explicit citation instructions in the system prompt
- Post-process to verify each citation actually supports its claim
- Models tend to over-summarize rather than ground answers on retrieved passages (F1 attribution at best 58.9%)

### 5.5 Hallucination Prevention

**Key strategies (2025-2026):**
1. **Data quality first**: Clean, up-to-date retrieval corpus is the #1 factor
2. **Retrieval quality**: Use hybrid search + reranking to ensure relevant context
3. **Explicit grounding instructions**: Tell the model to only use provided context
4. **Uncertainty modeling**: Train/prompt the model to say "I don't know" when appropriate
5. **Post-generation verification**: Use BERTScore, FactCC, QAGS, or Vectara HHEM to measure truthfulness
6. **ReDeEP (2025)**: Detects hallucinations via mechanistic interpretability -- Knowledge FFNs overemphasize parametric knowledge while Copying Heads fail to integrate external knowledge

**Evidence:** RAG with curated sources achieves 0% hallucination (GPT-4) vs 40% without RAG in medical domain. With proper implementation, faithfulness scores of 94.2% are achievable.

---

## 6. Conversation & Context Management

### 6.1 Key Challenges in Multi-Turn RAG

Research (MTRAG benchmark, IBM/ACL 2025) shows:
- RAG systems perform well in early, self-contained turns
- Significant degradation in later turns, context-dependent queries, and anaphora resolution
- Excessive context leads to "history drift," spurious retrieval, and increased hallucination
- Unanswerable questions remain poorly handled

### 6.2 Conversation History Compression Techniques

| Technique | Token Reduction | Pros | Cons |
|-----------|----------------|------|------|
| **Sliding Window** (last N turns) | Fixed | Simple, low latency | Forgets early context |
| **Periodic Summarization** (every 8-10 turns) | 60-70% | Preserves key facts | Adds summarization latency |
| **Progressive Summarization** | 50-80% | Maintains different granularities | Complex implementation |
| **Semantic Buffer** (vector memory) | Variable | Pulls specific old facts when relevant | Requires separate vector store |
| **Hierarchical Summarization** | 70-90% | Multi-level context preservation | Most complex to implement |

### 6.3 Recommended Architecture for Multi-Turn Q&A

1. **Recent turns** (last 5-7): Keep in full context
2. **Older turns**: Compress via progressive summarization
3. **Key entities/facts**: Extract and store in structured memory
4. **Query contextualization**: Rewrite each new query to be self-contained using conversation context ("What about the second one?" -> "What is the pricing for Product B?")

### 6.4 Advanced Approaches

- **Semantic embeddings for history**: Embed conversation turns, retrieve semantically relevant history for current query
- **Psychology-inspired pruning**: Saliency modeling to identify which historical context matters for current query
- **Dynamic routing**: Route high-confidence intent-matched queries to canned responses, use RAG only for ambiguous/complex turns
- **Context manager**: Fuse prior n-turn history with query-specific metadata for coherent responses

### 6.5 Practical Recommendation for Wiki Q&A

For a wiki-style knowledge base:
- Implement sliding window (6 turns) + query contextualization as the baseline
- Add periodic summarization when conversations regularly exceed 10 turns
- Store extracted entities (page names, concepts) in a lightweight session memory
- Always rewrite follow-up queries to be self-contained before retrieval

---

## 7. Evaluation & Metrics

### 7.1 RAGAS Framework

RAGAS (Retrieval Augmented Generation Assessment) is the leading open-source evaluation framework. Key metrics:

**Retrieval Metrics:**
- **Context Precision**: Measures whether relevant chunks are ranked higher than irrelevant ones. Calculated as mean precision@k for each chunk.
- **Context Recall**: Ratio of relevant claims found in retrieved results vs total relevant claims in reference.
- **Context Entities Recall**: Whether key entities from the reference answer appear in retrieved context.

**Generation Metrics:**
- **Faithfulness**: Ratio of claims in the response supported by retrieved context to total claims. Key metric for hallucination detection.
- **Answer Relevancy**: Whether the response actually addresses the user's query.
- **Noise Sensitivity**: How much irrelevant retrieved context affects answer quality.

### 7.2 LLM-as-Judge Approach

RAGAS uses LLM judges (typically GPT-4 or Claude) to evaluate without requiring human-written ground truth. This is reference-free evaluation -- practical for production monitoring.

**Alternative:** Vectara HHEM-2.1-Open is a T5-based classifier for faithfulness that is free, small, and efficient for production use.

### 7.3 Production Evaluation Stack

Recommended 2026 evaluation setup:
1. **RAGAS** for specialized RAG metrics (faithfulness, context precision/recall)
2. **LangSmith or Arize Phoenix** for observability and tracing
3. **Synthetic test data** generated from knowledge base + manual curation
4. **User feedback loops** (thumbs up/down, citation verification)
5. **A/B testing** for configuration changes (chunk size, reranker, etc.)

### 7.4 Multi-Turn Evaluation

The MTRAG benchmark (IBM, ACL 2025) specifically evaluates multi-turn conversational RAG across:
- Context-dependent queries (anaphora, ellipsis)
- Topic shifts within conversation
- Unanswerable question detection
- Retrieval degradation over conversation length

### 7.5 Key Benchmarks to Track

- **Faithfulness score**: Target >90% (achievable with proper implementation)
- **Context precision@10**: Measures ranking quality
- **Answer relevancy**: Should be >85%
- **Retrieval failure rate** (1 - recall@20): Target <3% with contextual retrieval + reranking

---

## 8. Practical Applicability to Wiki-Style Knowledge Base Q&A

### Current Docmost RAG Architecture

Based on the existing codebase:
- Chunking: Markdown header-aware + 1600 char recursive + 20% overlap
- Search: Hybrid (vector + BM25 full-text) + RRF fusion + reranking
- Embedding: Via configured AI provider
- Index: pgvector HNSW (m=16, ef_construction=200)
- Context: Content projection for page context

### Recommended Upgrades (Prioritized)

#### High Priority (Significant impact, moderate effort)

1. **Contextual Retrieval** -- Prepend chunk-specific context before embedding. Anthropic's approach reduces retrieval failure by 35-67%. Since Docmost already has markdown-aware chunking, adding 50-100 tokens of "This chunk is from [page title], section [heading]..." before embedding is the single highest-ROI improvement.

2. **Query Intent Classification** -- Add a lightweight classifier before retrieval:
   - Factual query -> standard hybrid retrieval
   - Complex/multi-hop query -> query decomposition + multiple retrievals
   - Conversational/greeting -> skip retrieval, respond directly
   - Out-of-scope -> acknowledge limitations
   This avoids unnecessary retrieval (speed + cost) and improves complex query handling.

3. **Reranking Enhancement** -- If not already using a cross-encoder reranker post-retrieval, add one. Retrieve top-50, rerank to top-10. This alone can improve retrieval quality by 33-48%.

4. **Adaptive Retrieval** -- For the agent service: let the agent decide when to retrieve vs use parametric knowledge. Skip retrieval for general knowledge questions that don't need the wiki.

#### Medium Priority (Good impact, higher effort)

5. **Multi-Query Expansion** -- For factual queries, generate 3 query variants and retrieve for all. Particularly valuable for wiki content where users may use different terminology than documentation.

6. **Conversation History Compression** -- Implement progressive summarization for conversations beyond 6 turns. Current sliding window approach is a good baseline; add summarization for longer conversations.

7. **Citation Grounding** -- Include page title + section heading in every retrieved chunk. Add post-generation citation verification to detect unfaithful citations.

8. **RAGAS Evaluation Pipeline** -- Set up automated evaluation with synthetic test data. Track faithfulness, context precision, and answer relevancy over time.

#### Lower Priority (Incremental or complex)

9. **HyDE** -- Test hypothetical document embedding for domain-specific queries where vocabulary mismatch is common. Worth A/B testing but not guaranteed improvement for well-structured wiki content.

10. **CRAG Pattern** -- Add retrieved document quality evaluation before generation. If retrieval confidence is low, trigger broader search or acknowledge uncertainty.

11. **GraphRAG** -- For wiki content with rich entity relationships, GraphRAG could enable "How are X and Y related?" type queries. However, LazyGraphRAG's integration is needed to make costs manageable.

12. **ColBERT/Late Interaction** -- Token-level retrieval would improve fine-grained matching but requires significant infrastructure changes (10-100x storage increase).

### What NOT to Do

- Do NOT replace RAG with long-context stuffing for a wiki knowledge base. The corpus is too large and dynamic.
- Do NOT add agentic complexity for simple factual lookups. Use adaptive routing to keep simple queries fast.
- Do NOT switch embedding models without benchmarking on your specific data first. Re-indexing cost is high.
- Do NOT over-optimize chunking parameters. Structure-aware chunking + contextual retrieval beats any amount of overlap tuning.

---

## 9. Sources

### Surveys & Overviews
- [Agentic RAG Survey (arXiv 2501.09136)](https://arxiv.org/abs/2501.09136)
- [The Ultimate RAG Blueprint 2025/2026 (LangWatch)](https://langwatch.ai/blog/the-ultimate-rag-blueprint-everything-you-need-to-know-about-rag-in-2025-2026)
- [From RAG to Context -- 2025 Year-End Review (RAGFlow)](https://ragflow.io/blog/rag-review-2025-from-rag-to-context)
- [Standard RAG Is Dead: Architecture Split in 2026 (UCS)](https://ucstrategies.com/news/standard-rag-is-dead-why-ai-architecture-split-in-2026/)
- [Traditional RAG vs Agentic RAG (NVIDIA)](https://developer.nvidia.com/blog/traditional-rag-vs-agentic-rag-why-ai-agents-need-dynamic-knowledge-to-get-smarter/)
- [RAG, AI Agents, and Agentic RAG Comparative Analysis (DigitalOcean)](https://www.digitalocean.com/community/conceptual-articles/rag-ai-agents-agentic-rag-comparative-analysis)
- [What Is Agentic RAG? (IBM)](https://www.ibm.com/think/topics/agentic-rag)
- [What Is Agentic RAG? (Weaviate)](https://weaviate.io/blog/what-is-agentic-rag)
- [Agentic RAG: How It Works (DataCamp)](https://www.datacamp.com/blog/agentic-rag)
- [From RAG to Agentic RAG to Agent Memory (Leonie Monigatti)](https://www.leoniemonigatti.com/blog/from-rag-to-agent-memory.html)
- [Building Production RAG Systems in 2026](https://brlikhon.engineer/blog/building-production-rag-systems-in-2026-complete-architecture-guide)

### Query Understanding & Rewriting
- [Query Transformations for RAG (NirDiamant/RAG_Techniques)](https://github.com/NirDiamant/RAG_Techniques/blob/main/all_rag_techniques/query_transformations.ipynb)
- [MQRF-RAG: Multi Query Rewrite (ACM 2025)](https://dl.acm.org/doi/10.1145/3728199.3728221)
- [Microsoft RAG Techniques Explained (2025)](https://www.microsoft.com/en-us/microsoft-cloud/blog/2025/02/04/common-retrieval-augmented-generation-rag-techniques-explained/)
- [DecomposeRAG Query Decomposition (Ailog)](https://app.ailog.fr/en/blog/news/query-decomposition-research)
- [Advanced RAG: Query Decomposition (Haystack)](https://haystack.deepset.ai/blog/query-decomposition)
- [HyDE Hypothetical Document Embeddings (Zilliz)](https://zilliz.com/learn/improve-rag-and-information-retrieval-with-hyde-hypothetical-document-embeddings)
- [REIC: RAG-Enhanced Intent Classification (EMNLP 2025)](https://arxiv.org/abs/2506.00210)

### Retrieval Optimization
- [Contextual Retrieval (Anthropic)](https://www.anthropic.com/news/contextual-retrieval)
- [Optimizing RAG with Hybrid Search & Reranking (VectorHub/Superlinked)](https://superlinked.com/vectorhub/articles/optimizing-rag-with-hybrid-search-reranking)
- [Hybrid RAG: Boosting Accuracy in 2026 (AIMultiple)](https://research.aimultiple.com/hybrid-rag/)
- [Late Interaction Models Overview (Weaviate)](https://weaviate.io/blog/late-interaction-overview)
- [Late Chunking Paper (arXiv 2409.04701)](https://arxiv.org/pdf/2409.04701)
- [SPLADE for Sparse Vector Search (Pinecone)](https://www.pinecone.io/learn/splade/)
- [Mistral-SPLADE (arXiv 2408.11119)](https://arxiv.org/abs/2408.11119)
- [ColPali: Efficient Document Retrieval (ICLR 2025)](https://proceedings.iclr.cc/paper_files/paper/2025/file/99e9e141aafc314f76b0ca3dd66898b3-Paper-Conference.pdf)
- [Chunking Strategies for RAG (Weaviate)](https://weaviate.io/blog/chunking-strategies-for-rag)
- [Best Embedding Models for RAG 2026 (PremAI)](https://blog.premai.io/best-embedding-models-for-rag-2026-ranked-by-mteb-score-cost-and-self-hosting/)

### Adaptive Retrieval
- [Adaptive RAG Explained (Meilisearch)](https://www.meilisearch.com/blog/adaptive-rag)
- [Teaching Models When to Retrieve (Sumit's Diary)](https://blog.reachsumit.com/posts/2025/10/learning-to-retrieve/)
- [Deciding When Not to Retrieve (Sumit's Diary)](https://blog.reachsumit.com/posts/2025/09/deciding-when-not-to-retrieve/)
- [Adaptive RAG with LangGraph](https://langchain-ai.github.io/langgraph/tutorials/rag/langgraph_adaptive_rag/)

### Answer Quality & Hallucination
- [Self-RAG Paper (arXiv 2310.11511)](https://arxiv.org/abs/2310.11511)
- [CRAG: Corrective RAG (Kore.ai)](https://www.kore.ai/blog/corrective-rag-crag)
- [MEGA-RAG Hallucination Mitigation (Frontiers)](https://www.frontiersin.org/journals/public-health/articles/10.3389/fpubh.2025.1635381/full)
- [ReDeEP: Detecting RAG Hallucinations (OpenReview)](https://openreview.net/forum?id=ztzZDzgfrh)
- [RAG Citation Techniques (Tensorlake)](https://www.tensorlake.ai/blog/rag-citations)
- [GaRAGe Grounding Benchmark (ACL 2025)](https://aclanthology.org/2025.findings-acl.875/)
- [CiteFix: Post-Processing Citation Correction](https://arxiv.org/html/2504.15629v2)
- [Hallucination Mitigation Survey (MDPI)](https://www.mdpi.com/2227-7390/13/5/856)

### Reranking
- [Top 7 Rerankers for RAG 2025 (Analytics Vidhya)](https://www.analyticsvidhya.com/blog/2025/06/top-rerankers-for-rag/)
- [Cross-Encoder Reranking Improves RAG by 40% (Ailog)](https://app.ailog.fr/en/blog/news/reranking-cross-encoders-study)
- [Ultimate Guide to Reranking Models 2026 (ZeroEntropy)](https://www.zeroentropy.dev/articles/ultimate-guide-to-choosing-the-best-reranking-model-in-2025)

### Conversation Management
- [Context Window Management Strategies (Maxim)](https://www.getmaxim.ai/articles/context-window-management-strategies-for-long-context-ai-agents-and-chatbots/)
- [MTRAG: Multi-Turn RAG Benchmark (MIT Press / ACL 2025)](https://direct.mit.edu/tacl/article/doi/10.1162/TACL.a.19/132114/mtRAG-A-Multi-Turn-Conversational-Benchmark-for)
- [Handling Long Chat Histories in RAG (Chitika)](https://www.chitika.com/strategies-handling-long-chat-rag/)
- [LLM Memory Management (Vellum)](https://vellum.ai/blog/how-should-i-manage-memory-for-my-llm-chatbot)

### Evaluation
- [RAGAS Documentation](https://docs.ragas.io/en/stable/)
- [RAGAS Metrics (Ragas Docs)](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/)
- [Top 5 RAG Evaluation Tools 2026 (Maxim)](https://www.getmaxim.ai/articles/the-5-best-rag-evaluation-tools-you-should-know-in-2026/)
- [RAG Evaluation 2026 Metrics (Label Your Data)](https://labelyourdata.com/articles/llm-fine-tuning/rag-evaluation)
- [Evaluating RAG Systems in 2025: RAGAS Deep Dive (Cohorte)](https://www.cohorte.co/blog/evaluating-rag-systems-in-2025-ragas-deep-dive-giskard-showdown-and-the-future-of-context)

### GraphRAG & CAG
- [Graph RAG Survey (ACM TOIS)](https://dl.acm.org/doi/10.1145/3777378)
- [GraphRAG with Graphs (arXiv 2501.00309)](https://arxiv.org/abs/2501.00309)
- [Microsoft GraphRAG](https://microsoft.github.io/graphrag/)
- [LazyGraphRAG (Microsoft Research)](https://www.microsoft.com/en-us/research/blog/lazygraphrag-setting-a-new-standard-for-quality-and-cost/)
- [Cache-Augmented Generation (arXiv 2412.15605)](https://arxiv.org/abs/2412.15605)
- [CAG vs RAG Comparison (Analytics Vidhya)](https://www.analyticsvidhya.com/blog/2025/03/cache-augmented-generation-cag/)

### Long Context vs RAG
- [RAG vs Long-Context LLMs (Meilisearch)](https://www.meilisearch.com/blog/rag-vs-long-context-llms)
- [Long Context vs RAG Evaluation (arXiv 2501.01880)](https://arxiv.org/abs/2501.01880)
- [Long-Context RAG Performance (Databricks)](https://www.databricks.com/blog/long-context-rag-performance-llms)

### Frameworks
- [Agentic RAG with LangGraph (LangChain)](https://blog.langchain.com/agentic-rag-with-langgraph/)
- [Top 20+ Agentic RAG Frameworks (AIMultiple)](https://aimultiple.com/agentic-rag)
- [Agentic AI Frameworks 2026 (SpaceO)](https://www.spaceo.ai/blog/agentic-ai-frameworks/)
