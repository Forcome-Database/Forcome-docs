# 钉钉SSO集成实施方案

> **对于Claude：** 必须使用的子技能：使用超能力：executing-plans来逐个任务地实施该计划。

**目标：** 将钉钉认证集成到Wiki（VitePress）和Docmost（NestJS）中，实现网页二维码登录、H5静默登录、跨子域单点登录、员工自动离职处理。

**架构：** 共享 `.example.com` cookie 域上的 Wiki 主导的身份验证。 Docmost后端处理所有钉钉API交互。 Wiki 前端提供登录 UI。重用现有的 `auth_providers` + `auth_accounts` SSO 框架 — 无需新的数据库表或迁移。钉钉提供商记录在运行时从环境变量自动播种。

**技术栈：** NestJS 11 + Fastify（后端）、VitePress 2 + Vue 3（wiki前端）、钉钉OAuth2 + JSAPI、Redis via `@nestjs-labs/nestjs-ioredis`（令牌缓存）、Kysely（DB）

**参考分支：** `feater-dingding-user` — 具有已知错误的第一个实现。该计划在 `feater-dingding-user2` 上干净地重写。

---

## 任务 1: 后端 — Environment Variables & Cookie Domain Support

**文件：**
- 修改：`apps/server/src/integrations/environment/environment.service.ts`
- 修改：`apps/server/src/core/auth/auth.controller.ts`（setAuthCookie 方法，~第 176 行）
- 修改：`apps/server/src/main.ts`（排除路径数组，~第 72 行）
- 修改：`.env.example`

**步骤 1：将环境 getter 添加到 EnvironmentService**

打开`apps/server/src/integrations/environment/environment.service.ts`。在类中的最后一个方法之后添加这些方法：

```typescript
getCookieDomain(): string | undefined {
  return this.configService.get<string>('COOKIE_DOMAIN');
}

getWikiUrl(): string {
  return this.configService.get<string>('WIKI_URL', '');
}

getDingtalkCorpId(): string {
  return this.configService.get<string>('DINGTALK_CORP_ID', '');
}

getDingtalkAppKey(): string {
  return this.configService.get<string>('DINGTALK_APP_KEY', '');
}

getDingtalkAppSecret(): string {
  return this.configService.get<string>('DINGTALK_APP_SECRET', '');
}

getDingtalkAgentId(): string {
  return this.configService.get<string>('DINGTALK_AGENT_ID', '');
}
```

**步骤2：修改setAuthCookie以支持跨子域**

在 `apps/server/src/core/auth/auth.controller.ts` 中，找到 `setAuthCookie` 方法并将其替换为：

```typescript
setAuthCookie(res: FastifyReply, token: string) {
  const cookieOpts: any = {
    httpOnly: true,
    path: '/',
    expires: this.environmentService.getCookieExpiresIn(),
    secure: this.environmentService.isHttps(),
    sameSite: 'lax',
  };
  const domain = this.environmentService.getCookieDomain();
  if (domain) {
    cookieOpts.domain = domain;
  }
  res.setCookie('authToken', token, cookieOpts);
}
```

**第三步：将钉钉路由添加到main.ts中排除的路径**

在 `apps/server/src/main.ts` 中，找到 preHandler 挂钩中的 `excludedPaths` 数组并添加：

```typescript
'/api/auth/dingtalk',
```

**第 4 步：更新 .env.example**

附加到`.env.example`：

```env
# DingTalk SSO (Enterprise Internal App)
DINGTALK_CORP_ID=
DINGTALK_APP_KEY=
DINGTALK_APP_SECRET=
DINGTALK_AGENT_ID=

# Cookie domain for cross-subdomain SSO (e.g. .example.com)
COOKIE_DOMAIN=

# Wiki URL (for Docmost 401 redirect)
WIKI_URL=
```

**第 5 步：承诺**

```bash
git add apps/server/src/integrations/environment/environment.service.ts apps/server/src/core/auth/auth.controller.ts apps/server/src/main.ts .env.example
git commit -m "feat(auth): add cookie domain support and dingtalk env config"
```

---

## 任务 2: 后端 — AuthAccount & AuthProvider Repositories

**文件：**
- 创建：`apps/server/src/database/repos/auth/auth-account.repo.ts`
- 创建：`apps/server/src/database/repos/auth/auth-provider.repo.ts`
- 修改：`apps/server/src/database/database.module.ts`

**第 1 步：创建AuthAccountRepo**

参考模式：`apps/server/src/database/repos/user/user.repo.ts` 用于注入样式。

```typescript
// apps/server/src/database/repos/auth/auth-account.repo.ts
import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';

@Injectable()
export class AuthAccountRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async findByProviderUserId(
    providerUserId: string,
    authProviderId: string,
    workspaceId: string,
  ) {
    return this.db
      .selectFrom('authAccounts')
      .selectAll()
      .where('providerUserId', '=', providerUserId)
      .where('authProviderId', '=', authProviderId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  async findByUserId(userId: string, authProviderId: string) {
    return this.db
      .selectFrom('authAccounts')
      .selectAll()
      .where('userId', '=', userId)
      .where('authProviderId', '=', authProviderId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  async insertAuthAccount(
    data: {
      userId: string;
      providerUserId: string;
      authProviderId: string;
      workspaceId: string;
    },
    trx?: KyselyTransaction,
  ) {
    const db = dbOrTx(this.db, trx);
    return db
      .insertInto('authAccounts')
      .values({
        userId: data.userId,
        providerUserId: data.providerUserId,
        authProviderId: data.authProviderId,
        workspaceId: data.workspaceId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
```

**第 2 步：创建AuthProviderRepo**

