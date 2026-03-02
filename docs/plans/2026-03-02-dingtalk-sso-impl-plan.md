# DingTalk SSO Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate DingTalk authentication into Wiki (VitePress) and Docmost (NestJS), enabling web QR login, H5 silent login, cross-subdomain SSO, and automatic employee departure handling.

**Architecture:** Wiki-led authentication on shared `.example.com` cookie domain. Docmost backend handles all DingTalk API interactions. Wiki frontend provides login UI. Reuse existing `auth_providers` + `auth_accounts` SSO framework — no new database tables or migrations needed. DingTalk provider record auto-seeded from env vars at runtime.

**Tech Stack:** NestJS 11 + Fastify (backend), VitePress 2 + Vue 3 (wiki frontend), DingTalk OAuth2 + JSAPI, Redis via `@nestjs-labs/nestjs-ioredis` (token cache), Kysely (DB)

**Reference Branch:** `feater-dingding-user` — first implementation with known bugs. This plan rewrites cleanly on `feater-dingding-user2`.

---

## Task 1: Backend — Environment Variables & Cookie Domain Support

**Files:**
- Modify: `apps/server/src/integrations/environment/environment.service.ts`
- Modify: `apps/server/src/core/auth/auth.controller.ts` (setAuthCookie method, ~line 176)
- Modify: `apps/server/src/main.ts` (excludedPaths array, ~line 72)
- Modify: `.env.example`

**Step 1: Add environment getters to EnvironmentService**

Open `apps/server/src/integrations/environment/environment.service.ts`. Add these methods after the last method in the class:

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

**Step 2: Modify setAuthCookie for cross-subdomain support**

In `apps/server/src/core/auth/auth.controller.ts`, find the `setAuthCookie` method and replace it with:

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

**Step 3: Add dingtalk routes to excluded paths in main.ts**

In `apps/server/src/main.ts`, find the `excludedPaths` array in the preHandler hook and add:

```typescript
'/api/auth/dingtalk',
```

**Step 4: Update .env.example**

Append to `.env.example`:

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

**Step 5: Commit**

```bash
git add apps/server/src/integrations/environment/environment.service.ts apps/server/src/core/auth/auth.controller.ts apps/server/src/main.ts .env.example
git commit -m "feat(auth): add cookie domain support and dingtalk env config"
```

---

## Task 2: Backend — AuthAccount & AuthProvider Repositories

**Files:**
- Create: `apps/server/src/database/repos/auth/auth-account.repo.ts`
- Create: `apps/server/src/database/repos/auth/auth-provider.repo.ts`
- Modify: `apps/server/src/database/database.module.ts`

**Step 1: Create AuthAccountRepo**

Reference pattern: `apps/server/src/database/repos/user/user.repo.ts` for injection style.

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

**Step 2: Create AuthProviderRepo**

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

**Step 3: Register repos in DatabaseModule**

In `apps/server/src/database/database.module.ts`:
- Add imports at the top:

```typescript
import { AuthAccountRepo } from './repos/auth/auth-account.repo';
import { AuthProviderRepo } from './repos/auth/auth-provider.repo';
```

- Add `AuthAccountRepo, AuthProviderRepo` to both the `providers` and `exports` arrays.

**Step 4: Commit**

```bash
git add apps/server/src/database/repos/auth/ apps/server/src/database/database.module.ts
git commit -m "feat(db): add AuthAccount and AuthProvider repositories"
```

---

## Task 3: Backend — DingTalk Types & API Service

**Files:**
- Create: `apps/server/src/ee/dingtalk/types/dingtalk.types.ts`
- Create: `apps/server/src/ee/dingtalk/dingtalk-api.service.ts`

**Step 1: Create DingTalk types**

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

**Step 2: Create DingTalkApiService**

Key difference from old branch: use `RedisService` from `@nestjs-labs/nestjs-ioredis` with `getOrThrow()` pattern (matches `apps/server/src/collaboration/services/collab-history.service.ts`).

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

