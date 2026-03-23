# Docker 部署整理与启动脚本设计

> 日期：2026-03-23
> 状态：已批准

## 目标

1. 整理 Dockerfile 和 docker-compose，支持 `setup.sh`/`setup.bat` + `dev`/`prod` 参数启动
2. 数据库和 MinIO 使用外部资源，不纳入 Docker
3. 所有地址和端口通过环境变量配置，不硬编码
4. 兼容手动启动（`pnpm dev` / `uvicorn`）和 Docker 启动两种模式

## 服务矩阵

| 服务 | dev 模式 | prod 模式 | 手动模式 |
|------|---------|----------|---------|
| Docmost | Docker（volume mount + 热重载） | Docker（构建镜像） | `pnpm dev` |
| Agent | Docker（volume mount + --reload） | Docker（构建镜像） | `uvicorn --reload` |
| Wiki | Docker（volume mount + 热重载） | Docker（VitePress build → nginx） | `pnpm docs:dev` |
| Redis | Docker 容器 | Docker 容器 | Docker 容器或外部 |
| PostgreSQL | 外部资源 | 外部资源 | 外部资源 |
| MinIO/S3 | 外部资源 | 外部资源 | 外部资源 |

## 文件结构

```
Docmost/
├── Dockerfile                        # prod Docmost（现有，保留）
├── agent-service/Dockerfile          # prod Agent（现有，保留）
├── docker/
│   ├── dev.node.Dockerfile           # dev 基础镜像（Docmost + Wiki 共用）
│   ├── dev.python.Dockerfile         # dev Agent 镜像（预装系统依赖 + Python 包）
│   ├── wiki.Dockerfile               # prod Wiki（VitePress build → nginx 两阶段）
│   └── wiki-nginx.conf               # Wiki nginx 配置
├── docker-compose.yml                # 基础层：Redis + 网络 + 共享卷
├── docker-compose.dev.yml            # dev 覆盖层：volume mount + 热重载
├── docker-compose.prod.yml           # prod 覆盖层：构建镜像
├── setup.sh                          # Linux/Mac 启动脚本
├── setup.bat                         # Windows 启动脚本
├── .env.dev                          # 开发环境变量
└── .env.prod                         # 生产环境变量模板
```

## Docker Compose Override 模式

采用 Docker Compose 多文件合并机制：

- `docker-compose.yml` — 基础层，定义 Redis 服务、网络、共享卷
- `docker-compose.dev.yml` — dev 覆盖层，应用服务使用 volume mount + 热重载命令
- `docker-compose.prod.yml` — prod 覆盖层，应用服务使用构建镜像

启动命令：`docker compose -f docker-compose.yml -f docker-compose.<mode>.yml --env-file .env.<mode> up`

## 手动 vs Docker 地址兼容

`.env.dev` 保留手动模式默认值（localhost），Docker compose 通过 `environment:` 覆盖为容器名：

| 变量 | .env.dev 值（手动模式） | docker-compose 覆盖（Docker 模式） |
|------|----------------------|----------------------------------|
| `AGENT_SERVICE_URL` | `http://localhost:8100` | `http://agent-service:8100` |
| `DOCMOST_INTERNAL_URL` | `http://localhost:3000` | `http://docmost:${PORT:-3000}` |
| `REDIS_URL` | 用户配置的外部地址 | `redis://redis:6379` |

Docker Compose 的 `environment:` 优先级高于 `env_file:`，确保容器内使用正确的服务间地址。

## 各服务 Docker 设计

### Docmost dev
- 基础镜像：`node:22-slim` + pnpm
- Volume mount：整个项目目录 → `/app`，named volume 隔离 `/app/node_modules`
- 入口命令：`pnpm install && pnpm dev`
- 暴露端口：`${PORT:-3000}`（后端）+ `5173`（Vite HMR）

### Agent dev
- 基础镜像：`python:3.12-slim` + 系统依赖（tesseract 等）
- 构建时预装 Python 包（`pip install .`），运行时只挂载 `app/` 源码
- 入口命令：`uvicorn app.main:app --host 0.0.0.0 --port 8100 --reload`
- 暴露端口：`8100`

### Wiki dev
- 基础镜像：同 Docmost（`node:22-slim` + pnpm）
- Volume mount：`wiki/` → `/app`，named volume 隔离 node_modules
- 入口命令：`pnpm install && pnpm docs:dev`
- 暴露端口：`${WIKI_PORT:-5175}`

### Wiki prod
- 两阶段构建：`node:22-slim`（pnpm install + vitepress build）→ `nginx:alpine`（serve 静态文件）
- `VITE_*` 通过 build args 注入（VitePress 构建期烘焙）
- nginx 暴露 80 映射到 `${WIKI_PORT:-5175}`

## 启动脚本

`setup.sh` / `setup.bat` 支持参数：

```
./setup.sh [dev|prod] [up|down|build|logs|restart]
setup.bat  [dev|prod] [up|down|build|logs|restart]
```

默认 `dev up`。脚本自动选择对应的 compose 文件和 env 文件。

## 代码修改

仅需修改 1 处硬编码：

| 文件 | 修改 |
|------|------|
| `wiki/docs/.vitepress/config.ts:24` | `port: 5175` → `port: parseInt(process.env.WIKI_PORT \|\| '5175')` |

## 环境变量文件

`.env.dev` 从现有 `.env` 演化，保留手动模式默认值。
`.env.prod` 为生产模板，服务间地址使用占位符，需用户填写外部数据库/存储地址。

两个文件已加入 `.gitignore`（现有规则 `.env*` 已覆盖），提供 `.env.example` 作为模板参考。
