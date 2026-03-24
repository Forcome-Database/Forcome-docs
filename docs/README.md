# 开发文档导航

本目录用于给仓库内的开发文档分层，避免把“当前入口文档”“历史实现记录”“计划文档”和“会话归档”混在一起使用。

## 当前入口文档

这些文档可以作为继续开发时的优先入口：

- [README.md](../README.md)：仓库总入口与本地开发启动方式
- [CLAUDE.md](../CLAUDE.md)：仓库级开发指南与专题文档导航
- [agent-service/ARCHITECTURE.md](../agent-service/ARCHITECTURE.md)：当前 AI Agent Service 架构说明
- [apps/server/README.md](../apps/server/README.md)：服务端说明
- [apps/client/README.md](../apps/client/README.md)：前端说明
- [packages/editor-ext/README.md](../packages/editor-ext/README.md)：编辑器扩展包说明

## `docs/*.md` 顶层专题文档

这些文件不属于流程归档，但它们的时效性并不完全相同。

### 仍可作为实现参考的专题文档

- `ee-refactor-details.md` / `ee-refactor-pitfalls.md`
- `wiki-integration-details.md` / `wiki-integration-pitfalls.md`
- `wiki-directory-display-refactor.md`
- `ai-template-management.md`
- `ai-multi-model-tiered-config.md`
- `dingtalk-sso-integration.md`
- `directory-slug-cjk-fix.md`
- `directory-topic-fixes.md`

这些文档大多记录已落地的模块改造和踩坑过程。使用前仍建议回到当前代码、环境变量和测试核实。

### 历史实现记录 / 演进记录

- `ai-agent-refactor-details.md`
- `ai-creator-changelog.md`
- `ai-creator-ui-refactor.md`
- `ai-creator-5stage-refactor.md`
- `ai-creator-v2-changelog.md`
- `ai-creator-v2-issues-for-review.md`

这类文档主要用于回溯阶段性方案和问题背景，不应直接当作当前实现说明。其中：

- `ai-agent-refactor-details.md` 记录的是 2026-03-04 的 LangGraph 方案，当前运行时请改看 [agent-service/ARCHITECTURE.md](../agent-service/ARCHITECTURE.md)

## 流程文档

以下目录都属于开发过程中产生的流程文档：

- [docs/plans/README.md](./plans/README.md)：人工编写的设计/实施计划
- [docs/superpowers/README.md](./superpowers/README.md)：AI 辅助规格与执行计划
- [docs/archive/process-docs-manifest.md](./archive/process-docs-manifest.md)：流程文档归档范围说明

这些文件保留的价值在于：

- 追溯当时的设计意图
- 理解阶段性任务拆分与风险判断
- 查找历史分析过程与上下文

它们默认不是当前代码行为的权威来源。

## 不在本次整理范围内的文档

- `wiki/docs/**`：Wiki 站点公共文档与产品内容
- `.agent`、`.agents`、`.claude`、`.kiro`、`.kilocode`、`.qoder`、`.trae`、`.windsurf`：隐藏工具链技能文档

## 使用建议

- 先用入口文档定位，再进入专题文档或流程文档
- 看到“设计”“计划”“实施”“重构记录”“变更日志”等词时，默认把它当成历史上下文而不是现状
- 需要确认当前行为时，优先核对代码、测试、环境变量和运行脚本