**Step 3: Commit**

```bash
git add apps/server/src/ee/dingtalk/types/ apps/server/src/ee/dingtalk/dingtalk-api.service.ts
git commit -m "feat(dingtalk): add DingTalk types and API service with Redis token cache"
```

---

## Task 4: Backend — DingTalk Core Service

**Files:**
- Create: `apps/server/src/ee/dingtalk/dingtalk.service.ts`

**Step 1: Create DingTalkService**

Core logic: OAuth callback, H5 login, findOrCreateUser, departure handling, auto-seed provider.

Reference: `apps/server/src/database/repos/group/group.repo.ts` for `getDefaultGroup` / `createDefaultGroup`.
Reference: `apps/server/src/database/repos/group/group-user.repo.ts` for `insertGroupUser`.

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

**Step 2: Commit**

```bash
git add apps/server/src/ee/dingtalk/dingtalk.service.ts
git commit -m "feat(dingtalk): add core service with user find/create/bind and departure handling"
```

---

## Task 5: Backend — DingTalk Controller, DTOs & Module Registration

**Files:**
- Create: `apps/server/src/ee/dingtalk/dto/dingtalk.dto.ts`
- Create: `apps/server/src/ee/dingtalk/dingtalk.controller.ts`
- Create: `apps/server/src/ee/dingtalk/dingtalk.module.ts`
- Modify: `apps/server/src/ee/ee.module.ts`

**Step 1: Create DTOs**

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

**Step 2: Create DingTalkController**

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

**Step 3: Create DingTalkModule**

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

**Step 4: Register DingTalkModule in EeModule**

In `apps/server/src/ee/ee.module.ts`, add import and register:

```typescript
import { DingTalkModule } from './dingtalk/dingtalk.module';

@Module({
  imports: [LicenseModule, ApiKeyModule, MfaModule, AiModule, DingTalkModule],
})
export class EeModule {}
```

**Step 5: Commit**

```bash
git add apps/server/src/ee/dingtalk/ apps/server/src/ee/ee.module.ts
git commit -m "feat(dingtalk): add controller, DTOs, module and register in EE"
```

---

## Task 6: Docmost Frontend — 401 Redirect to Wiki Login

**Files:**
- Modify: `apps/client/src/lib/api-client.ts`

**Step 1: Add wiki redirect on 401**

Find the existing 401 handling in the axios response interceptor. Add wiki redirect logic. Look for the block that checks `status === 401` or handles unauthorized errors:

```typescript
// Add this logic in the 401 handler, BEFORE the existing redirect to /login:
const wikiUrl = import.meta.env.VITE_WIKI_URL;
if (wikiUrl) {
  window.location.href = `${wikiUrl}/login?redirect=${encodeURIComponent(window.location.href)}`;
  return Promise.reject(error);
}
```

**Step 2: Commit**

```bash
git add apps/client/src/lib/api-client.ts
git commit -m "feat: redirect to wiki login on 401 when WIKI_URL configured"
```

---

## Task 7: Wiki Frontend — Auth Types & Service

**Files:**
- Create: `wiki/docs/.vitepress/theme/types/auth.ts`
- Create: `wiki/docs/.vitepress/theme/services/auth.ts`

**Step 1: Create auth types**

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

**Step 2: Create AuthService**

Important: API responses from Docmost are wrapped by `TransformHttpResponseInterceptor`, so response has `{ data: ... }` structure. Must extract `.data`.

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

**Step 3: Commit**

```bash
git add wiki/docs/.vitepress/theme/types/auth.ts wiki/docs/.vitepress/theme/services/auth.ts
git commit -m "feat(wiki): add auth types and API service"
```

---

## Task 8: Wiki Frontend — useAuth Composable

**Files:**
- Create: `wiki/docs/.vitepress/theme/composables/useAuth.ts`

**Step 1: Create useAuth composable**

Module-level refs for shared state across components.

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

