# Directory/Topic 层级系统实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 Docmost 实现 Space → Directory → Topic → Page 四级文档组织层级。

**Architecture:** 独立表方案（directories + topics + directory_members + topic_members），pages 表新增可选外键。权限继承+只能缩小覆盖。侧边栏分组折叠式混合树。

**Tech Stack:** NestJS 11 + Kysely + PostgreSQL (后端), React 18 + Mantine + react-arborist + Jotai (前端)

**Design Doc:** `docs/plans/2026-02-28-directory-topic-hierarchy-design.md`

---

## Phase 1: 数据库迁移

### Task 1: 创建数据库迁移文件

**Files:**
- Create: `apps/server/src/database/migrations/20260228T120000-directories-topics.ts`

**Step 1: 创建迁移文件**

```typescript
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // 1. directories 表
  await db.schema
    .createTable('directories')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('name', 'varchar', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('icon', 'varchar')
    .addColumn('slug', 'varchar', (col) => col.notNull())
    .addColumn('position', 'varchar')
    .addColumn('space_id', 'uuid', (col) =>
      col.references('spaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('creator_id', 'uuid', (col) => col.references('users.id'))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .addUniqueConstraint('uq_directory_slug_space', ['slug', 'space_id'])
    .execute();

  await db.schema
    .createIndex('idx_directories_space')
    .on('directories')
    .columns(['space_id'])
    .where('deleted_at', 'is', null)
    .execute();

  // 2. topics 表
  await db.schema
    .createTable('topics')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('name', 'varchar', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('icon', 'varchar')
    .addColumn('slug', 'varchar', (col) => col.notNull())
    .addColumn('position', 'varchar')
    .addColumn('directory_id', 'uuid', (col) =>
      col.references('directories.id').onDelete('cascade').notNull(),
    )
    .addColumn('space_id', 'uuid', (col) =>
      col.references('spaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('creator_id', 'uuid', (col) => col.references('users.id'))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .addUniqueConstraint('uq_topic_slug_directory', ['slug', 'directory_id'])
    .execute();

  await db.schema
    .createIndex('idx_topics_directory')
    .on('topics')
    .columns(['directory_id'])
    .where('deleted_at', 'is', null)
    .execute();

  await db.schema
    .createIndex('idx_topics_space')
    .on('topics')
    .columns(['space_id'])
    .where('deleted_at', 'is', null)
    .execute();

  // 3. directory_members 表
  await db.schema
    .createTable('directory_members')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('directory_id', 'uuid', (col) =>
      col.references('directories.id').onDelete('cascade').notNull(),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.references('users.id').onDelete('cascade'),
    )
    .addColumn('group_id', 'uuid', (col) =>
      col.references('groups.id').onDelete('cascade'),
    )
    .addColumn('role', 'varchar', (col) => col.notNull())
    .addColumn('added_by_id', 'uuid', (col) => col.references('users.id'))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await sql`ALTER TABLE directory_members ADD CONSTRAINT chk_dir_member_type CHECK (user_id IS NOT NULL OR group_id IS NOT NULL)`.execute(db);

  await db.schema
    .createIndex('uq_directory_member_user')
    .on('directory_members')
    .columns(['directory_id', 'user_id'])
    .where('user_id', 'is not', null)
    .unique()
    .execute();

  await db.schema
    .createIndex('uq_directory_member_group')
    .on('directory_members')
    .columns(['directory_id', 'group_id'])
    .where('group_id', 'is not', null)
    .unique()
    .execute();

  // 4. topic_members 表
  await db.schema
    .createTable('topic_members')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('topic_id', 'uuid', (col) =>
      col.references('topics.id').onDelete('cascade').notNull(),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.references('users.id').onDelete('cascade'),
    )
    .addColumn('group_id', 'uuid', (col) =>
      col.references('groups.id').onDelete('cascade'),
    )
    .addColumn('role', 'varchar', (col) => col.notNull())
    .addColumn('added_by_id', 'uuid', (col) => col.references('users.id'))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await sql`ALTER TABLE topic_members ADD CONSTRAINT chk_topic_member_type CHECK (user_id IS NOT NULL OR group_id IS NOT NULL)`.execute(db);

  await db.schema
    .createIndex('uq_topic_member_user')
    .on('topic_members')
    .columns(['topic_id', 'user_id'])
    .where('user_id', 'is not', null)
    .unique()
    .execute();

  await db.schema
    .createIndex('uq_topic_member_group')
    .on('topic_members')
    .columns(['topic_id', 'group_id'])
    .where('group_id', 'is not', null)
    .unique()
    .execute();

  // 5. pages 表新增列
  await db.schema
    .alterTable('pages')
    .addColumn('directory_id', 'uuid', (col) =>
      col.references('directories.id').onDelete('set null'),
    )
    .execute();

  await db.schema
    .alterTable('pages')
    .addColumn('topic_id', 'uuid', (col) =>
      col.references('topics.id').onDelete('set null'),
    )
    .execute();

  await db.schema
    .createIndex('idx_pages_directory_id')
    .on('pages')
    .columns(['directory_id'])
    .where('deleted_at', 'is', null)
    .execute();

  await db.schema
    .createIndex('idx_pages_topic_id')
    .on('pages')
    .columns(['topic_id'])
    .where('deleted_at', 'is', null)
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable('pages').dropColumn('topic_id').execute();
  await db.schema.alterTable('pages').dropColumn('directory_id').execute();
  await db.schema.dropTable('topic_members').ifExists().execute();
  await db.schema.dropTable('directory_members').ifExists().execute();
  await db.schema.dropTable('topics').ifExists().execute();
  await db.schema.dropTable('directories').ifExists().execute();
}
```

