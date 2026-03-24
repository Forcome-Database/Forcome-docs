<div align="center">
    <h1><b>Docmost</b></h1>
    <p>
        开源协作文档与知识库系统。
        <br />
        <a href="https://docmost.com"><strong>官网</strong></a> |
        <a href="https://docmost.com/docs"><strong>公开文档</strong></a> |
        <a href="https://twitter.com/DocmostHQ"><strong>Twitter / X</strong></a>
    </p>
</div>
<br />

## 项目简介

Docmost 是一个类 Notion / Confluence 的开源协作文档平台，当前仓库在上游基础上加入了本地开发和业务扩展能力，包括：

- 实时协作编辑
- Draw.io / Excalidraw / Mermaid 图表
- 空间、权限、分组、评论、页面历史
- AI 创作与问答
- Wiki 前台只读集成
- 钉钉 SSO、目录层级、提示词模板等定制能力

## 仓库文档入口

如果你是在这个仓库里继续开发，优先看这些文档：

- [CLAUDE.md](./CLAUDE.md)：仓库级开发指南，包含技术栈、启动方式、关键约束和专题文档入口
- [docs/README.md](./docs/README.md)：开发文档总导航，区分现状文档、历史实现记录、计划文档和归档文档
- [agent-service/ARCHITECTURE.md](./agent-service/ARCHITECTURE.md)：当前 AI Agent Service 权威架构说明
- [apps/server/README.md](./apps/server/README.md)：NestJS 服务端说明
- [apps/client/README.md](./apps/client/README.md)：React 前端说明
- [packages/editor-ext/README.md](./packages/editor-ext/README.md)：编辑器扩展包说明
- [docs/plans/README.md](./docs/plans/README.md)：人工编写的设计/实现计划索引
- [docs/superpowers/README.md](./docs/superpowers/README.md)：AI 辅助规格与执行计划索引
- [docs/archive/process-docs-manifest.md](./docs/archive/process-docs-manifest.md)：流程文档归档清单

## 本地开发启动

### 方式一：本地直接运行

```bash
pnpm install

# Docmost Web + Server
pnpm dev

# Agent Service（单独终端）
cd agent-service
pip install -e ".[dev]"
python run.py

# Wiki（可选）
cd wiki
pnpm install
pnpm docs:dev
```

### 方式二：Docker

```bash
# Linux / macOS
./setup.sh dev

# Windows
setup.bat dev
```

生产环境使用 `./setup.sh prod` 或 `setup.bat prod`。更详细的地址、端口和 Docker 结构说明见 [CLAUDE.md](./CLAUDE.md) 与 [docs/superpowers/specs/2026-03-23-docker-setup-restructure-design.md](./docs/superpowers/specs/2026-03-23-docker-setup-restructure-design.md)。

## 许可证

Docmost Core 使用 AGPL 3.0 开源许可证。企业功能目录仍遵循 `packages/ee/License` 中定义的企业许可证：

- `apps/server/src/ee`
- `apps/client/src/ee`
- `packages/ee`

## 致谢

感谢以下服务对项目的支持：

- [Crowdin](https://crowdin.com/)：提供本地化平台支持
- [Algolia](https://www.algolia.com/)：为文档搜索提供支持
