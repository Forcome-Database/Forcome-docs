# 钉钉用户体系集成设计文档

> 日期：2026-03-02
> 状态：已批准
> 分支：feater-dingding-user2
> 参考：feater-dingding-user（首次实现，缺少 DB 迁移，有登录/菜单 bug）

## 1. 目标

为 Docmost + Wiki 集成钉钉用户体系：

1. **Wiki 前台**：Web 钉钉扫码登录 + 钉钉 H5 免登，登录后才能访问内容
2. **Docmost 后台**：通过 Wiki 登录后 Cookie 共享实现无感 SSO
3. **离职处理**：钉钉事件回调自动停用 + 管理员手动停用，文档保留不丢失

## 2. 决策记录

| 决策点 | 结论 |
|--------|------|
| 部署方式 | 子域名：wiki.example.com + admin.example.com，共享 `.example.com` cookie |
| 钉钉应用类型 | 企业内部应用，单 corpId |
| 架构方案 | 方案 A：复用现有 `auth_providers` + `auth_accounts` SSO 框架 |
| 登录方式 | 仅钉钉登录（移除/隐藏邮箱密码），管理员保留邮箱+密码备用入口 |
| 首次登录默认角色 | MEMBER |
| Wiki 访问权限 | 登录后才能访问（不再公开） |
| 用户标识 | unionId（最稳定跨应用标识），存储在 auth_accounts.provider_user_id |
| 离职处理 | 钉钉事件回调自动停用 + 管理员手动，文档保留 |
| Redis 注入 | `RedisService` from `@nestjs-labs/nestjs-ioredis`（与项目现有一致） |

## 3. 架构总览

```
┌────────────────────────────────────────────────────────────┐
│                   Nginx / Reverse Proxy                     │
│  wiki.example.com   → Wiki (VitePress:5175)                │
│  admin.example.com  → Docmost (NestJS+React:3000)          │
│  *.example.com /api → Docmost API (NestJS:3000)            │
└────────────────────────────────────────────────────────────┘
        │                              │
        ▼                              ▼
┌──────────────┐              ┌──────────────────┐
│  Wiki 前端    │              │  Docmost 前端     │
│  (VitePress)  │              │  (React+Mantine)  │
│              │              │                  │
│ ● 登录页     │              │ ● 管理员邮箱登录  │
│ ● 钉钉扫码   │              │   (备用入口)      │
│ ● H5免登     │              │ ● 后台管理全功能  │
│ ● 内容浏览   │              │                  │
│ ● 后台入口   │              │                  │
└──────┬───────┘              └────────┬─────────┘
       │                               │
       └───────────┬───────────────────┘
                   ▼
        ┌─────────────────────┐
        │  Docmost 后端        │
        │  (NestJS + Fastify)  │
        │                     │
        │ /api/auth/dingtalk/* │  ← 新增
        │ /api/auth/login      │  ← 保留(管理员)
        │ /api/public-wiki/*   │  ← 保留
        │ 钉钉事件订阅         │  ← 新增(离职)
        └─────────┬───────────┘
                  │
       ┌──────────┴──────────┐
       ▼                     ▼
  ┌─────────┐          ┌─────────┐
  │PostgreSQL│          │  Redis  │
  │(现有表)  │          │(缓存    │
  │          │          │ token)  │
  └─────────┘          └─────────┘
```

## 4. 数据库设计

### 4.1 不新增表，复用现有 SSO 框架

**auth_providers** — 插入钉钉类型记录（`type='dingtalk'`，`settings` JSONB 存钉钉配置）：

```sql
INSERT INTO auth_providers (name, type, is_enabled, allow_signup, workspace_id, settings)
VALUES ('钉钉登录', 'dingtalk', true, true, :workspaceId,
  '{"corpId":"dingxxx","appKey":"dingxxx","appSecret":"xxx","agentId":"xxx"}'::jsonb);
```

- `type` 列已是 TEXT 类型（LDAP 迁移时改的），无阻碍
- 所有钉钉特有配置存 `settings` JSONB，无需新增列

**auth_accounts** — 存储钉钉 unionId → Docmost userId 映射：

```sql
-- provider_user_id = 钉钉 unionId
INSERT INTO auth_accounts (user_id, provider_user_id, auth_provider_id, workspace_id)
VALUES (:docmostUserId, :dingtalkUnionId, :providerId, :workspaceId);
```

