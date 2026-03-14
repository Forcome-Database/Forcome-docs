# AI Creator v2 — Architecture

## Overview

The AI Creator uses a PydanticAI-based Orchestrator pattern:
- **Orchestrator**: ReAct loop that dynamically decides what to do
- **Workers**: Specialized execution units (AssetParser, SectionWriter, VisualPlanner, Evaluator, Fixer, StyleAnalyzer, Researcher)
- **Models**: Pydantic v2 structured intermediates (Brief, AssetMap, Blueprint, Draft, Review)

## Task Levels

- **Level 1** (5-15s): Simple edits (translate, fix spelling). Direct LLM call.
- **Level 2** (30-90s): Structured edits (format, continue). Brief → write.
- **Level 3** (2-5min): Full creation. Brief → Blueprint → section writing → review.

## Key Files

| File | Purpose |
|------|---------|
| `app/orchestrator/engine.py` | Core orchestrator with run() method |
| `app/orchestrator/llm_factory.py` | Multi-provider LLM adapter |
| `app/orchestrator/model_router.py` | Role-specific model assignment |
| `app/orchestrator/prompts.py` | Orchestrator system prompt |
| `app/orchestrator/sse_optimizer.py` | SSE event batching |
| `app/orchestrator/draft_manager.py` | Draft storage |
| `app/orchestrator/tools/` | Orchestrator tools |
| `app/workers/` | Specialized workers |
| `app/models/` | Pydantic data models |
| `app/utils/text.py` | Chinese-aware word counting |
| `app/agent/events.py` | asyncio.Queue-based SSE event bus |
| `app/agent/cancellation.py` | Task cancellation registry |

## API Endpoints

- `POST /agent/run` — Start orchestrator task (SSE response)
- `POST /agent/resume` — Resume after user interaction
- `POST /agent/stop` — Cancel running task
- `POST /v2/draft/get` — Get draft
- `POST /v2/draft/merge` — Get merged draft content
- `POST /v2/draft/delete` — Delete draft

## Request Flow

```
Frontend → NestJS /api/agent/run → agent-service /agent/run
                                        ↓
                               OrchestratorEngine.run()
                                        ↓
                            analyze_task_complexity()
                           /          |           \
                      Level 1      Level 2      Level 3
                     simple_edit  parse_assets  write_all_sections
                          |       create_brief       |
                          |       ask_user()     evaluate_quality
                          |       create_blueprint   |
                          |       ask_user()     fix_selected_issues
                          |       simple_edit         |
                           \          |           finalize_and_emit
                            ─────────────────────────┘
                                  SSE stream
```

## SSE Events

All events conform to `app/schemas/response.py::SSEEvent`. Key event types:

| Type | When |
|------|------|
| `session` | Immediately on connection, carries `thread_id` |
| `step_start` / `step_done` | Worker/tool step lifecycle |
| `content_delta` | Incremental text chunks |
| `content_cleared` | Content reset (revision) |
| `section_progress` | Per-section write progress |
| `interaction` | Pause for user input (brief/blueprint review) |
| `complexity` | Complexity level announcement |
| `done` | Final content delivery |
| `error` | Unrecoverable error |
| `cancelled` | Task was cancelled |

## Worker Inventory

| Worker | Role |
|--------|------|
| `AssetParser` | Parse uploaded files via Docling, extract images |
| `SectionWriter` | Write one blueprint section with evidence context |
| `VisualPlanner` | Assign images/diagrams to sections |
| `Evaluator` | Score draft quality, identify issues |
| `Fixer` | Auto-fix evaluator-flagged issues |
| `StyleAnalyzer` | Extract style from existing page content |
| `Researcher` | Tavily/Firecrawl web research |

## Cancellation

Tasks register a `(task_id, thread_id)` pair in `app/agent/cancellation.py`. Any worker
can call `raise_if_cancelled(state)` to abort. The `/agent/stop` endpoint sets the
cancel event; the finally block in `main.py` calls `unregister_task`.

## User Interaction Protocol

For Level 2/3 tasks, the orchestrator pauses at brief and blueprint review stages. The
`interaction_registry` in `app/orchestrator/tools/user_interaction.py` holds an asyncio
Future per thread. The frontend submits a decision to `/agent/resume`, which resolves
the Future and unblocks the orchestrator.
