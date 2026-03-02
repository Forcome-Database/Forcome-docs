# 钉钉用户体系集成 — 重构细节与踩坑记录

## 1. 概述

在 Docmost + Wiki 中集成钉钉企业内部应用用户体系，实现：
- Wiki 前台：Web 钉钉扫码登录 + 钉钉工作台 H5 免登
- Docmost 后台：通过子域名 Cookie 共享实现无感 SSO
- 离职处理：钉钉事件回调自动停用用户，文档保留不丢失

分支：`feater-dingding-user2`（从 master `8349267` 切出）
参考分支：`feater-dingding-user`（首次实现，有已知 bug）

## 2. 架构决策

| 决策点 | 结论 | 原因 |
|--------|------|------|
| 钉钉应用类型 | 企业内部应用 | 仅限本企业员工，API 更简单 |
| 用户标识 | unionId | 跨应用唯一，比 openId（单应用）和 userId（单企业）更稳定 |
| 数据库方案 | 复用 `auth_providers` + `auth_accounts` | 已有 SSO 框架，`type` 列已是 TEXT，无需新表/迁移 |
| 登录方式 | 仅钉钉（管理员保留邮箱密码备用） | 企业统一入口 |
| 部署方式 | 子域名（wiki.xx.com + admin.xx.com） | 共享父域 Cookie |
| Cookie 共享 | `domain=.example.com` + `sameSite=lax` | 跨子域免登 |

## 3. 新增/修改文件清单

### 后端（8 个新文件，5 个修改）

| 文件 | 类型 | 说明 |
|------|------|------|
| `apps/server/src/ee/dingtalk/types/dingtalk.types.ts` | 新建 | 钉钉 API 类型定义 |
| `apps/server/src/ee/dingtalk/dingtalk-api.service.ts` | 新建 | 钉钉 HTTP API 封装，corpAccessToken Redis 缓存 |
| `apps/server/src/ee/dingtalk/dingtalk.service.ts` | 新建 | 核心业务：OAuth 回调、H5 免登、findOrCreateUser、离职停用、auto-seed provider |
| `apps/server/src/ee/dingtalk/dingtalk.controller.ts` | 新建 | 5 个 API 端点：config/callback/h5-login/user-info/event |
| `apps/server/src/ee/dingtalk/dto/dingtalk.dto.ts` | 新建 | DTO（class-validator） |
| `apps/server/src/ee/dingtalk/dingtalk.module.ts` | 新建 | NestJS Module，导入 TokenModule |
| `apps/server/src/database/repos/auth/auth-account.repo.ts` | 新建 | AuthAccount Repository |
| `apps/server/src/database/repos/auth/auth-provider.repo.ts` | 新建 | AuthProvider Repository，含 upsertDingtalkProvider |
| `apps/server/src/ee/ee.module.ts` | 修改 | 注册 DingTalkModule |
| `apps/server/src/database/database.module.ts` | 修改 | 注册 Auth Repos |
| `apps/server/src/integrations/environment/environment.service.ts` | 修改 | 新增 6 个 getter |
| `apps/server/src/core/auth/auth.controller.ts` | 修改 | setAuthCookie 支持 Cookie domain |
| `apps/server/src/main.ts` | 修改 | excludedPaths 加入 `/api/auth/dingtalk` |

### Wiki 前端（6 个新文件，3 个修改）

| 文件 | 类型 | 说明 |
|------|------|------|
| `wiki/docs/.vitepress/theme/types/auth.ts` | 新建 | AuthUser / DingTalkConfig 类型 |
| `wiki/docs/.vitepress/theme/services/auth.ts` | 新建 | AuthService 封装（含 `.data` 解包） |
| `wiki/docs/.vitepress/theme/composables/useAuth.ts` | 新建 | 认证状态管理（authMarker cookie） |
| `wiki/docs/.vitepress/theme/pages/LoginPage.vue` | 新建 | 登录页（Web 扫码 + H5 免登） |
| `wiki/docs/.vitepress/theme/pages/LoginCallback.vue` | 新建 | OAuth2 回调处理页 |
| `wiki/docs/.vitepress/theme/components/UserMenu.vue` | 新建 | 头像下拉菜单 |
| `wiki/docs/.vitepress/theme/index.ts` | 修改 | 登录路由 + auth guard |
| `wiki/docs/.vitepress/theme/components/NavBar.vue` | 修改 | 登录按钮 → UserMenu |
| `wiki/docs/.vitepress/theme/Layout.vue` | 修改 | 登录页条件渲染 + initAuth |

### Docmost 前端（1 个修改）

| 文件 | 类型 | 说明 |
|------|------|------|
| `apps/client/src/lib/api-client.ts` | 修改 | 401 重定向到 wiki 登录 |

## 4. API 端点

