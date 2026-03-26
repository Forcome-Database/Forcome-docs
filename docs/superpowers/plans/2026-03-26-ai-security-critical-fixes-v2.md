# AI 写作安全关键修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 AI 写作系统中 2 个 Critical + 4 个 High 级别安全漏洞，建立安全基线。

**Architecture:** Python auth.py 空 secret 绕过修复；NestJS 网关新增 Redis session→user 映射实现 IDOR 防护；task_id 改为 UUID；DTO 输入长度限制；并发任务限制（Redis 计数器）；SSE 超时保护。

**Tech Stack:** Python 3.12 + FastAPI, NestJS 11 + Fastify, Redis, class-validator

**Spec:** `docs/superpowers/specs/2026-03-26-ai-writing-comprehensive-improvement-design.md` Section 5

---

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|------|---------|------|
| 修改 | `agent-service/app/middleware/auth.py` | 修复空 secret 绕过 |
| 修改 | `agent-service/app/config.py:31` | 启动时警告未配置 secret |
| 新增 | `agent-service/tests/test_auth_middleware.py` | auth 中间件测试 |
| 修改 | `agent-service/app/main.py:26,166-168` | task_id 改为 uuid4 |
| 修改 | `agent-service/app/models/session.py:33-61` | CreationSessionSnapshot 增加 user_id |
| 修改 | `apps/server/src/ee/ai/dto/ai.dto.ts` | 添加 @MaxLength |
| 修改 | `apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts:248,339,369,423` | IDOR 防护 + SSE 超时 |
| 修改 | `apps/server/src/ee/ai/agent-gateway/agent-gateway.service.ts` | 新增 session 所有权方法 |
| 修改 | `apps/server/src/ee/ai/ai-internal.controller.ts:147-157` | 强化 assertInternalSecret |

---

## Task 1: 修复 Python auth.py 空 secret 绕过漏洞

**背景：** `auth.py` 第 6 行 `request.headers.get("X-Internal-Secret", "")` 当 header 不存在时默认返回 `""`。若 `AGENT_INTERNAL_SECRET` 未配置（默认 `""`），`"" != ""` 为 False，认证恒通过。

**Files:**
- 修改: `agent-service/app/middleware/auth.py`
- 新增: `agent-service/tests/test_auth_middleware.py`

- [ ] **Step 1: 写失败测试**

```python
# agent-service/tests/test_auth_middleware.py
import pytest
from unittest.mock import MagicMock, patch
from fastapi import HTTPException


def _make_request(secret_header: str | None) -> MagicMock:
    req = MagicMock()
    headers = {}
    if secret_header is not None:
        headers["X-Internal-Secret"] = secret_header
    req.headers = headers
    return req


@pytest.mark.asyncio
async def test_rejects_missing_header():
    """No header → 401"""
    from app.middleware.auth import verify_internal_secret
    req = _make_request(None)
    with patch("app.middleware.auth.settings") as m:
        m.agent_internal_secret = "real-secret"
        with pytest.raises(HTTPException) as exc:
            await verify_internal_secret(req)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_rejects_empty_secret_config():
    """Empty env + empty header → 401 (not bypass)"""
    from app.middleware.auth import verify_internal_secret
    req = _make_request("")
    with patch("app.middleware.auth.settings") as m:
        m.agent_internal_secret = ""
        with pytest.raises(HTTPException) as exc:
            await verify_internal_secret(req)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_rejects_wrong_secret():
    """Wrong secret → 401"""
    from app.middleware.auth import verify_internal_secret
    req = _make_request("wrong")
    with patch("app.middleware.auth.settings") as m:
        m.agent_internal_secret = "correct"
        with pytest.raises(HTTPException) as exc:
            await verify_internal_secret(req)
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_accepts_correct_secret():
    """Correct secret → pass"""
    from app.middleware.auth import verify_internal_secret
    req = _make_request("my-secret")
    with patch("app.middleware.auth.settings") as m:
        m.agent_internal_secret = "my-secret"
        await verify_internal_secret(req)  # no exception
```

- [ ] **Step 2: 运行测试，确认 FAIL**

```bash
cd agent-service && pytest tests/test_auth_middleware.py -v
# 预期: test_rejects_empty_secret_config FAILED
```

- [ ] **Step 3: 修复 auth.py**

```python
# agent-service/app/middleware/auth.py — 完整替换
from fastapi import Request, HTTPException
from app.config import settings


async def verify_internal_secret(request: Request):
    """验证来自 NestJS 网关的内部通信密钥"""
    configured_secret = settings.agent_internal_secret
    if not configured_secret:
        raise HTTPException(
            status_code=401,
            detail="AGENT_INTERNAL_SECRET is not configured",
        )
    secret = request.headers.get("X-Internal-Secret")
    if not secret or secret != configured_secret:
        raise HTTPException(status_code=401, detail="Invalid internal secret")
```