```typescript
// apps/server/src/database/repos/auth/auth-provider.repo.ts
import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';

@Injectable()
export class AuthProviderRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async findByType(type: string, workspaceId: string) {
    return this.db
      .selectFrom('authProviders')
      .selectAll()
      .where('type', '=', type)
      .where('workspaceId', '=', workspaceId)
      .where('isEnabled', '=', true)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  async findById(id: string, workspaceId: string) {
    return this.db
      .selectFrom('authProviders')
      .selectAll()
      .where('id', '=', id)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  async upsertDingtalkProvider(
    workspaceId: string,
    settings: Record<string, any>,
  ) {
    const existing = await this.findByType('dingtalk', workspaceId);
    if (existing) {
      return this.db
        .updateTable('authProviders')
        .set({ settings: JSON.stringify(settings), updatedAt: new Date() })
        .where('id', '=', existing.id)
        .returningAll()
        .executeTakeFirstOrThrow();
    }
    return this.db
      .insertInto('authProviders')
      .values({
        name: '钉钉登录',
        type: 'dingtalk',
        isEnabled: true,
        allowSignup: true,
        workspaceId,
        settings: JSON.stringify(settings),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}
```

**第 3 步：在DatabaseModule中注册存储库**

In `apps/server/src/database/database.module.ts`:
- 在顶部添加导入：

```typescript
import { AuthAccountRepo } from './repos/auth/auth-account.repo';
import { AuthProviderRepo } from './repos/auth/auth-provider.repo';
```

- 将 `AuthAccountRepo, AuthProviderRepo` 添加到 `providers` 和 `exports` 数组。

**第 4 步：承诺**

```bash
git add apps/server/src/database/repos/auth/ apps/server/src/database/database.module.ts
git commit -m "feat(db): add AuthAccount and AuthProvider repositories"
```

---

## 任务 3: 后端 — DingTalk Types & API Service

**文件：**
- 创建：`apps/server/src/ee/dingtalk/types/dingtalk.types.ts`
- 创建：`apps/server/src/ee/dingtalk/dingtalk-api.service.ts`

**第一步：创建钉钉类型**

```typescript
// apps/server/src/ee/dingtalk/types/dingtalk.types.ts
export interface DingTalkTokenResult {
  accessToken: string;
  refreshToken: string;
  expireIn: number;
  corpId?: string;
}

export interface DingTalkUserInfo {
  nick: string;
  unionId: string;
  openId: string;
  avatarUrl?: string;
  email?: string;
  mobile?: string;
  stateCode?: string;
}

export interface DingTalkH5UserInfo {
  userid: string;
  unionid: string;
  name?: string;
  sys?: boolean;
  sysLevel?: number;
}

export interface DingTalkUserDetail {
  userid: string;
  unionid: string;
  name: string;
  avatar: string;
  email?: string;
  mobile?: string;
  title?: string;
  deptIdList?: number[];
}

export interface DingTalkCorpTokenResult {
  accessToken: string;
  expireIn: number;
}

export interface DingTalkEventPayload {
  encrypt: string;
}

export interface DingTalkEventDecrypted {
  EventType: string;
  UserId?: string[];
  CorpId?: string;
  TimeStamp?: string;
}

export interface DingTalkConfig {
  corpId: string;
  appKey: string;
  appSecret: string;
  agentId: string;
  eventToken?: string;
  eventAesKey?: string;
}
```

**第二步：创建钉钉ApiService**

与旧分支的主要区别：使用 `@nestjs-labs/nestjs-ioredis` 中的 `RedisService` 和 `getOrThrow()` 模式（匹配 `apps/server/src/collaboration/services/collab-history.service.ts`）。

