# 开发流程文档归档清单

本清单用于区分本仓库中“开发过程中产生的 Markdown 文档”与“项目本身的产品/说明文档”，并给出本次整理后的保留与归档规则。

不纳入本清单的内容：
- 项目说明文档，例如根目录 `README.md`、`CLAUDE.md`、模块级 `README.md`、`agent-service/ARCHITECTURE.md`
- `wiki/docs/**` 下的公共文档、产品文档和站点内容
- `.agent`、`.agents`、`.claude`、`.kiro`、`.kilocode`、`.qoder`、`.trae`、`.windsurf` 等隐藏工具链目录中的技能文档、缓存和中间文件

## 保留规则

| 路径 | 类型 | 处理方式 |
| --- | --- | --- |
| `docs/plans/` | 人工编写的设计说明、实施计划、重构分析 | 保留原路径，仅作为历史流程文档使用 |
| `docs/superpowers/specs/` | AI 辅助生成的规格与重构方案 | 保留原路径，仅作为设计过程记录使用 |
| `docs/superpowers/plans/` | AI 辅助生成的执行计划 | 保留原路径，仅作为实施过程记录使用 |
| `docs/archive/session/` | 会话级临时计划、发现记录、进度日志 | 归档到子目录，避免继续占用仓库根目录 |

## 已归类的流程文档

### `docs/plans/`

#### AI Creator
- `docs/plans/2026-02-26-ai-creator-panel-design.md`
- `docs/plans/2026-02-26-ai-creator-panel.md`
- `docs/plans/2026-03-03-ai-creator-bugfix-design.md`
- `docs/plans/2026-03-03-ai-creator-bugfix-impl-plan.md`
- `docs/plans/2026-03-04-ai-creator-optimization-design.md`
- `docs/plans/2026-03-04-ai-creator-implementation-plan.md`
- `docs/plans/2026-03-14-ai-creator-deep-analysis-and-refactor.md`

#### AI Agent / RAG
- `docs/plans/2026-03-02-advanced-rag-pipeline.md`
- `docs/plans/2026-03-03-ai-agent-architecture-design.md`
- `docs/plans/2026-03-03-ai-agent-impl-plan.md`

#### Wiki / DingTalk
- `docs/plans/2026-02-28-wiki-directory-display-design.md`
- `docs/plans/2026-02-28-wiki-directory-display-impl-plan.md`
- `docs/plans/2026-03-02-wiki-ai-ask-refactor-design.md`
- `docs/plans/2026-03-02-wiki-ai-ask-refactor.md`
- `docs/plans/2026-03-02-dingtalk-sso-design.md`
- `docs/plans/2026-03-02-dingtalk-sso-impl-plan.md`

#### 目录 / 主题层级
- `docs/plans/2026-02-28-directory-topic-hierarchy-design.md`
- `docs/plans/2026-02-28-directory-topic-hierarchy-impl-plan.md`

### `docs/superpowers/specs/`

#### Reference-First / AI Creator
- `docs/superpowers/specs/2026-03-13-reference-first-agent-design.md`
- `docs/superpowers/specs/2026-03-14-ai-creator-v2-spec.md`
- `docs/superpowers/specs/2026-03-20-ai-creator-document-task-redesign.md`
- `docs/superpowers/specs/2026-03-20-ai-creator-v3-redesign.md`

#### Wiki / Docker
- `docs/superpowers/specs/2026-03-23-wiki-ai-chat-ux-polish-design.md`
- `docs/superpowers/specs/2026-03-23-docker-setup-restructure-design.md`

### `docs/superpowers/plans/`

#### Reference-First / AI Creator
- `docs/superpowers/plans/2026-03-13-reference-first-agent-implementation.md`
- `docs/superpowers/plans/2026-03-14-ai-creator-phase0-foundation.md`
- `docs/superpowers/plans/2026-03-14-ai-creator-phase1-orchestrator.md`
- `docs/superpowers/plans/2026-03-14-ai-creator-phase2-assets-planning.md`
- `docs/superpowers/plans/2026-03-14-ai-creator-phase3-section-writer.md`
- `docs/superpowers/plans/2026-03-14-ai-creator-phase4-review-system.md`
- `docs/superpowers/plans/2026-03-14-ai-creator-phase5-polish.md`
- `docs/superpowers/plans/2026-03-14-phase1-quick-fixes.md`
- `docs/superpowers/plans/2026-03-18-ai-creator-workbench-rebuild.md`
- `docs/superpowers/plans/2026-03-19-ai-creator-mineru-first-parsing.md`
- `docs/superpowers/plans/2026-03-19-ai-creator-source-aware-writing-refactor.md`
- `docs/superpowers/plans/2026-03-20-ai-creator-document-task-redesign-implementation.md`
- `docs/superpowers/plans/2026-03-20-ai-creator-v3-implementation.md`

#### Wiki
- `docs/superpowers/plans/2026-03-23-wiki-ai-chat-ux-polish-implementation.md`

### 会话归档

#### 2026-03-20 后端 AI 审核
- `docs/archive/session/2026-03-20-backend-ai-audit/task_plan.md`
- `docs/archive/session/2026-03-20-backend-ai-audit/findings.md`
- `docs/archive/session/2026-03-20-backend-ai-audit/progress.md`

## 使用原则

- 如果某份文档描述了“当前行为”，使用前必须回到代码、测试和配置中核实。
- 如果某份文档属于计划或规格，应将其理解为当时的意图记录，而不是天然正确的最终事实。
- 后续新增的临时会话文档，应统一放入 `docs/archive/session/<date>-<topic>/` 下归档，避免再次污染仓库根目录。