### 4.2 无需数据库迁移

不需要数据库迁移文件，原因：
1. `auth_providers.type` 已是 TEXT 类型（LDAP 迁移 20250831T202306 时已改）
2. `auth_providers` 和 `auth_accounts` 表已存在且结构完全满足
3. 钉钉所有配置存 `settings` JSONB 字段，不需新增列
4. 钉钉 provider 记录通过 `DingTalkService.ensureProvider()` 运行时自动创建（首次调用时从环境变量种子）

### 4.3 离职处理

- 复用 `users.deactivated_at` 字段
- 停用后 `JwtStrategy.validate()` 自动拒绝（现有逻辑）
- 用户创建的文档通过 `pages.creator_id` 保留归属，不受停用影响
- 空间成员权限不变，其他成员仍可访问和编辑
- 停用 ≠ 删除：`deactivated_at` 标记，非物理删除，可恢复

## 5. 认证流程

### 5a. Web 扫码登录

```
用户 → wiki.example.com → 无 cookie → /login 页
  → 点击「钉钉登录」
  → redirect 到 login.dingtalk.com/oauth2/auth?client_id=&redirect_uri=&scope=openid
  → 用户扫码确认
  → 回调 wiki.example.com/login/callback?authCode=xxx&state=xxx
  → POST /api/auth/dingtalk/callback { authCode }
  → 后端：authCode → userAccessToken → /contact/users/me → unionId
  → findOrCreateUser(unionId) → 签发 JWT
  → Set-Cookie: authToken (domain=.example.com, httpOnly, secure, sameSite=lax)
  → 跳转到目标页面
```

### 5b. 钉钉 H5 免登

```
用户 → 钉钉工作台 → 打开微应用 → wiki.example.com
  → 检测 UA 包含 DingTalk
  → dd.runtime.permission.requestAuthCode({ corpId }) → 获取 code
  → POST /api/auth/dingtalk/h5-login { code }
  → 后端：corpAccessToken + code → getuserinfo → userid/unionid
  → userid → getUserDetail → 头像/姓名
  → findOrCreateUser(unionId) → 签发 JWT → Set-Cookie
  → 自动进入内容页面
```

### 5c. Docmost 后台 SSO

```
用户 → 点击 Wiki 的「后台管理」
  → admin.example.com
  → 浏览器自动携带 authToken cookie（.example.com 域）
  → JwtAuthGuard 验证通过 → 直接进入后台
```

### 5d. 管理员备用登录

```
管理员 → admin.example.com/auth/login → 输入邮箱 + 密码
  → POST /api/auth/login → Set-Cookie → 进入后台
```

## 6. 后端模块设计

### 6.1 目录结构

```
apps/server/src/ee/dingtalk/
├── dingtalk.module.ts           # NestJS Module
├── dingtalk.controller.ts       # API 端点
├── dingtalk.service.ts          # 核心业务（用户查找/创建/绑定/离职）
├── dingtalk-api.service.ts      # 钉钉 HTTP API 封装（token 缓存）
├── dto/
│   └── dingtalk.dto.ts          # 请求 DTO
└── types/
    └── dingtalk.types.ts        # 类型定义

apps/server/src/database/
└── repos/auth/
    ├── auth-account.repo.ts     # AuthAccount Repository（新建）
    └── auth-provider.repo.ts    # AuthProvider Repository（新建）
```

### 6.2 API 端点

| 端点 | 方法 | 认证 | 用途 |
|------|------|------|------|
| `POST /api/auth/dingtalk/config` | POST | @Public | 返回 corpId/appKey（前端构建授权 URL） |
| `POST /api/auth/dingtalk/callback` | POST | @Public | OAuth2 授权码换 JWT |
| `POST /api/auth/dingtalk/h5-login` | POST | @Public | H5 免登码换 JWT |
| `POST /api/auth/dingtalk/user-info` | POST | JWT | 获取当前登录用户信息（含 role） |
| `POST /api/auth/dingtalk/event` | POST | @Public（钉钉签名验证） | 钉钉事件订阅回调（离职等） |

### 6.3 关键服务