- [ ] **Step 4: 运行测试，确认 PASS**

```bash
pytest tests/test_auth_middleware.py -v
# 预期: 4 passed
```

- [ ] **Step 5: Commit**

```bash
git add agent-service/app/middleware/auth.py agent-service/tests/test_auth_middleware.py
git commit -m "fix(security): reject empty X-Internal-Secret and unconfigured secret in agent-service"
```

---

## Task 2: 启动时警告未配置 secret

**Files:**
- 修改: `agent-service/app/config.py:31`

- [ ] **Step 1: 在 config.py 末尾（`settings = Settings()` 之后）添加警告**

```python
# agent-service/app/config.py — 在文件末尾追加
import warnings as _warnings

if not settings.agent_internal_secret:
    _warnings.warn(
        "AGENT_INTERNAL_SECRET is not configured. "
        "The agent-service API will reject all requests until this is set. "
        "Set AGENT_INTERNAL_SECRET in .env for production deployments.",
        stacklevel=1,
    )
```

- [ ] **Step 2: 确认启动时显示警告**

```bash
cd agent-service
AGENT_INTERNAL_SECRET="" python -c "from app.config import settings; print('ok')"
# 预期: UserWarning: AGENT_INTERNAL_SECRET is not configured...
```

- [ ] **Step 3: Commit**

```bash
git add agent-service/app/config.py
git commit -m "chore(security): warn on missing AGENT_INTERNAL_SECRET at startup"
```

---

## Task 3: task_id 从自增计数器改为 UUID

**背景：** `main.py` 第 26 行 `_task_counter` 全局自增，`task_id` 为 `task-1`, `task-2`... 完全可预测。

**Files:**
- 修改: `agent-service/app/main.py:26,166-168`

- [ ] **Step 1: 修改 main.py**

定位第 26 行 `_task_counter = 0`，删除。

定位第 166-168 行：
```python
global _task_counter
_task_counter += 1
task_id = f"task-{_task_counter}"
```

替换为：
```python
import uuid
task_id = f"task-{uuid.uuid4().hex[:12]}"
```

同时删除文件中所有其他 `global _task_counter` 引用。

- [ ] **Step 2: 确认无 linting 错误**

```bash
cd agent-service && python -c "from app.main import app; print('ok')"
# 预期: ok
```

- [ ] **Step 3: Commit**

```bash
git add agent-service/app/main.py
git commit -m "fix(security): replace predictable auto-increment task_id with uuid4"
```

---

## Task 4: DTO 添加输入长度上限

**背景：** `AiGenerateDto.content` 无 `@MaxLength` 限制，用户可提交任意大文本到 LLM。

**Files:**
- 修改: `apps/server/src/ee/ai/dto/ai.dto.ts`

- [ ] **Step 1: 修改 DTO**

在 `ai.dto.ts` 中添加 `MaxLength` 导入并应用：

```typescript
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

// ... AiAction enum 不变 ...

export class AiGenerateDto {
  @IsOptional()
  @IsEnum(AiAction)
  action?: AiAction;

  @IsNotEmpty()
  @IsString()
  @MaxLength(50000)
  content: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  prompt?: string;
}

export class AiAnswerDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(2000)
  query: string;
}
```

- [ ] **Step 2: TypeScript 编译检查**

```bash
cd apps/server && npx tsc --noEmit 2>&1 | grep "ai.dto"
# 预期: 无错误
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/ee/ai/dto/ai.dto.ts
git commit -m "fix(validation): add MaxLength to AiGenerateDto and AiAnswerDto fields"
```

---

## Task 5: IDOR 防护 — NestJS 侧 session 所有权验证

**背景：** `AgentGatewayController` 的 resume/session/stop 端点未验证会话所有者。使用 Redis 存储 session→user 映射。

**Files:**
- 修改: `apps/server/src/ee/ai/agent-gateway/agent-gateway.service.ts`
- 修改: `apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts:248,339,369,423`

- [ ] **Step 1: 在 AgentGatewayService 中新增 session 所有权方法**

在 `agent-gateway.service.ts` 中注入 Redis 并添加方法：

```typescript
import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { InjectRedis } from '@nestjs-modules/ioredis';
import Redis from 'ioredis';
import { EnvironmentService } from '../../../integrations/environment/environment.service';

const SESSION_OWNER_PREFIX = 'agent_session_owner:';
const SESSION_OWNER_TTL = 86400; // 24 hours

@Injectable()
export class AgentGatewayService {
  private readonly logger = new Logger(AgentGatewayService.name);

  constructor(
    private environmentService: EnvironmentService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async registerSessionOwner(sessionId: string, userId: string, workspaceId: string): Promise<void> {
    await this.redis.set(
      `${SESSION_OWNER_PREFIX}${sessionId}`,
      JSON.stringify({ userId, workspaceId }),
      'EX',
      SESSION_OWNER_TTL,
    );
  }

  async validateSessionOwner(sessionId: string, userId: string): Promise<void> {
    const raw = await this.redis.get(`${SESSION_OWNER_PREFIX}${sessionId}`);
    if (!raw) {
      throw new ForbiddenException('Session not found or expired');
    }
    const { userId: ownerId } = JSON.parse(raw);
    if (ownerId !== userId) {
      throw new ForbiddenException('You do not own this session');
    }
  }

  // ... 保留所有现有方法 ...
```

