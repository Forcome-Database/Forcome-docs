# Task Plan

## Goal
Audit the backend AI creation, agent orchestration, and document processing flow in:
- `agent-service/app/**/*`
- `apps/server/src/ee/ai/**/*`
- related tests and implementation-backed docs

Answer:
1. the current `run` / `resume` / `commit` / `optimize` flow
2. whether `selection edit`, `document transform`, and `blank-page create` share one orchestrator
3. which implementations can cause chapter discontinuity, broken PDF/DOC optimization output, or data/image loss on re-optimize
4. which modules should be kept vs retired

Do not modify product code.

## Phases
| Phase | Status | Notes |
|---|---|---|
| 1. Map server-side entrypoints | completed | Controllers, services, gateway, DTOs, tests |
| 2. Map agent-service runtime | completed | Orchestrator, session store, tools, workers, persistence |
| 3. Cross-check tests and docs | completed | Only implementation-backed docs count |
| 4. Produce structured summary | in_progress | File paths, function names, keep/retire recommendation |

## Errors Encountered
| Error | Attempt | Resolution |
|---|---|---|
| `Get-Content` timed out on planning files with low timeout | 1 | Re-ran with longer timeout and `-First` |