| 端点 | 认证 | 用途 |
|------|------|------|
| `POST /api/auth/dingtalk/config` | @Public | 返回 corpId/appKey（不含 secret） |
| `POST /api/auth/dingtalk/callback` | @Public | OAuth2 authCode → JWT + Set-Cookie |
| `POST /api/auth/dingtalk/h5-login` | @Public | H5 免登码 → JWT + Set-Cookie |
| `POST /api/auth/dingtalk/user-info` | JWT | 返回当前用户信息（含 role） |
| `POST /api/auth/dingtalk/event` | @Public | 钉钉事件订阅（离职等） |

## 5. 认证流程

### Web 扫码登录
```
wiki.example.com → 无 authMarker cookie → /login
  → 点击「钉钉登录」→ login.dingtalk.com/oauth2/auth?client_id=&scope=openid
  → 用户扫码 → 回调 /login/callback?authCode=xxx&state=xxx
  → POST /api/auth/dingtalk/callback { authCode }
  → 后端：authCode → userAccessToken → /contact/users/me → unionId
  → findOrCreateUser → JWT → Set-Cookie(authToken, httpOnly, domain=.example.com)
  → 前端：设置 authMarker cookie（非 httpOnly）→ 跳转目标页
```

### H5 免登
```
钉钉工作台 → wiki.example.com → 检测 DingTalk UA
  → dd.runtime.permission.requestAuthCode({ corpId }) → code
  → POST /api/auth/dingtalk/h5-login { code }
  → 后端：corpAccessToken + code → userid/unionid → findOrCreateUser → JWT
  → Set-Cookie + authMarker → 进入内容页
```

### 跨子域 SSO
```
wiki 点击「后台管理」→ admin.example.com
  → 浏览器自动携带 authToken cookie（.example.com 域）
  → JwtAuthGuard 验证通过 → 直接进入后台
```

## 6. 离职处理

- 钉钉事件订阅 `user_leave_org` → 后端自动设置 `users.deactivated_at`
- `JwtStrategy.validate()` 已有检查 `deactivatedAt`，停用后 JWT 立即失效
- 文档通过 `pages.creator_id` 保留归属，不受停用影响
- 停用 ≠ 删除，管理员可在后台恢复

## 7. 环境变量

```bash
# 钉钉企业内部应用
DINGTALK_CORP_ID=dingxxxxxxxxx
DINGTALK_APP_KEY=dingxxxxxxxxx
DINGTALK_APP_SECRET=xxxxxxxxx
DINGTALK_AGENT_ID=xxxxxxxxx

# Cookie 域名（子域名共享）
COOKIE_DOMAIN=.example.com

# Wiki URL（Docmost 401 重定向）
WIKI_URL=https://wiki.example.com

# Wiki 侧 .env
VITE_ADMIN_URL=https://admin.example.com
VITE_DOCMOST_API_URL=https://admin.example.com/api/public-wiki
```

## 8. 数据回滚方案

```sql
-- 1. 删除绑定
DELETE FROM auth_accounts WHERE auth_provider_id IN (
  SELECT id FROM auth_providers WHERE type = 'dingtalk'
);
-- 2. 删除 provider
DELETE FROM auth_providers WHERE type = 'dingtalk';
-- 3. 用户保留，可设置密码恢复邮箱登录
-- 4. 前端去除 authGuard 恢复公开模式
-- 5. 移除 COOKIE_DOMAIN 环境变量
```

---

## 9. 踩坑记录

### 9.1 authToken 是 httpOnly，JS 读不到

**现象**：登录成功后仍被 auth guard 拦截，无限重定向到 `/login`

**原因**：后端设置的 `authToken` cookie 带 `httpOnly: true`，JavaScript 的 `document.cookie` 无法读取它。auth guard 检查 `document.cookie.includes('authToken')` 永远返回 `false`。

**修复**：引入非 httpOnly 的 `authMarker` cookie 作为 JS 层面的登录标记：
```typescript
// 登录成功后
document.cookie = 'authMarker=1; path=/; max-age=7776000' // 90 days

// auth guard 检查
const hasAuth = document.cookie.includes('authMarker=')

// initAuth 中如果 authMarker 存在但 API 验证失败（session 过期），清除过期 marker
if (hasCookie('authMarker')) {
  const ok = await fetchUserInfo()
  if (!ok) clearAuthMarker()
}
```

### 9.2 VitePress 登录路由 404

**现象**：浏览器直接访问 `/login` 显示 404 页面

**原因**：`onBeforePageLoad` 只在 **客户端路由导航** 时触发。浏览器硬刷新（直接输入 URL 或从钉钉回调）时，VitePress 找不到对应的 `.md` 文件，直接标记为 `isNotFound`，`onBeforePageLoad` 虽然设置了 `router.route.component = LoginPage`，但 Layout 模板中没有对应的条件渲染。