**Step 2: 更新 Kysely 类型定义 `db.d.ts`**

在 `apps/server/src/database/types/db.d.ts` 中：

1. 在 `Pages` interface 中新增两个字段（在 `parentPageId` 后面）：
```typescript
directoryId: string | null;
topicId: string | null;
```

2. 新增 4 个 interface：
```typescript
export interface Directories {
  id: Generated<string>;
  name: string;
  description: string | null;
  icon: string | null;
  slug: string;
  position: string | null;
  spaceId: string;
  workspaceId: string;
  creatorId: string | null;
  createdAt: Generated<Timestamp>;
  updatedAt: Generated<Timestamp>;
  deletedAt: Timestamp | null;
}

export interface Topics {
  id: Generated<string>;
  name: string;
  description: string | null;
  icon: string | null;
  slug: string;
  position: string | null;
  directoryId: string;
  spaceId: string;
  workspaceId: string;
  creatorId: string | null;
  createdAt: Generated<Timestamp>;
  updatedAt: Generated<Timestamp>;
  deletedAt: Timestamp | null;
}

export interface DirectoryMembers {
  id: Generated<string>;
  directoryId: string;
  userId: string | null;
  groupId: string | null;
  role: string;
  addedById: string | null;
  createdAt: Generated<Timestamp>;
  updatedAt: Generated<Timestamp>;
}

export interface TopicMembers {
  id: Generated<string>;
  topicId: string;
  userId: string | null;
  groupId: string | null;
  role: string;
  addedById: string | null;
  createdAt: Generated<Timestamp>;
  updatedAt: Generated<Timestamp>;
}
```

3. 在 `DB` interface 中新增：
```typescript
directories: Directories;
topics: Topics;
directoryMembers: DirectoryMembers;
topicMembers: TopicMembers;
```

**Step 3: 更新 `entity.types.ts`**

在 `apps/server/src/database/types/entity.types.ts` 中新增导入和类型：

```typescript
// 导入新增
import { ..., Directories, Topics, DirectoryMembers, TopicMembers } from './db';

// Directory
export type Directory = Selectable<Directories>;
export type InsertableDirectory = Insertable<Directories>;
export type UpdatableDirectory = Updateable<Omit<Directories, 'id'>>;

// Topic
export type Topic = Selectable<Topics>;
export type InsertableTopic = Insertable<Topics>;
export type UpdatableTopic = Updateable<Omit<Topics, 'id'>>;

// DirectoryMember
export type DirectoryMember = Selectable<DirectoryMembers>;
export type InsertableDirectoryMember = Insertable<DirectoryMembers>;
export type UpdatableDirectoryMember = Updateable<Omit<DirectoryMembers, 'id'>>;

// TopicMember
export type TopicMember = Selectable<TopicMembers>;
export type InsertableTopicMember = Insertable<TopicMembers>;
export type UpdatableTopicMember = Updateable<Omit<TopicMembers, 'id'>>;
```

**Step 4: 运行迁移验证**

Run: `cd apps/server && npx ts-node -e "console.log('types compile ok')"`
Expected: 编译通过

**Step 5: Commit**

```bash
git add apps/server/src/database/migrations/20260228T120000-directories-topics.ts
git add apps/server/src/database/types/db.d.ts
git add apps/server/src/database/types/entity.types.ts
git commit -m "feat(db): add directories, topics, and member tables migration"
```

---

## Phase 2: 后端 Directory 模块

### Task 2: Directory Repository

**Files:**
- Create: `apps/server/src/database/repos/directory/directory.repo.ts`
- Create: `apps/server/src/database/repos/directory/directory-member.repo.ts`

**Step 1: 创建 DirectoryRepo**

参考 `space.repo.ts` 模式，创建 `apps/server/src/database/repos/directory/directory.repo.ts`：