```typescript
// apps/server/src/ee/dingtalk/dingtalk-api.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import {
  DingTalkCorpTokenResult,
  DingTalkH5UserInfo,
  DingTalkTokenResult,
  DingTalkUserDetail,
  DingTalkUserInfo,
} from './types/dingtalk.types';
import { RedisService } from '@nestjs-labs/nestjs-ioredis';
import type { Redis } from 'ioredis';

const DINGTALK_API = 'https://api.dingtalk.com';
const DINGTALK_OAPI = 'https://oapi.dingtalk.com';

@Injectable()
export class DingTalkApiService {
  private readonly logger = new Logger(DingTalkApiService.name);
  private readonly redis: Redis;

  constructor(
    private environmentService: EnvironmentService,
    private readonly redisService: RedisService,
  ) {
    this.redis = this.redisService.getOrThrow();
  }

  /**
   * Get corp access token (cached in Redis for 7200s - 300s buffer)
   */
  async getCorpAccessToken(): Promise<string> {
    const cacheKey = 'dingtalk:corp_access_token';
    const cached = await this.redis.get(cacheKey);
    if (cached) return cached;

    const appKey = this.environmentService.getDingtalkAppKey();
    const appSecret = this.environmentService.getDingtalkAppSecret();

    const res = await fetch(`${DINGTALK_API}/v1.0/oauth2/accessToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appKey, appSecret }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      this.logger.error(`Failed to get corp access token: ${errBody}`);
      throw new Error('Failed to get DingTalk corp access token');
    }

    const data: DingTalkCorpTokenResult = await res.json();
    const ttl = Math.max(data.expireIn - 300, 60);
    await this.redis.set(cacheKey, data.accessToken, 'EX', ttl);
    return data.accessToken;
  }

  /**
   * OAuth2 Web login: exchange authCode for user access token
   */
  async getUserAccessToken(authCode: string): Promise<DingTalkTokenResult> {
    const appKey = this.environmentService.getDingtalkAppKey();
    const appSecret = this.environmentService.getDingtalkAppSecret();

    const res = await fetch(`${DINGTALK_API}/v1.0/oauth2/userAccessToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientId: appKey,
        clientSecret: appSecret,
        code: authCode,
        grantType: 'authorization_code',
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      this.logger.error(`Failed to get user access token: ${errBody}`);
      throw new Error('DingTalk OAuth2 token exchange failed');
    }

    return res.json();
  }

  /**
   * Get user info using user access token (OAuth2 Web flow)
   */
  async getUserInfoByToken(userAccessToken: string): Promise<DingTalkUserInfo> {
    const res = await fetch(`${DINGTALK_API}/v1.0/contact/users/me`, {
      method: 'GET',
      headers: { 'x-acs-dingtalk-access-token': userAccessToken },
    });

    if (!res.ok) {
      const errBody = await res.text();
      this.logger.error(`Failed to get user info: ${errBody}`);
      throw new Error('Failed to get DingTalk user info');
    }

    return res.json();
  }

  /**
   * H5 silent login: exchange code for user identity
   */
  async getUserInfoByCode(code: string): Promise<DingTalkH5UserInfo> {
    const corpToken = await this.getCorpAccessToken();

    const res = await fetch(
      `${DINGTALK_OAPI}/topapi/v2/user/getuserinfo?access_token=${corpToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      },
    );

    if (!res.ok) {
      const errBody = await res.text();
      this.logger.error(`Failed to get H5 user info: ${errBody}`);
      throw new Error('DingTalk H5 login failed');
    }

    const data = await res.json();
    if (data.errcode !== 0) {
      this.logger.error(`DingTalk H5 error: ${data.errmsg}`);
      throw new Error(`DingTalk H5 error: ${data.errmsg}`);
    }

    return data.result;
  }

  /**
   * Get user detail by userid (for avatar, email, mobile etc.)
   */
  async getUserDetail(userid: string): Promise<DingTalkUserDetail> {
    const corpToken = await this.getCorpAccessToken();

    const res = await fetch(
      `${DINGTALK_OAPI}/topapi/v2/user/get?access_token=${corpToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userid }),
      },
    );

    if (!res.ok) {
      const errBody = await res.text();
      this.logger.error(`Failed to get user detail: ${errBody}`);
      throw new Error('Failed to get DingTalk user detail');
    }

    const data = await res.json();
    if (data.errcode !== 0) {
      this.logger.error(`DingTalk user detail error: ${data.errmsg}`);
      throw new Error(`DingTalk user detail error: ${data.errmsg}`);
    }

    return data.result;
  }
}
```

**第 3 步：承诺**

```bash
git add apps/server/src/ee/dingtalk/types/ apps/server/src/ee/dingtalk/dingtalk-api.service.ts
git commit -m "feat(dingtalk): add DingTalk types and API service with Redis token cache"
```

---

## 任务 4: 后端 — DingTalk Core Service

**文件：**
- 创建：`apps/server/src/ee/dingtalk/dingtalk.service.ts`

**第一步：创建钉钉服务**

核心逻辑：OAuth回调、H5登录、findOrCreateUser、出发处理、自动种子提供者。

参考：`apps/server/src/database/repos/group/group.repo.ts` 对应 `getDefaultGroup` / `createDefaultGroup`。
参考：`insertGroupUser` 的 `apps/server/src/database/repos/group/group-user.repo.ts`。

```typescript
// apps/server/src/ee/dingtalk/dingtalk.service.ts
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { DingTalkApiService } from './dingtalk-api.service';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { AuthAccountRepo } from '@docmost/db/repos/auth/auth-account.repo';
import { AuthProviderRepo } from '@docmost/db/repos/auth/auth-provider.repo';
import { TokenService } from '../../core/auth/services/token.service';
import { GroupUserRepo } from '@docmost/db/repos/group/group-user.repo';
import { GroupRepo } from '@docmost/db/repos/group/group.repo';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { InjectKysely } from 'nestjs-kysely';
import { executeTx } from '@docmost/db/utils';
import { User } from '@docmost/db/types/entity.types';
import { UserRole } from '../../common/helpers/types/permission';
import { nanoIdGen } from '../../common/helpers';
import { EnvironmentService } from '../../integrations/environment/environment.service';

@Injectable()
export class DingTalkService {
  private readonly logger = new Logger(DingTalkService.name);

  constructor(
    private dingTalkApiService: DingTalkApiService,
    private userRepo: UserRepo,
    private authAccountRepo: AuthAccountRepo,
    private authProviderRepo: AuthProviderRepo,
    private tokenService: TokenService,
    private groupUserRepo: GroupUserRepo,
    private groupRepo: GroupRepo,
    private environmentService: EnvironmentService,
    @InjectKysely() private readonly db: KyselyDB,
  ) {}

  /**
   * Handle OAuth2 web callback (QR code login)
   */
  async handleOAuthCallback(
    authCode: string,
    workspaceId: string,
  ): Promise<{ user: User; authToken: string }> {
    // 1. Exchange authCode for user access token
    const tokenResult =
      await this.dingTalkApiService.getUserAccessToken(authCode);

    // 2. Get user info using access token
    const userInfo = await this.dingTalkApiService.getUserInfoByToken(
      tokenResult.accessToken,
    );

    if (!userInfo.unionId) {
      throw new BadRequestException('Failed to get DingTalk unionId');
    }

    // 3. Find or create Docmost user
    const user = await this.findOrCreateUser(
      {
        unionId: userInfo.unionId,
        name: userInfo.nick,
        avatarUrl: userInfo.avatarUrl,
        email: userInfo.email,
        mobile: userInfo.mobile,
      },
      workspaceId,
    );

    // 4. Generate JWT
    const authToken = await this.tokenService.generateAccessToken(user);
    return { user, authToken };
  }

  /**
   * Handle H5 silent login (DingTalk workbench)
   */
  async handleH5Login(
    code: string,
    workspaceId: string,
  ): Promise<{ user: User; authToken: string }> {
    // 1. Exchange code for user identity
    const h5UserInfo = await this.dingTalkApiService.getUserInfoByCode(code);

    if (!h5UserInfo.unionid) {
      throw new BadRequestException('Failed to get DingTalk unionId from H5');
    }

    // 2. Get user detail for avatar etc.
    let userDetail;
    try {
      userDetail = await this.dingTalkApiService.getUserDetail(
        h5UserInfo.userid,
      );
    } catch (err: any) {
      this.logger.warn(
        `Failed to get user detail for ${h5UserInfo.userid}: ${err?.message}`,
      );
    }

    // 3. Find or create Docmost user
    const user = await this.findOrCreateUser(
      {
        unionId: h5UserInfo.unionid,
        name: userDetail?.name || h5UserInfo.name || h5UserInfo.userid,
        avatarUrl: userDetail?.avatar,
        email: userDetail?.email,
        mobile: userDetail?.mobile,
      },
      workspaceId,
    );

    // 4. Generate JWT
    const authToken = await this.tokenService.generateAccessToken(user);
    return { user, authToken };
  }

  /**
   * Find existing user by unionId or create new one
   */
  private async findOrCreateUser(
    info: {
      unionId: string;
      name: string;
      avatarUrl?: string;
      email?: string;
      mobile?: string;
    },
    workspaceId: string,
  ): Promise<User> {
    // 1. Ensure dingtalk auth provider exists
    await this.ensureProvider(workspaceId);

    // 2. Get dingtalk auth provider
    const provider = await this.authProviderRepo.findByType(
      'dingtalk',
      workspaceId,
    );
    if (!provider) {
      throw new BadRequestException('DingTalk SSO provider not configured');
    }

    // 3. Check existing binding
    const existingAccount = await this.authAccountRepo.findByProviderUserId(
      info.unionId,
      provider.id,
      workspaceId,
    );

    if (existingAccount) {
      // Update last login and basic info
      const user = await this.userRepo.findById(
        existingAccount.userId,
        workspaceId,
      );
      if (!user || user.deletedAt || user.deactivatedAt) {
        throw new BadRequestException('User account is disabled');
      }

      await this.userRepo.updateUser(
        {
          lastLoginAt: new Date(),
          ...(info.name && { name: info.name }),
          ...(info.avatarUrl && { avatarUrl: info.avatarUrl }),
        },
        user.id,
        workspaceId,
      );

      return { ...user, lastLoginAt: new Date() };
    }

    // 4. Create new user in transaction
    if (!provider.allowSignup) {
      throw new BadRequestException(
        'DingTalk signup is disabled for this workspace',
      );
    }

    return executeTx(this.db, async (trx) => {
      // Generate a placeholder email using unionId
      const email =
        info.email || `${info.unionId.substring(0, 16)}@dingtalk.local`;

      // Check if email already exists (possible if user was created manually)
      const existingUser = await this.userRepo.findByEmail(
        email,
        workspaceId,
      );
      if (existingUser) {
        // Bind existing user to dingtalk
        await this.authAccountRepo.insertAuthAccount(
          {
            userId: existingUser.id,
            providerUserId: info.unionId,
            authProviderId: provider.id,
            workspaceId,
          },
          trx,
        );
        await this.userRepo.updateLastLogin(existingUser.id, workspaceId);
        return existingUser;
      }

      // Create new user
      const randomPassword = nanoIdGen(32);
      const newUser = await this.userRepo.insertUser(
        {
          email,
          name: info.name,
          password: randomPassword,
          avatarUrl: info.avatarUrl || '',
          role: UserRole.MEMBER,
          workspaceId,
          hasGeneratedPassword: true,
          lastLoginAt: new Date(),
        },
        trx,
      );

      // Create auth account binding
      await this.authAccountRepo.insertAuthAccount(
        {
          userId: newUser.id,
          providerUserId: info.unionId,
          authProviderId: provider.id,
          workspaceId,
        },
        trx,
      );

      // Ensure default group exists, then add user to it
      let defaultGroup = await this.groupRepo.getDefaultGroup(
        workspaceId,
        trx,
      );
      if (!defaultGroup) {
        defaultGroup = await this.groupRepo.createDefaultGroup(workspaceId, {
          userId: newUser.id,
          trx,
        });
      }
      await this.groupUserRepo.insertGroupUser(
        { userId: newUser.id, groupId: defaultGroup.id },
        trx,
      );

      this.logger.log(
        `Created new user ${newUser.id} from DingTalk unionId ${info.unionId}`,
      );

      return newUser;
    });
  }

  /**
   * Handle employee departure event from DingTalk
   */
  async handleUserLeave(
    userIds: string[],
    workspaceId: string,
  ): Promise<void> {
    for (const dingtalkUserId of userIds) {
      try {
        // Try to get unionId from DingTalk API
        let unionId: string;
        try {
          const detail =
            await this.dingTalkApiService.getUserDetail(dingtalkUserId);
          unionId = detail.unionid;
        } catch {
          this.logger.warn(
            `Cannot get unionId for departed user ${dingtalkUserId}, skipping`,
          );
          continue;
        }

        const provider = await this.authProviderRepo.findByType(
          'dingtalk',
          workspaceId,
        );
        if (!provider) continue;

        const account = await this.authAccountRepo.findByProviderUserId(
          unionId,
          provider.id,
          workspaceId,
        );
        if (!account) continue;

        // Deactivate user (documents preserved via creator_id reference)
        await this.userRepo.updateUser(
          { deactivatedAt: new Date() },
          account.userId,
          workspaceId,
        );

        this.logger.log(
          `Deactivated user ${account.userId} due to DingTalk departure`,
        );
      } catch (err: any) {
        this.logger.error(
          `Failed to handle departure for ${dingtalkUserId}: ${err?.message}`,
        );
      }
    }
  }

  /**
   * Auto-create dingtalk auth_provider from env vars if not exists
   */
  private async ensureProvider(workspaceId: string): Promise<void> {
    const existing = await this.authProviderRepo.findByType(
      'dingtalk',
      workspaceId,
    );
    if (existing) return;

    const corpId = this.environmentService.getDingtalkCorpId();
    const appKey = this.environmentService.getDingtalkAppKey();
    const appSecret = this.environmentService.getDingtalkAppSecret();
    const agentId = this.environmentService.getDingtalkAgentId();

    if (!corpId || !appKey || !appSecret) {
      this.logger.warn(
        'DingTalk env vars not configured, skipping provider auto-creation',
      );
      return;
    }

    await this.authProviderRepo.upsertDingtalkProvider(workspaceId, {
      corpId,
      appKey,
      appSecret,
      agentId,
    });

    this.logger.log(
      `Auto-created DingTalk auth provider for workspace ${workspaceId}`,
    );
  }
}
```

**第 2 步：承诺**

```bash
git add apps/server/src/ee/dingtalk/dingtalk.service.ts
git commit -m "feat(dingtalk): add core service with user find/create/bind and departure handling"
```

---

## 任务 5: 后端 — DingTalk Controller, DTOs & Module Registration

**文件：**
- 创建：`apps/server/src/ee/dingtalk/dto/dingtalk.dto.ts`
- 创建：`apps/server/src/ee/dingtalk/dingtalk.controller.ts`
- 创建：`apps/server/src/ee/dingtalk/dingtalk.module.ts`
- 修改：`apps/server/src/ee/ee.module.ts`

**第 1 步：创建 DTO**

```typescript
// apps/server/src/ee/dingtalk/dto/dingtalk.dto.ts
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class DingTalkCallbackDto {
  @IsNotEmpty()
  @IsString()
  authCode: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  redirectUrl?: string;
}

export class DingTalkH5LoginDto {
  @IsNotEmpty()
  @IsString()
  code: string;
}
```

**第二步：创建钉钉控制器**

```typescript
// apps/server/src/ee/dingtalk/dingtalk.controller.ts
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { DingTalkService } from './dingtalk.service';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { AuthProviderRepo } from '@docmost/db/repos/auth/auth-provider.repo';
import { Public } from '../../common/decorators/public.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { DingTalkCallbackDto, DingTalkH5LoginDto } from './dto/dingtalk.dto';

@Controller('auth/dingtalk')
export class DingTalkController {
  private readonly logger = new Logger(DingTalkController.name);

  constructor(
    private dingTalkService: DingTalkService,
    private environmentService: EnvironmentService,
    private authProviderRepo: AuthProviderRepo,
  ) {}

  /**
   * Get DingTalk config for frontend (corpId, appKey — no secrets)
   */
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('config')
  async getConfig(@AuthWorkspace() workspace: Workspace) {
    const provider = await this.authProviderRepo.findByType(
      'dingtalk',
      workspace.id,
    );

    if (provider) {
      const settings = provider.settings as any;
      return {
        enabled: true,
        corpId:
          settings?.corpId || this.environmentService.getDingtalkCorpId(),
        appKey:
          settings?.appKey || this.environmentService.getDingtalkAppKey(),
        agentId:
          settings?.agentId || this.environmentService.getDingtalkAgentId(),
      };
    }

    // Fallback to env vars when no DB record exists yet
    const corpId = this.environmentService.getDingtalkCorpId();
    const appKey = this.environmentService.getDingtalkAppKey();
    if (corpId && appKey) {
      return {
        enabled: true,
        corpId,
        appKey,
        agentId: this.environmentService.getDingtalkAgentId(),
      };
    }

    return { enabled: false };
  }

  /**
   * OAuth2 web callback — exchange authCode for JWT
   */
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('callback')
  async handleCallback(
    @Body() dto: DingTalkCallbackDto,
    @AuthWorkspace() workspace: Workspace,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const { user, authToken } = await this.dingTalkService.handleOAuthCallback(
      dto.authCode,
      workspace.id,
    );

    this.setAuthCookie(res, authToken);

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        role: user.role,
      },
    };
  }

  /**
   * H5 silent login — exchange code for JWT
   */
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('h5-login')
  async handleH5Login(
    @Body() dto: DingTalkH5LoginDto,
    @AuthWorkspace() workspace: Workspace,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const { user, authToken } = await this.dingTalkService.handleH5Login(
      dto.code,
      workspace.id,
    );

    this.setAuthCookie(res, authToken);

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        role: user.role,
      },
    };
  }

  /**
   * Get current authenticated user info (for wiki frontend)
   */
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('user-info')
  async getUserInfo(@AuthUser() user: User) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      avatarUrl: user.avatarUrl,
      role: user.role,
    };
  }

  /**
   * DingTalk event subscription callback (employee departure etc.)
   */
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('event')
  async handleEvent(
    @Body() body: any,
    @AuthWorkspace() workspace: Workspace,
  ) {
    if (body?.EventType === 'check_url') {
      return { msg_signature: '', timeStamp: '', nonce: '', encrypt: '' };
    }

    if (body?.EventType === 'user_leave_org' && body?.UserId) {
      const userIds = Array.isArray(body.UserId)
        ? body.UserId
        : [body.UserId];
      await this.dingTalkService.handleUserLeave(userIds, workspace.id);
    }

    return { success: true };
  }

  private setAuthCookie(res: FastifyReply, token: string) {
    const cookieOpts: any = {
      httpOnly: true,
      path: '/',
      expires: this.environmentService.getCookieExpiresIn(),
      secure: this.environmentService.isHttps(),
      sameSite: 'lax',
    };
    const domain = this.environmentService.getCookieDomain();
    if (domain) {
      cookieOpts.domain = domain;
    }
    res.setCookie('authToken', token, cookieOpts);
  }
}
```

**第三步：创建钉钉模块**

```typescript
// apps/server/src/ee/dingtalk/dingtalk.module.ts
import { Module } from '@nestjs/common';
import { DingTalkController } from './dingtalk.controller';
import { DingTalkService } from './dingtalk.service';
import { DingTalkApiService } from './dingtalk-api.service';
import { TokenModule } from '../../core/auth/token.module';

@Module({
  imports: [TokenModule],
  controllers: [DingTalkController],
  providers: [DingTalkService, DingTalkApiService],
  exports: [DingTalkService],
})
export class DingTalkModule {}
```

**第四步：在EeModule中注册DingTalkModule**

在`apps/server/src/ee/ee.module.ts`中，添加导入并注册：

```typescript
import { DingTalkModule } from './dingtalk/dingtalk.module';

@Module({
  imports: [LicenseModule, ApiKeyModule, MfaModule, AiModule, DingTalkModule],
})
export class EeModule {}
```

**第 5 步：承诺**

```bash
git add apps/server/src/ee/dingtalk/ apps/server/src/ee/ee.module.ts
git commit -m "feat(dingtalk): add controller, DTOs, module and register in EE"
```

---

## 任务 6: Docmost 前端 — 401 Redirect to Wiki Login

**文件：**
- 修改：`apps/client/src/lib/api-client.ts`

**第 1 步：在 401 上添加 wiki 重定向**

在axios响应拦截器中找到现有的401处理。添加 wiki 重定向逻辑。查找检查 `status === 401` 或处理未经授权的错误的块：

```typescript
// Add this logic in the 401 handler, BEFORE the existing redirect to /login:
const wikiUrl = import.meta.env.VITE_WIKI_URL;
if (wikiUrl) {
  window.location.href = `${wikiUrl}/login?redirect=${encodeURIComponent(window.location.href)}`;
  return Promise.reject(error);
}
```

**第 2 步：承诺**

```bash
git add apps/client/src/lib/api-client.ts
git commit -m "feat: redirect to wiki login on 401 when WIKI_URL configured"
```

---

## 任务 7: Wiki 前端 — Auth Types & Service

**文件：**
- 创建：`wiki/docs/.vitepress/theme/types/auth.ts`
- 创建：`wiki/docs/.vitepress/theme/services/auth.ts`

**第 1 步：创建身份验证类型**

```typescript
// wiki/docs/.vitepress/theme/types/auth.ts
export interface AuthUser {
  id: string
  name: string
  email: string
  avatarUrl?: string
  role: 'owner' | 'admin' | 'member'
}

export interface DingTalkConfig {
  enabled: boolean
  corpId?: string
  appKey?: string
  agentId?: string
}

export interface AuthResult {
  user: AuthUser
}
```

**第 2 步：创建AuthService**

重要提示：来自 Docmost 的 API 响应由 `TransformHttpResponseInterceptor` 包装，因此响应具有 `{ data: ... }` 结构。必须提取`.data`。

```typescript
// wiki/docs/.vitepress/theme/services/auth.ts
import type { AuthUser, DingTalkConfig, AuthResult } from '../types/auth'

export class AuthService {
  private baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  private async post<T>(endpoint: string, body: Record<string, any> = {}): Promise<T> {
    const response = await fetch(`${this.baseUrl}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err.message || `Auth API error: ${response.status}`)
    }

    const json = await response.json()
    // TransformHttpResponseInterceptor wraps in { data: ... }
    return json.data !== undefined ? json.data : json
  }

  async getDingTalkConfig(): Promise<DingTalkConfig> {
    return this.post<DingTalkConfig>('auth/dingtalk/config')
  }

  async dingtalkCallback(authCode: string): Promise<AuthResult> {
    return this.post<AuthResult>('auth/dingtalk/callback', { authCode })
  }

  async dingtalkH5Login(code: string): Promise<AuthResult> {
    return this.post<AuthResult>('auth/dingtalk/h5-login', { code })
  }

  async getUserInfo(): Promise<AuthUser> {
    return this.post<AuthUser>('auth/dingtalk/user-info')
  }

  async logout(): Promise<void> {
    await this.post('auth/logout')
  }
}