**DingTalkApiService** — 钉钉 HTTP API 封装：
- `getCorpAccessToken()` — Redis 缓存 7200s（含 300s buffer）
- `getUserAccessToken(authCode)` — OAuth2 换 token
- `getUserInfoByToken(token)` — /contact/users/me
- `getUserInfoByCode(code)` — H5 免登码换身份
- `getUserDetail(userid)` — 用户详情

**DingTalkService** — 核心业务：
- `handleOAuthCallback(authCode, workspaceId)` — Web 扫码登录
- `handleH5Login(code, workspaceId)` — H5 免登
- `findOrCreateUser(info, workspaceId)` — 查找/创建/绑定用户
- `handleUserLeave(userIds, workspaceId)` — 离职停用
- `ensureProvider(workspaceId)` — 自动种子 auth_provider

## 7. Wiki 前端改造

### 7.1 新增文件

```
wiki/docs/.vitepress/theme/
├── types/auth.ts              # 认证类型定义
├── services/auth.ts           # 认证 API 调用封装
├── composables/useAuth.ts     # 认证状态管理（Vue 响应式）
├── pages/
│   ├── LoginPage.vue          # 登录页（扫码 + H5 免登）
│   └── LoginCallback.vue      # OAuth 回调处理页
└── components/
    └── UserMenu.vue           # 右上角头像下拉菜单
```

### 7.2 修改文件

- `wiki/docs/.vitepress/theme/index.ts` — 添加登录路由 + 认证守卫
- `wiki/docs/.vitepress/theme/components/NavBar.vue` — 登录按钮 → UserMenu
- `wiki/docs/.vitepress/theme/Layout.vue` — 初始化 auth
- `wiki/package.json` — 添加 `dingtalk-jsapi` 依赖

### 7.3 路由守卫逻辑

```
onBeforePageLoad:
  /login, /login/callback → 渲染登录组件（无需认证）
  其他路由 → 检查 authToken cookie
    无 cookie → 检测是否钉钉内
      是 → 自动 H5 免登
      否 → 跳转 /login?redirect=当前路径
    有 cookie → 放行
```

### 7.4 头像下拉菜单

- 登录后显示钉钉头像（fallback: 姓名首字符）
- 「后台管理」入口（仅 admin/owner 角色可见）
- 「退出登录」

## 8. Docmost 前端改造

最小改动：
- `apps/client/src/lib/api-client.ts` 的 401 拦截器重定向到 wiki 登录

## 9. 环境变量

```bash
# 钉钉企业内部应用
DINGTALK_CORP_ID=dingxxxxxxxxx
DINGTALK_APP_KEY=dingxxxxxxxxx
DINGTALK_APP_SECRET=xxxxxxxxx
DINGTALK_AGENT_ID=xxxxxxxxx

# Cookie 域名（子域名共享）
COOKIE_DOMAIN=.example.com

# Wiki URL（Docmost 401 重定向用）
WIKI_URL=https://wiki.example.com
```

## 10. 数据回滚方案

```sql
-- 1. 删除钉钉 auth_accounts 绑定
DELETE FROM auth_accounts WHERE auth_provider_id IN (
  SELECT id FROM auth_providers WHERE type = 'dingtalk'
);

-- 2. 删除钉钉 auth_provider 配置
DELETE FROM auth_providers WHERE type = 'dingtalk';

-- 3. 钉钉创建的用户保留，管理员可为其设置密码恢复邮箱登录
-- 4. 恢复 Wiki 为公开模式：前端去除 authGuard 即可
-- 5. 恢复 Docmost Cookie 设置：移除 COOKIE_DOMAIN 环境变量
```

## 11. vs 旧分支（feater-dingding-user）的改进

| 改进项 | 旧分支 | 新实现 |
|--------|--------|--------|
| DB 迁移 | 不需要（正确） | 同样不需要（运行时 ensureProvider 自动种子） |
| Redis 注入 | `@InjectRedis()` | `RedisService.getOrThrow()`（与项目一致） |
| 登录/菜单 bug | 有 fix commit | 从零重写避免 |
| 离职处理 | 基础实现 | 完善钉钉事件签名验证 |
| auth_providers Repo | 放在 `database/repos/` | 同（正确位置） |
| 自动种子 | ensureProvider | 保留，增加幂等保护 |