**Step 2: Commit**

```bash
git add wiki/docs/.vitepress/theme/composables/useAuth.ts
git commit -m "feat(wiki): add useAuth composable for authentication state"
```

---

## Task 9: Wiki Frontend — Login Page & Callback Page

**Files:**
- Create: `wiki/docs/.vitepress/theme/pages/LoginPage.vue`
- Create: `wiki/docs/.vitepress/theme/pages/LoginCallback.vue`
- Run: `cd wiki && pnpm add dingtalk-jsapi`

**Step 1: Install dingtalk-jsapi dependency**

```bash
cd wiki && pnpm add dingtalk-jsapi
```

**Step 2: Create LoginPage.vue**

Reference the existing wiki design system (CSS variables like `--c-bg`, `--c-text-1`, `--c-border` etc. from the wiki theme).

Write the full LoginPage.vue content: login card with DingTalk button for web, auto H5 silent login in DingTalk client. Copy the complete component from the design document's Task 9 specification in `feater-dingding-user:docs/plans/2026-03-01-dingtalk-sso-impl-plan.md` lines 1220-1480, but use wiki's CSS variables (`--c-bg`, `--c-text-1`, `--c-text-2`, `--c-border`, `--c-hover`) instead of `--vp-c-*` variables.

**Step 3: Create LoginCallback.vue**

Write the full LoginCallback.vue content: reads `authCode` and `state` from URL params, calls `loginWithDingTalkCode`, redirects on success. Copy from the old plan's Task 9 LoginCallback.vue specification, adapting CSS variables to wiki theme.

**Step 4: Commit**

```bash
git add wiki/docs/.vitepress/theme/pages/ wiki/package.json wiki/pnpm-lock.yaml
git commit -m "feat(wiki): add login page and callback page with DingTalk integration"
```

---

## Task 10: Wiki Frontend — UserMenu Component

**Files:**
- Create: `wiki/docs/.vitepress/theme/components/UserMenu.vue`

**Step 1: Create UserMenu component**

User avatar dropdown with: user name/email display, "后台管理" link (admin only), "退出登录" button. Uses `useAuth` composable. `VITE_ADMIN_URL` env var for admin link.

Write the full UserMenu.vue component. Reference the old plan's Task 10 UserMenu specification. Use hover-based dropdown (`.user-menu:hover .user-dropdown { display: block }`).

**Step 2: Commit**

```bash
git add wiki/docs/.vitepress/theme/components/UserMenu.vue
git commit -m "feat(wiki): add UserMenu component with admin link and logout"
```

---

## Task 11: Wiki Frontend — Route Integration & Auth Guard

**Files:**
- Modify: `wiki/docs/.vitepress/theme/index.ts` (the `enhanceApp` + `router.onBeforePageLoad`)
- Modify: `wiki/docs/.vitepress/theme/components/NavBar.vue` (replace login link with UserMenu)
- Modify: `wiki/docs/.vitepress/theme/Layout.vue` (add auth initialization)

**Step 1: Modify index.ts — add login routes and auth guard**

In the existing `router.onBeforePageLoad` handler, add BEFORE the existing Docmost route check:

1. Login page route: if path is `/login` → render LoginPage component, return false
2. Login callback route: if path starts with `/login/callback` → render LoginCallback, return false
3. Auth guard: if no `authToken` cookie and path is not `/` → redirect to `/login?redirect=...`, return false

Add imports at top:
```typescript
import LoginPage from './pages/LoginPage.vue'
import LoginCallback from './pages/LoginCallback.vue'
```

**Step 2: Modify NavBar.vue — replace login link with UserMenu**

Find the existing login button `<a href="/login" class="login-button">登录</a>` in NavBar.vue and replace with:

```vue
<UserMenu />
```

Add import:
```typescript
import UserMenu from './UserMenu.vue'
```

Keep the login-button CSS for fallback if UserMenu shows login state.

**Step 3: Modify Layout.vue — initialize auth**

