# Task Plan: AI Creator MinerU-First Parsing Rollout

## Goal
Adopt a MinerU-first / Docling-fallback parsing architecture so supported uploaded documents preserve source images and layout blocks without regressing existing AI Creator flows.

## Current Phase
Phase 2

## Phases

### Phase 1: Discovery & Planning
- [x] Confirm MinerU format support and API constraints from official docs
- [x] Compare MinerU against Docling for current project needs
- [x] Write a dedicated implementation plan for MinerU-first parsing
- **Status:** complete

### Phase 2: MinerU Client & Result Adapter
- [x] Add MinerU API client, ZIP download, and polling logic
- [x] Parse MinerU output into `DocumentParseResult`
- [x] Add client/parser unit tests
- **Status:** complete

### Phase 3: Parser Routing & Filtering
- [x] Route supported files to MinerU first
- [ ] Keep Docling fallback for unsupported formats and failures
- [ ] Filter low-value image blocks and preserve useful screenshots
- **Status:** in_progress

### Phase 4: Orchestrator Integration
- [ ] Rehost MinerU source images through Docmost
- [ ] Ensure structured-write promotion still triggers for preserved-image flows
- [ ] Surface parser provenance in logs and UI state
- **Status:** pending

### Phase 5: Verification & Delivery
- [ ] Run parser/orchestrator/browser validation matrix
- [ ] Update `.env.example` and rollout notes
- [ ] Deliver outcome and residual risks
- **Status:** pending

## Key Questions
1. Which MinerU-supported formats should be routed away from Docling in phase 1?
2. How should MinerU image blocks be filtered so SOP screenshots are kept but logos/noise are dropped?
3. Where should MinerU failure handling fall back to Docling without surprising the user?

## Decisions Made
| Decision | Rationale |
|----------|-----------|
| Prefer MinerU for `pdf/doc/docx/ppt/pptx/html/image` inputs | Official API supports these formats and better matches current image-preservation requirements |
| Keep Docling as fallback, not primary | Docling still covers unsupported formats such as `xlsx/csv/md/xml` and provides a safe local parser fallback |
| Preserve `AssetMap` as the parser boundary | Avoids rewriting planner/writer/evaluator around parser-specific contracts |
| Start with deterministic image filtering | Lower cost and easier verification than immediate VLM-based image usefulness scoring |

## Errors Encountered
| Error | Attempt | Resolution |
|-------|---------|------------|
| Previous parser plan assumed Docling would remain the source-of-truth parser | 1 | Reframed the rollout to MinerU-first with Docling fallback |
| MinerU API is cloud-only and token-based | 1 | Treat token handling and parser fallback as first-class tasks in the plan |