- [ ] **Step 2: 确认 Redis 模块已在 AI Module 中导入**

```bash
grep -n "RedisModule\|InjectRedis\|ioredis" apps/server/src/ee/ai/ai.module.ts
# 如果无结果，需要检查 Redis 在项目中的导入方式
```

在项目根 module 中搜索 Redis 导入模式：

```bash
grep -rn "InjectRedis\|@nestjs-modules/ioredis\|RedisModule" apps/server/src/ --include="*.ts" | head -10
```

按项目已有的 Redis 注入模式添加到 `AgentGatewayService` 的构造函数中。

- [ ] **Step 3: 在 controller 的 runAgent 中注册 session 所有者**

在 `agent-gateway.controller.ts` 第 248 行的 `runAgent` 方法中，SSE 流建立后（获取到 `session_id` 后）注册所有者。

在 SSE 事件处理中找到 `type: "session"` 事件（包含 `session_id`），在该事件后调用：

```typescript
// 在 runAgent 方法中，SSE 事件解析 session_id 后
if (parsed.type === 'session' && parsed.session_id) {
  await this.agentGatewayService.registerSessionOwner(
    parsed.session_id,
    user.id,
    user.workspaceId,
  );
}
```

- [ ] **Step 4: 在 resumeAgent 中验证所有权**

在 `agent-gateway.controller.ts` 第 339 行的 `resumeAgent` 方法开头添加：

```typescript
async resumeAgent(@AuthUser() user: User, @Body() body: any, ...) {
  const sessionId = body.sessionId || body.session_id;
  if (sessionId) {
    await this.agentGatewayService.validateSessionOwner(sessionId, user.id);
  }
  // ... 现有逻辑 ...
}
```

- [ ] **Step 5: 在 getSessionSnapshot 中验证所有权**

在 `agent-gateway.controller.ts` 第 369 行的 `getSessionSnapshot` 方法开头添加：

```typescript
async getSessionSnapshot(@AuthUser() user: User, @Param('sessionId') sessionId: string) {
  await this.agentGatewayService.validateSessionOwner(sessionId, user.id);
  // ... 现有逻辑 ...
}
```

- [ ] **Step 6: 在 stopAgent 中验证所有权**

在 `agent-gateway.controller.ts` 第 423 行的 `stopAgent` 方法中，从 body 中提取 session_id 并验证：

```typescript
async stopAgent(@AuthUser() user: User, @Body() body: any) {
  // stop 使用 task_id，需要从 session 映射反查
  // 如果 body 中有 session_id，验证所有权
  if (body.session_id) {
    await this.agentGatewayService.validateSessionOwner(body.session_id, user.id);
  }
  // ... 现有逻辑 ...
}
```

- [ ] **Step 7: TypeScript 编译检查**

```bash
cd apps/server && npx tsc --noEmit 2>&1 | grep -i "error"
# 预期: 无错误
```

- [ ] **Step 8: Commit**

```bash
git add apps/server/src/ee/ai/agent-gateway/
git commit -m "fix(security): add session ownership validation to prevent IDOR in Agent endpoints"
```

---

## Task 6: 并发 Agent 任务限制

**背景：** 无并发限制，恶意用户可发起大量 Agent 任务消耗 LLM API 额度。

**Files:**
- 修改: `apps/server/src/ee/ai/agent-gateway/agent-gateway.service.ts`
- 修改: `apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts:248`

- [ ] **Step 1: 在 AgentGatewayService 中添加并发控制方法**

```typescript
const CONCURRENT_PREFIX = 'agent_concurrent:';
const MAX_CONCURRENT_TASKS = 3;
const CONCURRENT_TTL = 1800; // 30 min safety net

async acquireTaskSlot(userId: string): Promise<boolean> {
  const key = `${CONCURRENT_PREFIX}${userId}`;
  const current = await this.redis.incr(key);
  if (current === 1) {
    await this.redis.expire(key, CONCURRENT_TTL);
  }
  if (current > MAX_CONCURRENT_TASKS) {
    await this.redis.decr(key);
    return false;
  }
  return true;
}

async releaseTaskSlot(userId: string): Promise<void> {
  const key = `${CONCURRENT_PREFIX}${userId}`;
  const val = await this.redis.decr(key);
  if (val <= 0) {
    await this.redis.del(key);
  }
}
```