```typescript
import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import {
  Directory,
  InsertableDirectory,
  UpdatableDirectory,
} from '@docmost/db/types/entity.types';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { executeWithCursorPagination } from '@docmost/db/pagination/cursor-pagination';
import { validate as isValidUuid } from 'uuid';
import { sql } from 'kysely';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class DirectoryRepo {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async findById(
    directoryId: string,
    workspaceId: string,
    opts?: { trx?: KyselyTransaction },
  ): Promise<Directory> {
    const db = opts?.trx ?? this.db;
    let query = db
      .selectFrom('directories')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null);

    if (isValidUuid(directoryId)) {
      query = query.where('id', '=', directoryId);
    } else {
      query = query.where(sql`LOWER(slug)`, '=', directoryId.toLowerCase());
    }

    return query.executeTakeFirst();
  }

  async insertDirectory(
    data: InsertableDirectory,
    trx?: KyselyTransaction,
  ): Promise<Directory> {
    const db = trx ?? this.db;
    return db
      .insertInto('directories')
      .values(data)
      .returningAll()
      .executeTakeFirst();
  }

  async updateDirectory(
    data: UpdatableDirectory,
    directoryId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<Directory> {
    const db = trx ?? this.db;
    return db
      .updateTable('directories')
      .set({ ...data, updatedAt: new Date() })
      .where('id', '=', directoryId)
      .where('workspaceId', '=', workspaceId)
      .returningAll()
      .executeTakeFirst();
  }

  async deleteDirectory(
    directoryId: string,
    workspaceId: string,
  ): Promise<void> {
    await this.db
      .deleteFrom('directories')
      .where('id', '=', directoryId)
      .where('workspaceId', '=', workspaceId)
      .execute();
  }

  async getDirectoriesInSpace(
    spaceId: string,
    workspaceId: string,
    pagination: PaginationOptions,
  ) {
    const query = this.db
      .selectFrom('directories')
      .selectAll()
      .where('spaceId', '=', spaceId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null);

    return executeWithCursorPagination(query, {
      perPage: pagination.limit,
      cursor: pagination.cursor,
      cursorField: 'position',
      sortDirection: 'asc',
      secondarySortField: 'id',
    });
  }

  async slugExists(
    slug: string,
    spaceId: string,
    excludeId?: string,
  ): Promise<boolean> {
    let query = this.db
      .selectFrom('directories')
      .select('id')
      .where(sql`LOWER(slug)`, '=', slug.toLowerCase())
      .where('spaceId', '=', spaceId)
      .where('deletedAt', 'is', null);

    if (excludeId) {
      query = query.where('id', '!=', excludeId);
    }

    const result = await query.executeTakeFirst();
    return !!result;
  }
}
```

**Step 2: 创建 DirectoryMemberRepo**

创建 `apps/server/src/database/repos/directory/directory-member.repo.ts`，参考 `space-member.repo.ts`：

```typescript
import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import {
  DirectoryMember,
  InsertableDirectoryMember,
} from '@docmost/db/types/entity.types';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { executeWithCursorPagination } from '@docmost/db/pagination/cursor-pagination';

@Injectable()
export class DirectoryMemberRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async insertMember(data: InsertableDirectoryMember): Promise<DirectoryMember> {
    return this.db
      .insertInto('directoryMembers')
      .values(data)
      .returningAll()
      .executeTakeFirst();
  }

  async getMemberByTypeId(
    directoryId: string,
    opts: { userId?: string; groupId?: string },
  ): Promise<DirectoryMember> {
    let query = this.db
      .selectFrom('directoryMembers')
      .selectAll()
      .where('directoryId', '=', directoryId);

    if (opts.userId) {
      query = query.where('userId', '=', opts.userId);
    }
    if (opts.groupId) {
      query = query.where('groupId', '=', opts.groupId);
    }

    return query.executeTakeFirst();
  }

  async removeMemberById(memberId: string, directoryId: string): Promise<void> {
    await this.db
      .deleteFrom('directoryMembers')
      .where('id', '=', memberId)
      .where('directoryId', '=', directoryId)
      .execute();
  }

  async updateMemberRole(
    memberId: string,
    role: string,
  ): Promise<void> {
    await this.db
      .updateTable('directoryMembers')
      .set({ role, updatedAt: new Date() })
      .where('id', '=', memberId)
      .execute();
  }

  async getUserDirectoryRoles(
    userId: string,
    directoryId: string,
  ): Promise<string[]> {
    // 直接成员角色
    const directRoles = await this.db
      .selectFrom('directoryMembers')
      .select('role')
      .where('directoryId', '=', directoryId)
      .where('userId', '=', userId)
      .execute();

    // 通过 group 继承的角色
    const groupRoles = await this.db
      .selectFrom('directoryMembers')
      .innerJoin('groupUsers', 'groupUsers.groupId', 'directoryMembers.groupId')
      .select('directoryMembers.role')
      .where('directoryMembers.directoryId', '=', directoryId)
      .where('groupUsers.userId', '=', userId)
      .execute();

    return [...directRoles, ...groupRoles].map((r) => r.role);
  }

  async getMembersPaginated(
    directoryId: string,
    pagination: PaginationOptions,
  ) {
    const query = this.db
      .selectFrom('directoryMembers')
      .selectAll()
      .where('directoryId', '=', directoryId);

    return executeWithCursorPagination(query, {
      perPage: pagination.limit ?? 100,
      cursor: pagination.cursor,
    });
  }
}
```