let authServiceInstance: AuthService | null = null

export function getAuthService(): AuthService | null {
  if (authServiceInstance) return authServiceInstance

  const docmostApiUrl = import.meta.env.VITE_DOCMOST_API_URL as string
  if (!docmostApiUrl) return null

  // Strip /public-wiki suffix to get base API URL
  const baseUrl = docmostApiUrl.replace(/\/public-wiki\/?$/, '')
  authServiceInstance = new AuthService(baseUrl)
  return authServiceInstance
}
```

**第 3 步：承诺**

```bash
git add wiki/docs/.vitepress/theme/types/auth.ts wiki/docs/.vitepress/theme/services/auth.ts
git commit -m "feat(wiki): add auth types and API service"
```

---

## 任务 8: Wiki 前端 — useAuth Composable

**文件：**
- 创建：`wiki/docs/.vitepress/theme/composables/useAuth.ts`

**步骤 1：创建 useAuth 可组合项**

跨组件共享状态的模块级引用。

```typescript
// wiki/docs/.vitepress/theme/composables/useAuth.ts
import { ref, computed } from 'vue'
import type { AuthUser, DingTalkConfig } from '../types/auth'
import { getAuthService } from '../services/auth'

const currentUser = ref<AuthUser | null>(null)
const dingtalkConfig = ref<DingTalkConfig | null>(null)
const isLoading = ref(false)
const isInitialized = ref(false)