In Layout.vue's `<script setup>`, add:

```typescript
import { onMounted } from 'vue'
import { useAuth } from '../composables/useAuth'
const { initAuth } = useAuth()
onMounted(() => { initAuth() })
```

**Step 4: Commit**

```bash
git add wiki/docs/.vitepress/theme/index.ts wiki/docs/.vitepress/theme/components/NavBar.vue wiki/docs/.vitepress/theme/Layout.vue
git commit -m "feat(wiki): add auth guard, login routes, and UserMenu integration"
```

---

## Task 12: Verify Backend Compilation

**Step 1: Run TypeScript compilation check**

```bash
cd apps/server && npx tsc --noEmit
```

Fix any compilation errors.

**Step 2: Verify the server starts**

```bash
pnpm dev
```

Check console for:
- No DingTalk module registration errors
- Server starts on port 3000
- No missing dependency errors

**Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve compilation issues from dingtalk integration"
```

---

## Task 13: Verify Wiki Frontend

**Step 1: Run wiki dev server**

```bash
cd wiki && pnpm docs:dev
```

Check:
- No build errors
- Login page renders at `/login`
- Auth guard redirects unauthenticated users

**Step 2: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve wiki frontend issues from dingtalk integration"
```

---

## Summary of All Files

### New Files (12)
| # | Path | Purpose |
|---|------|---------|
| 1 | `apps/server/src/database/repos/auth/auth-account.repo.ts` | AuthAccount repository |
| 2 | `apps/server/src/database/repos/auth/auth-provider.repo.ts` | AuthProvider repository |
| 3 | `apps/server/src/ee/dingtalk/types/dingtalk.types.ts` | DingTalk TypeScript types |
| 4 | `apps/server/src/ee/dingtalk/dingtalk-api.service.ts` | DingTalk HTTP API wrapper + Redis cache |
| 5 | `apps/server/src/ee/dingtalk/dingtalk.service.ts` | Core business logic |
| 6 | `apps/server/src/ee/dingtalk/dto/dingtalk.dto.ts` | Request DTOs |
| 7 | `apps/server/src/ee/dingtalk/dingtalk.controller.ts` | API endpoints |
| 8 | `apps/server/src/ee/dingtalk/dingtalk.module.ts` | NestJS module |
| 9 | `wiki/docs/.vitepress/theme/types/auth.ts` | Auth types |
| 10 | `wiki/docs/.vitepress/theme/services/auth.ts` | Auth API service |
| 11 | `wiki/docs/.vitepress/theme/composables/useAuth.ts` | Auth state composable |
| 12 | `wiki/docs/.vitepress/theme/pages/LoginPage.vue` | Login page |
| 13 | `wiki/docs/.vitepress/theme/pages/LoginCallback.vue` | OAuth callback page |
| 14 | `wiki/docs/.vitepress/theme/components/UserMenu.vue` | User avatar dropdown |

### Modified Files (7)
| # | Path | Changes |
|---|------|---------|
| 1 | `apps/server/src/integrations/environment/environment.service.ts` | Add DingTalk + cookie domain getters |
| 2 | `apps/server/src/core/auth/auth.controller.ts` | Add cookie domain to setAuthCookie |
| 3 | `apps/server/src/main.ts` | Add dingtalk to excluded paths |
| 4 | `apps/server/src/database/database.module.ts` | Register auth repos |
| 5 | `apps/server/src/ee/ee.module.ts` | Register DingTalkModule |
| 6 | `apps/client/src/lib/api-client.ts` | 401 → wiki login redirect |
| 7 | `wiki/docs/.vitepress/theme/index.ts` | Add login routes + auth guard |
| 8 | `wiki/docs/.vitepress/theme/components/NavBar.vue` | Replace login link with UserMenu |
| 9 | `wiki/docs/.vitepress/theme/Layout.vue` | Init auth on mount |
| 10 | `.env.example` | Add DingTalk env vars |