**Step 3: Commit**

```bash
git add apps/server/src/database/repos/directory/
git commit -m "feat(db): add Directory and DirectoryMember repositories"
```

---

### Task 3: Directory DTO + Service + Controller

**Files:**
- Create: `apps/server/src/core/directory/dto/directory.dto.ts`
- Create: `apps/server/src/core/directory/directory.service.ts`
- Create: `apps/server/src/core/directory/directory-member.service.ts`
- Create: `apps/server/src/core/directory/directory.controller.ts`
- Create: `apps/server/src/core/directory/directory.module.ts`

**Step 1: 创建 DTO**

`apps/server/src/core/directory/dto/directory.dto.ts`:

```typescript
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  MinLength,
  MaxLength,
  IsAlphanumeric,
  IsArray,
  ArrayMaxSize,
  IsEnum,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { SpaceRole } from '../../../common/helpers/types/permission';

export class DirectoryIdDto {
  @IsString()
  @IsNotEmpty()
  directoryId: string;
}

export class DirectoryListDto {
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  spaceId: string;
}

export class CreateDirectoryDto {
  @MinLength(2)
  @MaxLength(100)
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @MinLength(2)
  @MaxLength(100)
  @IsAlphanumeric()
  slug: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsUUID()
  spaceId: string;
}

export class UpdateDirectoryDto extends PartialType(CreateDirectoryDto) {
  @IsString()
  @IsNotEmpty()
  @IsUUID()
  directoryId: string;
}

export class AddDirectoryMembersDto extends DirectoryIdDto {
  @IsEnum(SpaceRole)
  role: string;

  @IsArray()
  @ArrayMaxSize(25)
  @IsUUID('all', { each: true })
  userIds: string[];

  @IsArray()
  @ArrayMaxSize(25)
  @IsUUID('all', { each: true })
  groupIds: string[];
}

export class UpdateDirectoryMemberRoleDto extends DirectoryIdDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsUUID()
  groupId?: string;

  @IsEnum(SpaceRole)
  role: string;
}

export class RemoveDirectoryMemberDto extends DirectoryIdDto {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsUUID()
  groupId?: string;
}
```

**Step 2: 创建 DirectoryService**

`apps/server/src/core/directory/directory.service.ts`：
参考 `space.service.ts`，实现 create/update/delete/getInfo/list。

关键点：
- createDirectory 需自动生成 position（fractional-indexing）
- deleteDirectory 是物理删除（CASCADE 会级联删 topics，pages.directory_id SET NULL）
- updateDirectory 检查 slug 唯一性

**Step 3: 创建 DirectoryMemberService**

`apps/server/src/core/directory/directory-member.service.ts`：
参考 `space-member.service.ts`，实现 add/remove/changeRole/list。

关键点：
- 添加成员时验证角色 ≤ 父 Space 角色（只能缩小）
- 使用 SpaceMemberRepo 查询父 Space 角色进行比较

**Step 4: 创建 DirectoryController**

`apps/server/src/core/directory/directory.controller.ts`：
参考 `space.controller.ts`，10 个 POST 端点。

权限检查模式：
- `/create`：检查 Space Manage 权限
- `/update`/`/delete`：检查 Directory Manage 权限
- `/info`/`/list`：检查 Space Read 权限
- `/members/*`：检查 Directory Manage 权限

**Step 5: 创建 DirectoryModule**

`apps/server/src/core/directory/directory.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { DirectoryService } from './directory.service';
import { DirectoryController } from './directory.controller';
import { DirectoryMemberService } from './directory-member.service';

@Module({
  controllers: [DirectoryController],
  providers: [DirectoryService, DirectoryMemberService],
  exports: [DirectoryService, DirectoryMemberService],
})
export class DirectoryModule {}
```

**Step 6: 注册到 CoreModule**

修改 `apps/server/src/core/core.module.ts`，在 imports 中添加 `DirectoryModule`。

**Step 7: Commit**

```bash
git add apps/server/src/core/directory/
git add apps/server/src/core/core.module.ts
git commit -m "feat(backend): add Directory module with CRUD and member management"
```

---

## Phase 3: 后端 Topic 模块

### Task 4: Topic Repository

**Files:**
- Create: `apps/server/src/database/repos/topic/topic.repo.ts`
- Create: `apps/server/src/database/repos/topic/topic-member.repo.ts`

与 Task 2 结构完全平行，但：
- `topic.repo.ts` 的 `getTopicsInDirectory` 按 `directoryId` 过滤
- `topic-member.repo.ts` 的 `getUserTopicRoles` 按 `topicId` 查询

**Commit:** `feat(db): add Topic and TopicMember repositories`