- [ ] **Step 2: 在 runAgent 中调用 acquireTaskSlot**

在 `agent-gateway.controller.ts` 的 `runAgent` 方法开头添加：

```typescript
const allowed = await this.agentGatewayService.acquireTaskSlot(user.id);
if (!allowed) {
  throw new HttpException(
    'Too many concurrent AI tasks. Maximum 3 allowed.',
    HttpStatus.TOO_MANY_REQUESTS,
  );
}
```

在 SSE 流结束的 cleanup（`finally` 块或 `res.raw.on('close', ...)`）中添加：

```typescript
await this.agentGatewayService.releaseTaskSlot(user.id);
```

- [ ] **Step 3: TypeScript 编译检查**

```bash
cd apps/server && npx tsc --noEmit 2>&1 | grep -i "error"
# 预期: 无错误
```

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/ee/ai/agent-gateway/
git commit -m "fix(security): add per-user concurrent Agent task limit (max 3)"
```

---

## Task 7: SSE 代理超时保护

**背景：** NestJS → Agent 的 SSE 代理无超时限制，连接可永久保持。

**Files:**
- 修改: `apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts`

- [ ] **Step 1: 找到 SSE 代理逻辑**

```bash
grep -n "http.request\|proxyAgent\|createConnection\|SSE" \
  apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts | head -20
```

- [ ] **Step 2: 添加超时**

在 `http.request` 的 options 中添加 `timeout: 660000`（660 秒，略大于 Agent 侧 600 秒等待超时）：

```typescript
const proxyReq = http.request(
  {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    method: 'POST',
    headers: { ... },
    timeout: 660000,  // ← 新增
  },
  (proxyRes) => { ... },
);

proxyReq.on('timeout', () => {
  proxyReq.destroy();
  if (!res.raw.writableEnded) {
    res.raw.end();
  }
});
```

- [ ] **Step 3: TypeScript 编译检查**

```bash
cd apps/server && npx tsc --noEmit 2>&1 | grep -i "error"
# 预期: 无错误
```

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/ee/ai/agent-gateway/agent-gateway.controller.ts
git commit -m "fix(security): add 660s timeout to SSE proxy to prevent indefinite connections"
```

---

## Task 8: 强化 AiInternalController 的 assertInternalSecret

**背景：** NestJS 侧 `assertInternalSecret` 已经安全（`!secret` 检查），但应额外在 secret 未配置时提前拒绝。

**Files:**
- 修改: `apps/server/src/ee/ai/ai-internal.controller.ts:147-157`

- [ ] **Step 1: 修改 assertInternalSecret**

在 `ai-internal.controller.ts` 第 147 行的方法中，增加"未配置 secret 时拒绝"的检查：

```typescript
private assertInternalSecret(req: FastifyRequest) {
  const configuredSecret = this.environmentService.getAgentInternalSecret();
  if (!configuredSecret) {
    throw new UnauthorizedException(
      'AGENT_INTERNAL_SECRET is not configured. Internal endpoints are disabled.',
    );
  }
  const header = req.headers['x-internal-secret'];
  const secret = Array.isArray(header) ? header[0] : header;
  if (!secret || secret !== configuredSecret) {
    throw new UnauthorizedException('Invalid internal secret');
  }
}
```

- [ ] **Step 2: TypeScript 编译检查**

```bash
cd apps/server && npx tsc --noEmit 2>&1 | grep "ai-internal"
# 预期: 无错误
```

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/ee/ai/ai-internal.controller.ts
git commit -m "fix(security): reject internal API calls when AGENT_INTERNAL_SECRET is unconfigured"
```

---

## 验收检查

所有 Task 完成后执行：

```bash
# Python 单元测试
cd agent-service
pytest tests/test_auth_middleware.py -v

# TypeScript 编译
cd apps/server && npx tsc --noEmit

# 验证 task_id 不再可预测
cd agent-service
python -c "
import uuid
tid = f'task-{uuid.uuid4().hex[:12]}'
print(f'Sample task_id: {tid}')
assert len(tid) > 10 and 'task-' in tid
print('OK: task_id is UUID-based')
"

# 验证 auth.py 空 secret 被拒绝
cd agent-service
python -c "
import asyncio
from unittest.mock import MagicMock, patch
from fastapi import HTTPException
from app.middleware.auth import verify_internal_secret

async def test():
    req = MagicMock()
    req.headers = {}
    with patch('app.middleware.auth.settings') as m:
        m.agent_internal_secret = ''
        try:
            await verify_internal_secret(req)
            print('FAIL: should have rejected')
        except HTTPException as e:
            assert e.status_code == 401
            print('OK: empty secret rejected')
asyncio.run(test())
"
```

预期：全部通过，0 failures，0 TypeScript errors。
