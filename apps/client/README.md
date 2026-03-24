# Client 前端应用

`apps/client/` 是 Docmost 主前端，基于 React 18 + TypeScript + Vite，负责后台管理、编辑器、工作区和 AI 交互界面。

## 主要职责

- 页面与路由层
- 工作区、空间、页面等业务界面
- 编辑器集成与 AI 创作面板
- 权限、会话、通知和前端状态管理

## 目录概览

- `src/pages/`：页面级入口
- `src/features/`：按业务聚合的功能模块
- `src/components/`：通用组件
- `src/hooks/`：通用 Hook
- `src/lib/`：工具函数与前端基础设施
- `src/ee/`：企业版与增强功能前端实现

## 常用命令

```bash
# 在仓库根目录运行
pnpm client:dev
pnpm --filter ./apps/client run build
pnpm --filter ./apps/client run lint
```

如需查看仓库级开发入口与相关文档，请回到 [README.md](../../README.md) 和 [CLAUDE.md](../../CLAUDE.md)。