---

### Task 5: Topic DTO + Service + Controller + Module

**Files:**
- Create: `apps/server/src/core/topic/dto/topic.dto.ts`
- Create: `apps/server/src/core/topic/topic.service.ts`
- Create: `apps/server/src/core/topic/topic-member.service.ts`
- Create: `apps/server/src/core/topic/topic.controller.ts`
- Create: `apps/server/src/core/topic/topic.module.ts`
- Modify: `apps/server/src/core/core.module.ts`

与 Task 3 结构完全平行，但：
- `CreateTopicDto` 需要 `directoryId`（必填）而非 `spaceId`
- `TopicService.createTopic` 从 directory 推导 spaceId 和 workspaceId
- 权限检查：`/create` 需要 Directory Manage 权限

**Commit:** `feat(backend): add Topic module with CRUD and member management`

---

## Phase 4: 权限系统扩展

### Task 6: Directory/Topic Ability Factories

**Files:**
- Create: `apps/server/src/core/casl/abilities/directory-ability.factory.ts`
- Create: `apps/server/src/core/casl/abilities/topic-ability.factory.ts`
- Modify: `apps/server/src/core/casl/interfaces/space-ability.type.ts`
- Modify: `apps/server/src/core/casl/casl.module.ts`

**Step 1: 扩展 SpaceCaslSubject**

在 `apps/server/src/core/casl/interfaces/space-ability.type.ts` 中：

```typescript
export enum SpaceCaslSubject {
  Settings = 'settings',
  Member = 'member',
  Page = 'page',
  Share = 'share',
  Directory = 'directory',  // 新增
  Topic = 'topic',          // 新增
}
```

并扩展 `ISpaceAbility` 类型联合。

**Step 2: 创建 DirectoryAbilityFactory**

`apps/server/src/core/casl/abilities/directory-ability.factory.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { createMongoAbility, MongoAbility } from '@casl/ability';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { DirectoryMemberRepo } from '@docmost/db/repos/directory/directory-member.repo';
import { DirectoryRepo } from '@docmost/db/repos/directory/directory.repo';
import { User } from '@docmost/db/types/entity.types';
import { ISpaceAbility, SpaceCaslAction, SpaceCaslSubject } from '../interfaces/space-ability.type';
import { findHighestUserSpaceRole } from '@docmost/db/repos/space/utils';
import { SpaceRole } from '../../../common/helpers/types/permission';

const ROLE_PRIORITY = { [SpaceRole.ADMIN]: 3, [SpaceRole.WRITER]: 2, [SpaceRole.READER]: 1 };

@Injectable()
export class DirectoryAbilityFactory {
  constructor(
    private readonly spaceMemberRepo: SpaceMemberRepo,
    private readonly directoryMemberRepo: DirectoryMemberRepo,
    private readonly directoryRepo: DirectoryRepo,
  ) {}

  async createForUser(user: User, directoryId: string): Promise<MongoAbility<ISpaceAbility>> {
    // 1. 获取 directory 以得到 spaceId
    const directory = await this.directoryRepo.findById(directoryId, user.workspaceId);
    if (!directory) {
      return createMongoAbility<ISpaceAbility>([]);
    }

    // 2. 获取 space 角色
    const spaceRoles = await this.spaceMemberRepo.getUserSpaceRoles(user.id, directory.spaceId);
    const spaceRole = findHighestUserSpaceRole(spaceRoles);
    if (!spaceRole) {
      return createMongoAbility<ISpaceAbility>([]);
    }

    // 3. 获取 directory 角色覆盖
    const dirRoles = await this.directoryMemberRepo.getUserDirectoryRoles(user.id, directoryId);

    // 4. 计算有效角色：min(dirRole, spaceRole)
    let effectiveRole = spaceRole;
    if (dirRoles.length > 0) {
      const highestDirRole = dirRoles.reduce((a, b) =>
        (ROLE_PRIORITY[a] || 0) >= (ROLE_PRIORITY[b] || 0) ? a : b,
      );
      effectiveRole = (ROLE_PRIORITY[highestDirRole] || 0) <= (ROLE_PRIORITY[spaceRole] || 0)
        ? highestDirRole
        : spaceRole;
    }

    return this.buildAbility(effectiveRole);
  }

  private buildAbility(role: string): MongoAbility<ISpaceAbility> {
    const rules: any[] = [];
    switch (role) {
      case SpaceRole.ADMIN:
        rules.push({ action: 'manage', subject: SpaceCaslSubject.Settings });
        rules.push({ action: 'manage', subject: SpaceCaslSubject.Member });
        rules.push({ action: 'manage', subject: SpaceCaslSubject.Page });
        break;
      case SpaceRole.WRITER:
        rules.push({ action: 'read', subject: SpaceCaslSubject.Settings });
        rules.push({ action: 'read', subject: SpaceCaslSubject.Member });
        rules.push({ action: 'manage', subject: SpaceCaslSubject.Page });
        break;
      case SpaceRole.READER:
        rules.push({ action: 'read', subject: SpaceCaslSubject.Settings });
        rules.push({ action: 'read', subject: SpaceCaslSubject.Member });
        rules.push({ action: 'read', subject: SpaceCaslSubject.Page });
        break;
    }
    return createMongoAbility<ISpaceAbility>(rules);
  }
}
```

