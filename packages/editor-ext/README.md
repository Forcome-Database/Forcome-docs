# 编辑器扩展包

`packages/editor-ext/` 提供 Docmost 共享的 TipTap 编辑器扩展构建产物，供主前端引用。

## 主要职责

- 承载自定义 TipTap 扩展与扩展入口
- 统一输出给 `apps/client/` 使用的编辑器扩展包

## 常用命令

```bash
pnpm editor-ext:build
pnpm --filter @docmost/editor-ext run dev
```

更多仓库级说明见 [README.md](../../README.md) 与 [CLAUDE.md](../../CLAUDE.md)。
