# Server 服务端应用

`apps/server/` 是 Docmost 的 NestJS 后端，负责认证、工作区 / 页面 API、协作、文件存储、AI 网关以及各类业务集成。

## 主要职责

- HTTP API 与鉴权
- 页面、空间、成员、权限等核心业务
- PostgreSQL / Redis / BullMQ 集成
- 协作与 WebSocket 能力
- AI 能力接入，包括模板、RAG、Agent Gateway、文档任务写回
- 对外集成，如邮件、对象存储、钉钉、Wiki 前台接口

## 目录概览

- `src/core/`：核心业务模块
- `src/common/`：公共工具与基础设施
- `src/database/`：数据库与迁移
- `src/integrations/`：环境、邮件、存储、搜索等集成
- `src/collaboration/`：协作相关实现
- `src/ws/`：WebSocket / 实时能力
- `src/ee/`：企业版与增强功能模块

## 常用命令

```bash
# 在仓库根目录运行
pnpm server:dev
pnpm --filter ./apps/server run build
pnpm --filter ./apps/server run test
pnpm --filter ./apps/server run migration:up
```

## 相关文档

- [README.md](../../README.md)：仓库总入口
- [CLAUDE.md](../../CLAUDE.md)：仓库级开发指南
- [docs/README.md](../../docs/README.md)：开发文档导航
- [agent-service/ARCHITECTURE.md](../../agent-service/ARCHITECTURE.md)：AI Agent 当前架构说明