**Step 3: 创建 TopicAbilityFactory**

同理，但三层计算：`effectiveRole = min(topicRole ?? dirRole, dirRole, spaceRole)`

**Step 4: 注册到 CaslModule**

修改 `apps/server/src/core/casl/casl.module.ts`，添加新的 factory 为 providers 和 exports。

**Step 5: Commit**

```bash
git add apps/server/src/core/casl/
git commit -m "feat(auth): add DirectoryAbility and TopicAbility factories with permission narrowing"
```

---

## Phase 5: Page 集成

### Task 7: 修改 Page 相关代码

**Files:**
- Modify: `apps/server/src/core/page/dto/create-page.dto.ts` — 新增 directoryId/topicId 可选字段
- Modify: `apps/server/src/core/page/dto/sidebar-page.dto.ts` — 新增 directoryId/topicId/filterUncategorized
- Modify: `apps/server/src/core/page/dto/move-page.dto.ts` — 新增 directoryId/topicId
- Modify: `apps/server/src/core/page/services/page.service.ts`:
  - `create()`: 如果提供 topicId，自动推导 directoryId
  - `getSidebarPages()`: 支持新的过滤参数
  - `getPageBreadCrumbs()`: 返回值 prepend directory/topic 信息
  - `movePage()`: 支持修改 directoryId/topicId
- Modify: `apps/server/src/database/repos/page/page.repo.ts`:
  - `baseFields` 新增 `'directoryId'`, `'topicId'`
  - `getSidebarPages()` 新增 WHERE 条件

**关键改动 — page.repo.ts 的 getSidebarPages 查询**：

```typescript
// 现有逻辑基础上新增：
if (containerFilter?.directoryId) {
  query = query.where('directoryId', '=', containerFilter.directoryId);
}
if (containerFilter?.topicId) {
  query = query.where('topicId', '=', containerFilter.topicId);
}
if (containerFilter?.filterUncategorized) {
  query = query.where('directoryId', 'is', null).where('topicId', 'is', null);
}
```

**Commit:** `feat(page): integrate directory/topic fields into page CRUD and sidebar`

---

## Phase 6: 搜索集成

### Task 8: 搜索过滤扩展

**Files:**
- Modify: `apps/server/src/core/search/dto/search.dto.ts` — 新增 directoryId/topicId
- Modify: `apps/server/src/core/search/search.service.ts` — WHERE 子句新增过滤
- Modify: `apps/server/src/ee/ai/services/ai-search.service.ts` — 向量搜索过滤
- Modify: `apps/server/src/ee/ai/ai-queue.processor.ts` — embedding 同步 directoryId/topicId

**Commit:** `feat(search): add directory/topic filter support to fulltext and vector search`

---

## Phase 7: 前端 — 类型和服务

### Task 9: Directory 前端类型、服务、查询

**Files:**
- Create: `apps/client/src/features/directory/types/directory.types.ts`
- Create: `apps/client/src/features/directory/services/directory-service.ts`
- Create: `apps/client/src/features/directory/queries/directory-query.ts`

**Step 1: 类型定义**

```typescript
// directory.types.ts
export interface IDirectory {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  slug: string;
  position: string;
  spaceId: string;
  workspaceId: string;
  creatorId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IDirectoryMember {
  id: string;
  role: string;
  name: string;
  email?: string;
  avatarUrl?: string;
  type: 'user' | 'group';
  memberCount?: number;
  isDefault?: boolean;
}
```

**Step 2: 服务层（API 调用）**

参考 `space-service.ts` 模式，10 个函数对应 10 个 POST 端点。

**Step 3: React Query hooks**

参考 `space-query.ts` 模式，create/update/delete mutation + list/info query。

**Commit:** `feat(frontend): add Directory types, services, and query hooks`

---

### Task 10: Topic 前端类型、服务、查询

与 Task 9 平行结构，但 Topic 需要 `directoryId`。

**Commit:** `feat(frontend): add Topic types, services, and query hooks`

---

### Task 11: 扩展 Page 类型

**Files:**
- Modify: `apps/client/src/features/page/types/page.types.ts` — IPage 新增 directoryId/topicId
- Modify: `apps/client/src/features/page/types/page.types.ts` — SidebarPagesParams 新增 directoryId/topicId/filterUncategorized
- Modify: `apps/client/src/features/page/tree/types.ts` — SpaceTreeNode 新增 nodeType/directoryId/topicId

**Commit:** `feat(frontend): extend page and tree types with directory/topic fields`