function hasCookie(name: string): boolean {
  if (typeof document === 'undefined') return false
  return document.cookie.split(';').some((c) => c.trim().startsWith(`${name}=`))
}

function isInDingTalk(): boolean {
  if (typeof navigator === 'undefined') return false
  return /DingTalk/i.test(navigator.userAgent)
}

export function useAuth() {
  const isAuthenticated = computed(() => !!currentUser.value)
  const isAdmin = computed(
    () => currentUser.value?.role === 'admin' || currentUser.value?.role === 'owner',
  )

  async function loadDingTalkConfig(): Promise<DingTalkConfig | null> {
    if (dingtalkConfig.value) return dingtalkConfig.value
    const authService = getAuthService()
    if (!authService) return null
    try {
      dingtalkConfig.value = await authService.getDingTalkConfig()
      return dingtalkConfig.value
    } catch (err) {
      console.warn('[Auth] Failed to load DingTalk config:', err)
      return null
    }
  }

  async function fetchUserInfo(): Promise<boolean> {
    const authService = getAuthService()
    if (!authService) return false
    try {
      currentUser.value = await authService.getUserInfo()
      return true
    } catch {
      currentUser.value = null
      return false
    }
  }

  async function initAuth(): Promise<void> {
    if (isInitialized.value) return
    isLoading.value = true
    try {
      if (hasCookie('authToken')) {
        await fetchUserInfo()
      }
    } finally {
      isLoading.value = false
      isInitialized.value = true
    }
  }

  async function loginWithDingTalkCode(authCode: string): Promise<boolean> {
    const authService = getAuthService()
    if (!authService) return false
    try {
      isLoading.value = true
      const result = await authService.dingtalkCallback(authCode)
      currentUser.value = result.user
      return true
    } catch (err) {
      console.error('[Auth] DingTalk callback failed:', err)
      return false
    } finally {
      isLoading.value = false
    }
  }

  async function loginWithH5Code(code: string): Promise<boolean> {
    const authService = getAuthService()
    if (!authService) return false
    try {
      isLoading.value = true
      const result = await authService.dingtalkH5Login(code)
      currentUser.value = result.user
      return true
    } catch (err) {
      console.error('[Auth] H5 login failed:', err)
      return false
    } finally {
      isLoading.value = false
    }
  }

  async function logout(): Promise<void> {
    const authService = getAuthService()
    if (authService) {
      try {
        await authService.logout()
      } catch {
        // ignore logout errors
      }
    }
    currentUser.value = null
    if (typeof document !== 'undefined') {
      document.cookie = 'authToken=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;'
    }
  }

  return {
    currentUser,
    isAuthenticated,
    isAdmin,
    isLoading,
    isInitialized,
    dingtalkConfig,
    initAuth,
    loadDingTalkConfig,
    fetchUserInfo,
    loginWithDingTalkCode,
    loginWithH5Code,
    logout,
    isInDingTalk,
    hasCookie,
  }
}
```

**第 2 步：承诺**

```bash
git add wiki/docs/.vitepress/theme/composables/useAuth.ts
git commit -m "feat(wiki): add useAuth composable for authentication state"
```

---

## 任务 9: Wiki 前端 — Login Page & Callback Page

**文件：**
- 创建：`wiki/docs/.vitepress/theme/pages/LoginPage.vue`
- 创建：`wiki/docs/.vitepress/theme/pages/LoginCallback.vue`
- 运行： `cd wiki && pnpm add dingtalk-jsapi`

**第一步：安装dingtalk-jsapi依赖**

```bash
cd wiki && pnpm add dingtalk-jsapi
```

**第 2 步：创建LoginPage.vue**

参考现有的 wiki 设计系统（维基主题中的 CSS 变量，如 `--c-bg`、`--c-text-1`、`--c-border` 等）。

编写完整的LoginPage.vue内容：网页版带有钉钉按钮的登录卡、钉钉客户端自动H5静默登录。从设计文档的任务 9 规范的 `feater-dingding-user:docs/plans/2026-03-01-dingtalk-sso-impl-plan.md` 第 1220-1480 行中复制完整组件，但使用 wiki 的 CSS 变量（`--c-bg`、`--c-text-1`、`--c-text-2`、`--c-border`、`--c-hover`）而不是 `--vp-c-*` 变量。

**第 3 步：创建LoginCallback.vue**

编写完整的 LoginCallback.vue 内容：从 URL 参数读取 `authCode` 和 `state`，调用 `loginWithDingTalkCode`，成功时重定向。复制旧计划的 任务 9 LoginCallback.vue 规范，调整 CSS 变量以适应 wiki 主题。

**第 4 步：承诺**

```bash
git add wiki/docs/.vitepress/theme/pages/ wiki/package.json wiki/pnpm-lock.yaml
git commit -m "feat(wiki): add login page and callback page with DingTalk integration"
```

---

## 任务 10: Wiki 前端 — UserMenu Component

**文件：**
- 创建：`wiki/docs/.vitepress/theme/components/UserMenu.vue`

**第 1 步：创建UserMenu组件**

用户头像下拉菜单包括：用户名/电子邮件显示、“后台管理”链接（仅限管理员）、“退出登录”按钮。使用 `useAuth` 可组合项。 `VITE_ADMIN_URL` 管理链接的环境变量。

编写完整的 UserMenu.vue 组件。请参考旧计划的 任务 10 UserMenu 规范。使用基于悬停的下拉菜单 (`.user-menu:hover .user-dropdown { display: block }`)。

**第 2 步：承诺**

```bash
git add wiki/docs/.vitepress/theme/components/UserMenu.vue
git commit -m "feat(wiki): add UserMenu component with admin link and logout"
```

---

## 任务 11: Wiki 前端 — Route Integration & Auth Guard

**文件：**
- 修改：`wiki/docs/.vitepress/theme/index.ts`（`enhanceApp` + `router.onBeforePageLoad`）
- 修改：`wiki/docs/.vitepress/theme/components/NavBar.vue`（用 UserMenu 替换登录链接）
- 修改：`wiki/docs/.vitepress/theme/Layout.vue`（添加auth初始化）

**第 1 步：修改index.ts — 添加登录路由和身份验证防护**

在现有的 `router.onBeforePageLoad` 处理程序中，在现有 Docmost 路由检查之前添加：

1.登录页面路由：如果path为`/login`→渲染LoginPage组件，返回false
2.登录回调路由：如果路径以`/login/callback`开头→渲染LoginCallback，返回false
3. Auth guard: if no `authToken` cookie and path is not `/` → redirect to `/login?redirect=...`, return false

在顶部添加导入：
```typescript
import LoginPage from './pages/LoginPage.vue'
import LoginCallback from './pages/LoginCallback.vue'
```

**第 2 步：修改 NavBar.vue — 将登录链接替换为 UserMenu**

在 NavBar.vue 中找到现有的登录按钮 `<a href="/login" class="login-button">登录</a>` 并替换为：

```vue
<UserMenu />
```

添加导入：
```typescript
import UserMenu from './UserMenu.vue'
```

如果 UserMenu 显示登录状态，则保留登录按钮 CSS 以供后备。

**第 3 步：修改Layout.vue——初始化auth**

在Layout.vue的`<script setup>`中，添加：

```typescript
import { onMounted } from 'vue'
import { useAuth } from '../composables/useAuth'
const { initAuth } = useAuth()
onMounted(() => { initAuth() })
```

**第 4 步：承诺**

```bash
git add wiki/docs/.vitepress/theme/index.ts wiki/docs/.vitepress/theme/components/NavBar.vue wiki/docs/.vitepress/theme/Layout.vue
git commit -m "feat(wiki): add auth guard, login routes, and UserMenu integration"
```

---

## 任务 12: 验证 Backend Compilation

**第 1 步：运行 TypeScript 编译检查**

```bash
cd apps/server && npx tsc --noEmit
```

修复所有编译错误。

**步骤 2：验证服务器启动**

```bash
pnpm dev
```

检查控制台：
- 无钉钉模块注册错误
- 服务器在端口 3000 上启动
- 没有缺失依赖错误

**第 3 步：提交任何修复**

```bash
git add -A
git commit -m "fix: resolve compilation issues from dingtalk integration"
```

---

## 任务 13: 验证 Wiki Frontend

**第 1 步：运行 wiki 开发服务器**

```bash
cd wiki && pnpm docs:dev
```

Check:
- 没有构建错误
- 登录页面呈现在 `/login`
- 身份验证守卫重定向未经身份验证的用户

**第 2 步：提交任何修复**

```bash
git add -A
git commit -m "fix: resolve wiki frontend issues from dingtalk integration"
```

---

## 所有文件的摘要

### 新文件 (12)
| # | 路径 | 用途 |
|---|------|---------|
| 1 | `apps/server/src/database/repos/auth/auth-account.repo.ts` | AuthAccount 存储库 |
| 2 | `apps/server/src/database/repos/auth/auth-provider.repo.ts` | AuthProvider 存储库 |
| 3 | `apps/server/src/ee/dingtalk/types/dingtalk.types.ts` | 钉钉TypeScript类型 |
| 4 | `apps/server/src/ee/dingtalk/dingtalk-api.service.ts` | 钉钉HTTP API封装+Redis缓存 |
| 5 | `apps/server/src/ee/dingtalk/dingtalk.service.ts` | 核心业务逻辑 |
| 6 | `apps/server/src/ee/dingtalk/dto/dingtalk.dto.ts` | 请求 DTO |
| 7 | `apps/server/src/ee/dingtalk/dingtalk.controller.ts` | API端点 |
| 8 | `apps/server/src/ee/dingtalk/dingtalk.module.ts` | NestJS模块 |
| 9 | `wiki/docs/.vitepress/theme/types/auth.ts` | 身份验证类型 |
| 10 | `wiki/docs/.vitepress/theme/services/auth.ts` | 认证API服务 |
| 11 | `wiki/docs/.vitepress/theme/composables/useAuth.ts` | Auth 状态可组合 |
| 12 | `wiki/docs/.vitepress/theme/pages/LoginPage.vue` | 登录页面 |
| 13 | `wiki/docs/.vitepress/theme/pages/LoginCallback.vue` | OAuth回调页面 |
| 14 | `wiki/docs/.vitepress/theme/components/UserMenu.vue` | 用户头像下拉菜单 |

### 修改文件 (7)
| # | 路径 | 变更 |
|---|------|---------|
| 1 | `apps/server/src/integrations/environment/environment.service.ts` | 添加钉钉+cookie域名getters |
| 2 | `apps/server/src/core/auth/auth.controller.ts` | 将 cookie 域添加到 setAuthCookie |
| 3 | `apps/server/src/main.ts` | 将钉钉添加到排除路径 |
| 4 | `apps/server/src/database/database.module.ts` | 注册授权仓库 |
| 5 | `apps/server/src/ee/ee.module.ts` | 注册钉钉模块 |
| 6 | `apps/client/src/lib/api-client.ts` | 401 → 维基登录重定向 |
| 7 | `wiki/docs/.vitepress/theme/index.ts` | 添加登录路由+身份验证守卫 |
| 8 | `wiki/docs/.vitepress/theme/components/NavBar.vue` | 将登录链接替换为 UserMenu |
| 9 | `wiki/docs/.vitepress/theme/Layout.vue` | 挂载时初始化身份验证 |
| 10 | `.env.example` | 添加钉钉环境变量 |