**修复**：在 `Layout.vue` 中增加双重保障：
```vue
<script setup>
const isLoginPage = computed(() => route.path === '/login' || route.path === '/login/')
const isLoginCallback = computed(() => route.path.startsWith('/login/callback'))

// 404 判断排除登录路由
const is404 = computed(() => page.value.isNotFound && !isDocmostRoute.value && !isLoginPage.value && !isLoginCallback.value)
</script>

<template>
  <!-- 登录页面由 Layout 直接渲染，不依赖 VitePress Content -->
  <LoginPage v-if="isLoginPage" />
  <LoginCallback v-else-if="isLoginCallback" />
  <NotFound v-else-if="is404" />
  <DocmostContent v-else-if="isDocmostRoute" />
  <Content v-else />
</template>
```

**教训**：VitePress 动态路由不能只依赖 `onBeforePageLoad`，Layout 层必须有兜底渲染逻辑。

### 9.3 Auth guard 无限重定向循环

**现象**：访问任何页面都无限重定向到 `/login?redirect=/login?redirect=/login?redirect=...`

**原因**：auth guard 用 `window.location.href` 重定向到 `/login`，这是浏览器级硬导航。重定向后页面重新加载，auth guard 再次触发（因为 `/login` 没被豁免），再次重定向... 无限循环。

**修复**：
1. auth guard 豁免所有 `/login` 开头的路径：
```typescript
if (typeof document !== 'undefined' && !to.startsWith('/login')) {
```
2. 使用 `router.go()` 代替 `window.location.href`（VitePress 内部路由，不触发硬刷新）

### 9.4 UserMenu 下拉菜单 hover 间隙消失

**现象**：鼠标从头像移向下拉菜单的过程中，菜单自动消失

**原因**：下拉菜单 `.user-dropdown` 使用 `margin-top: 8px` 创建与触发器的间距。`margin` 是元素外部空间，鼠标经过时不属于 `.user-menu` 元素，触发 `mouseleave` 事件。

**修复**：将 `margin-top: 8px` 改为 `padding-top: 8px`。`padding` 是元素内部空间，鼠标经过时仍在元素内，不触发 `mouseleave`。

### 9.5 Redis 注入方式必须与项目一致

**现象**：首次实现（feater-dingding-user 分支）使用 `@InjectRedis()` 注入 Redis，编译报错

**原因**：Docmost 项目使用 `@nestjs-labs/nestjs-ioredis` 的 `RedisService`，不是 `@songkeys/nestjs-redis` 的 `@InjectRedis()`。

**修复**：参照 `collab-history.service.ts` 的模式：
```typescript
import { RedisService } from '@nestjs-labs/nestjs-ioredis';
import type { Redis } from 'ioredis';

constructor(private readonly redisService: RedisService) {
  this.redis = this.redisService.getOrThrow();
}
```

### 9.6 TransformHttpResponseInterceptor 包装响应

**现象**：Wiki 前端调用 API 获取的数据结构不对

**原因**：Docmost 的 `TransformHttpResponseInterceptor` 将所有响应包装为 `{ data: ... }` 格式。

**修复**：Wiki 的 `AuthService.post()` 方法需要解包：
```typescript
const json = await response.json()
return json.data !== undefined ? json.data : json
```

### 9.7 不需要数据库迁移

**现象**：首次实现误以为需要新增迁移文件

**原因**：
- `auth_providers.type` 已在 LDAP 迁移（`20250831T202306`）中改为 TEXT 类型
- `auth_providers` 和 `auth_accounts` 表结构完全满足需求
- 钉钉配置全部存在 `settings` JSONB 字段
- Provider 记录通过 `ensureProvider()` 运行时自动种子

**教训**：改动前先读现有迁移文件，确认表结构是否已经满足需求。

### 9.8 开发环境双端口

**现象**：Wiki 的「后台管理」链接打开的 Docmost 功能缺失（显示旧版本）

**原因**：`pnpm dev` 启动两个服务：
- `localhost:5173` — Vite dev server（实时热更新，最新代码）
- `localhost:3000` — NestJS 后端（同时托管旧的前端构建产物）

Wiki 的 `VITE_ADMIN_URL` 指向了 `localhost:3000`（旧产物）。

**修复**：开发环境 `VITE_ADMIN_URL=http://localhost:5173`，API URL 保持 `localhost:3000`（API 在后端）。

### 9.9 钉钉 OAuth2 参数名

**注意**：钉钉新版 OAuth2（`login.dingtalk.com/oauth2/auth`）回调参数名是 `authCode`，不是标准 OAuth2 的 `code`。虽然请求时 `response_type=code`，但回调中参数名是 `authCode`。

```typescript
// 正确
const authCode = params.get('authCode')

// 错误（这是旧版 API 或其他 OAuth2 提供商的写法）
const code = params.get('code')
```