---

## Phase 8: 前端 — 管理页面

### Task 12: Directory 管理页面

**Files:**
- Create: `apps/client/src/pages/settings/space/directory-management.tsx`
- Create: `apps/client/src/features/directory/components/directory-list.tsx`
- Create: `apps/client/src/features/directory/components/directory-form-modal.tsx`
- Create: `apps/client/src/features/directory/components/directory-members.tsx`
- Modify: `apps/client/src/App.tsx` — 新增路由

参考 `spaces.tsx` + `space-list.tsx` + `space-details.tsx` + `space-members.tsx` 的组件模式。

管理页面包含：
- 顶部标题 + "创建目录"按钮
- 目录列表表格（名称、图标、描述、操作列）
- 创建/编辑弹窗（名称、slug、描述、图标）
- 成员管理弹窗（复用 SpaceMembersList 模式）

**路由注册**（`App.tsx`）:
```typescript
<Route path={"spaces/:spaceId/directories"} element={<DirectoryManagement />} />
<Route path={"spaces/:spaceId/topics"} element={<TopicManagement />} />
```

**Commit:** `feat(frontend): add Directory management settings page`

---

### Task 13: Topic 管理页面

**Files:**
- Create: `apps/client/src/pages/settings/space/topic-management.tsx`
- Create: `apps/client/src/features/topic/components/topic-list.tsx`
- Create: `apps/client/src/features/topic/components/topic-form-modal.tsx`
- Create: `apps/client/src/features/topic/components/topic-members.tsx`
- Create: `apps/client/src/features/directory/components/directory-select.tsx`

Topic 管理页面顶部需要一个 `DirectorySelect` 下拉选择器，选择目录后显示其下 Topic 列表。

**Commit:** `feat(frontend): add Topic management settings page`

---

### Task 14: 空间列表入口

**Files:**
- Modify: `apps/client/src/features/space/components/space-list.tsx` — 每行增加"目录"/"主题"管理链接

在空间列表的每一行操作菜单中添加：
- "管理目录" → navigate(`/settings/spaces/${space.id}/directories`)
- "管理主题" → navigate(`/settings/spaces/${space.id}/topics`)

**Commit:** `feat(frontend): add directory/topic management links to space list`

---

## Phase 9: 前端 — 侧边栏重构

### Task 15: 侧边栏混合树

**Files:**
- Modify: `apps/client/src/features/page/tree/types.ts` — nodeType 字段
- Modify: `apps/client/src/features/page/tree/utils/utils.ts` — buildMixedTree 函数
- Modify: `apps/client/src/features/page/tree/components/space-tree.tsx` — 混合数据加载
- Modify: `apps/client/src/features/page/tree/hooks/use-tree-mutation.ts` — 拖拽规则
- Modify: `apps/client/src/features/space/components/sidebar/space-sidebar.tsx` — 数据流

**核心改动思路**：

1. **SpaceTreeNode 扩展**：
```typescript
type SpaceTreeNode = {
  ...existing,
  nodeType: 'directory' | 'topic' | 'page';  // 新增
  directoryId?: string;  // topic/page 可用
  topicId?: string;      // page 可用
};
```

2. **数据加载流程改造**：
- 首先加载 directories（nodeType='directory'）+ 未分类根页面
- 组装为混合树根节点
- 展开 directory 时加载 topics + 未分类页面
- 展开 topic 时加载其下根页面
- 展开 page 时加载子页面（不变）

3. **Node 渲染区分**：
- directory 节点：📁 图标，粗体，右键菜单含"新建 Topic"/"新建 Page"
- topic 节点：🏷️ 图标，正常字重，右键菜单含"新建 Page"
- page 节点：不变

4. **拖拽规则**：
- `canDrop` 回调检查 nodeType 组合
- page → directory: 设 directoryId，清 topicId
- page → topic: 设 topicId + directoryId
- directory/topic 节点不可跨父级拖拽

**Commit:** `feat(frontend): refactor sidebar tree to support directory/topic/page mixed nodes`

---

## Phase 10: 前端 — 面包屑和移动模态框

### Task 16: 面包屑改造

**Files:**
- Modify: `apps/client/src/features/page/components/breadcrumbs/breadcrumb.tsx`
- Modify: `apps/client/src/features/page/services/page-service.ts` — breadcrumbs API 适配

改造 breadcrumb 组件：
- 从 API 返回的 `directory`/`topic` 可选对象
- 在 page 面包屑链前 prepend directory 和 topic 项
- directory/topic 项点击不导航到新页面，而是在侧边栏中定位

**Commit:** `feat(frontend): extend breadcrumbs with directory/topic prefix`

---

### Task 17: 移动页面模态框改造

**Files:**
- Modify: `apps/client/src/features/page/components/move-page-modal.tsx`
- Modify: `apps/client/src/features/page/components/copy-page-modal.tsx`
- Create: `apps/client/src/features/directory/components/directory-select.tsx`（如 Task 13 未创建）
- Create: `apps/client/src/features/topic/components/topic-select.tsx`

改造 MovePageModal：
- 现有 SpaceSelect 保留
- 新增 DirectorySelect（基于选中 Space 加载，含"未分类"选项）
- 新增 TopicSelect（基于选中 Directory 加载，含"无主题"选项）
- 提交时 API 调用带 directoryId/topicId 参数

CopyPageModal 同理。

**Commit:** `feat(frontend): add cascading directory/topic select to move/copy modals`

---

## Phase 11: 收尾

### Task 18: 编译验证和清理

**Step 1: 后端编译**

Run: `cd apps/server && pnpm build`
Expected: 编译通过，无错误

**Step 2: 前端编译**

Run: `cd apps/client && pnpm build`
Expected: 编译通过，无错误

**Step 3: 类型检查**

Run: `pnpm typecheck`（如有配置）

**Step 4: 最终 commit**

```bash
git add -A
git commit -m "chore: final cleanup and type fixes for directory/topic hierarchy"
```

---

## 实现顺序依赖图

```
Task 1 (迁移)
  → Task 2 (Directory Repo) → Task 3 (Directory Module)
  → Task 4 (Topic Repo) → Task 5 (Topic Module)
  → Task 6 (权限 Factories)
  → Task 7 (Page 集成)
  → Task 8 (搜索集成)
  → Task 9-11 (前端类型/服务)
    → Task 12-14 (管理页面)
    → Task 15 (侧边栏重构)
    → Task 16-17 (面包屑 + 移动模态框)
  → Task 18 (编译验证)
```

**并行可能性**：
- Task 2 和 Task 4 可以并行（互不依赖）
- Task 3 和 Task 5 可以并行
- Task 9 和 Task 10 可以并行
- Task 12 和 Task 13 可以并行
- Task 15、16、17 可以并行

---

## 关键文件速查表

| 新建/修改 | 文件路径 |
|-----------|---------|
| 新建 | `apps/server/src/database/migrations/20260228T120000-directories-topics.ts` |
| 修改 | `apps/server/src/database/types/db.d.ts` |
| 修改 | `apps/server/src/database/types/entity.types.ts` |
| 新建 | `apps/server/src/database/repos/directory/directory.repo.ts` |
| 新建 | `apps/server/src/database/repos/directory/directory-member.repo.ts` |
| 新建 | `apps/server/src/database/repos/topic/topic.repo.ts` |
| 新建 | `apps/server/src/database/repos/topic/topic-member.repo.ts` |
| 新建 | `apps/server/src/core/directory/` (module/controller/service/dto) |
| 新建 | `apps/server/src/core/topic/` (module/controller/service/dto) |
| 新建 | `apps/server/src/core/casl/abilities/directory-ability.factory.ts` |
| 新建 | `apps/server/src/core/casl/abilities/topic-ability.factory.ts` |
| 修改 | `apps/server/src/core/casl/interfaces/space-ability.type.ts` |
| 修改 | `apps/server/src/core/casl/casl.module.ts` |
| 修改 | `apps/server/src/core/core.module.ts` |
| 修改 | `apps/server/src/core/page/dto/*.ts` |
| 修改 | `apps/server/src/core/page/services/page.service.ts` |
| 修改 | `apps/server/src/database/repos/page/page.repo.ts` |
| 修改 | `apps/server/src/core/search/search.service.ts` |
| 修改 | `apps/server/src/core/search/dto/search.dto.ts` |
| 修改 | `apps/server/src/ee/ai/services/ai-search.service.ts` |
| 修改 | `apps/server/src/ee/ai/ai-queue.processor.ts` |
| 新建 | `apps/client/src/features/directory/` (types/services/queries/components) |
| 新建 | `apps/client/src/features/topic/` (types/services/queries/components) |
| 新建 | `apps/client/src/pages/settings/space/directory-management.tsx` |
| 新建 | `apps/client/src/pages/settings/space/topic-management.tsx` |
| 修改 | `apps/client/src/App.tsx` |
| 修改 | `apps/client/src/features/page/types/page.types.ts` |
| 修改 | `apps/client/src/features/page/tree/types.ts` |
| 修改 | `apps/client/src/features/page/tree/components/space-tree.tsx` |
| 修改 | `apps/client/src/features/page/tree/hooks/use-tree-mutation.ts` |
| 修改 | `apps/client/src/features/page/tree/utils/utils.ts` |
| 修改 | `apps/client/src/features/page/components/breadcrumbs/breadcrumb.tsx` |
| 修改 | `apps/client/src/features/page/components/move-page-modal.tsx` |
| 修改 | `apps/client/src/features/page/components/copy-page-modal.tsx` |
| 修改 | `apps/client/src/features/page/services/page-service.ts` |
| 修改 | `apps/client/src/features/space/components/space-list.tsx` |
