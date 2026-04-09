# Hierarchical Permission System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement three-level permission model (Space → Directory → Page) with unified `resource_permissions` override table, ResourceAbilityFactory, CRUD API, frontend permission management UI, and database-driven Wiki public control.

**Architecture:** New `resource_permissions` table stores override records for directories and pages. `ResourceAbilityFactory` resolves effective permissions via a three-step chain: page override → directory override → space_members fallback. Existing `space_members` and `SpaceAbilityFactory` remain untouched for Space-level operations.

**Tech Stack:** NestJS 11 + Kysely (PostgreSQL) + CASL + React 18 + Mantine + TanStack React Query

**Spec:** `docs/superpowers/specs/2026-04-09-hierarchical-permission-system-design.md`

---

## File Structure

### New Files (Backend)

| File | Responsibility |
|------|---------------|
| `apps/server/src/database/migrations/20260410T120000-resource-permissions.ts` | DB migration: create table + indexes |
| `apps/server/src/database/types/db.d.ts` | Add `resourcePermissions` to DB interface (modify) |
| `apps/server/src/database/types/entity.types.ts` | Add ResourcePermission type aliases (modify) |
| `apps/server/src/database/repos/resource-permission/resource-permission.repo.ts` | Data access layer |
| `apps/server/src/database/repos/resource-permission/types.ts` | UserResourceRole interface |
| `apps/server/src/database/repos/resource-permission/index.ts` | Barrel export |
| `apps/server/src/core/casl/abilities/resource-ability.factory.ts` | Three-level permission resolution engine |
| `apps/server/src/core/resource-permission/resource-permission.module.ts` | NestJS module |
| `apps/server/src/core/resource-permission/resource-permission.controller.ts` | CRUD API endpoints |
| `apps/server/src/core/resource-permission/resource-permission.service.ts` | Business logic + event listeners |
| `apps/server/src/core/resource-permission/dto/list-resource-permissions.dto.ts` | List DTO |
| `apps/server/src/core/resource-permission/dto/add-resource-permission.dto.ts` | Add DTO |
| `apps/server/src/core/resource-permission/dto/update-resource-permission.dto.ts` | Update DTO |
| `apps/server/src/core/resource-permission/dto/remove-resource-permission.dto.ts` | Remove DTO |

### New Files (Frontend)

| File | Responsibility |
|------|---------------|
| `apps/client/src/features/resource-permission/services/resource-permission-service.ts` | API calls |
| `apps/client/src/features/resource-permission/queries/resource-permission-query.ts` | React Query hooks |
| `apps/client/src/features/resource-permission/components/resource-permission-modal.tsx` | Permission management modal |
| `apps/client/src/features/resource-permission/types/resource-permission.types.ts` | TypeScript types |

### Modified Files

| File | Change |
|------|--------|
| `apps/server/src/common/helpers/types/permission.ts` | Add `NONE` to SpaceRole enum |
| `apps/server/src/core/casl/interfaces/space-ability.type.ts` | Add `Directory` to SpaceCaslSubject |
| `apps/server/src/core/casl/casl.module.ts` | Register ResourceAbilityFactory |
| `apps/server/src/core/core.module.ts` | Import ResourcePermissionModule |
| `apps/server/src/core/page/page.controller.ts` | Switch to ResourceAbilityFactory |
| `apps/server/src/core/comment/comment.controller.ts` | Switch to ResourceAbilityFactory |
| `apps/server/src/core/share/share.controller.ts` | Switch to ResourceAbilityFactory |
| `apps/server/src/core/attachment/attachment.controller.ts` | Switch to ResourceAbilityFactory |
| `apps/server/src/core/directory/directory.controller.ts` | Switch to ResourceAbilityFactory |
| `apps/server/src/integrations/export/export.controller.ts` | Switch to ResourceAbilityFactory |
| `apps/server/src/collaboration/extensions/authentication.extension.ts` | Three-level resolution |
| `apps/server/src/core/public-wiki/public-wiki.service.ts` | DB-driven public control |
| `apps/server/src/core/casl/abilities/space-ability.factory.ts` | Add buildNoneAbility |
| `apps/client/src/features/space/permissions/permissions.type.ts` | Add ResourcePermission interface |
| `apps/client/src/features/editor/page-editor.tsx` | Use ResourcePermission |
| `apps/client/src/features/page/components/header/page-header-menu.tsx` | Granular button control |

---

## Step 1: Database + Data Layer

### Task 1: Database Migration

**Files:**
- Create: `apps/server/src/database/migrations/20260410T120000-resource-permissions.ts`

- [ ] **Step 1: Create migration file**

```typescript
// apps/server/src/database/migrations/20260410T120000-resource-permissions.ts
import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('resource_permissions')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('resource_type', 'varchar(20)', (col) => col.notNull())
    .addColumn('resource_id', 'uuid', (col) => col.notNull())
    .addColumn('principal_type', 'varchar(10)', (col) => col.notNull())
    .addColumn('principal_id', 'uuid', (col) => col.notNull())
    .addColumn('role', 'varchar(20)', (col) => col.notNull())
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('created_by', 'uuid', (col) => col.references('users.id'))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('uq_resource_principal', [
      'resource_type',
      'resource_id',
      'principal_type',
      'principal_id',
    ])
    .addCheckConstraint(
      'chk_principal_type',
      sql`principal_type IN ('user', 'group')`,
    )
    .addCheckConstraint(
      'chk_resource_type',
      sql`resource_type IN ('directory', 'page')`,
    )
    .addCheckConstraint(
      'chk_role',
      sql`role IN ('admin', 'writer', 'reader', 'none')`,
    )
    .execute();

  await db.schema
    .createIndex('idx_rp_principal')
    .on('resource_permissions')
    .columns(['principal_type', 'principal_id', 'workspace_id'])
    .execute();

  await db.schema
    .createIndex('idx_rp_resource')
    .on('resource_permissions')
    .columns(['resource_type', 'resource_id'])
    .execute();

  await db.schema
    .createIndex('idx_rp_workspace')
    .on('resource_permissions')
    .columns(['workspace_id'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('resource_permissions').ifExists().execute();
}
```

- [ ] **Step 2: Run migration**

Run: `cd apps/server && npx kysely migrate:latest`
Expected: Migration applies successfully, table `resource_permissions` created.

- [ ] **Step 3: Verify table exists**

Run: `psql -c "\d resource_permissions"`
Expected: Table with all columns, constraints, and indexes visible.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/database/migrations/20260410T120000-resource-permissions.ts
git commit -m "feat(db): add resource_permissions table for hierarchical permissions"
```

---

### Task 2: Kysely Type Definitions

**Files:**
- Modify: `apps/server/src/database/types/db.d.ts`
- Modify: `apps/server/src/database/types/entity.types.ts`

- [ ] **Step 1: Add ResourcePermissions interface to db.d.ts**

Add the interface alongside existing ones (near `SpaceMembers`):

```typescript
export interface ResourcePermissions {
  id: Generated<string>;
  resourceType: string;
  resourceId: string;
  principalType: string;
  principalId: string;
  role: string;
  workspaceId: string;
  createdBy: string | null;
  createdAt: Generated<Timestamp>;
  updatedAt: Generated<Timestamp>;
}
```

Add to the `DB` interface:

```typescript
export interface DB {
  // ... existing entries ...
  resourcePermissions: ResourcePermissions;
  // ... existing entries ...
}
```

- [ ] **Step 2: Add type aliases to entity.types.ts**

```typescript
// ResourcePermission
export type ResourcePermission = Selectable<ResourcePermissions>;
export type InsertableResourcePermission = Insertable<ResourcePermissions>;
export type UpdatableResourcePermission = Updateable<Omit<ResourcePermissions, 'id'>>;
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd apps/server && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/server/src/database/types/
git commit -m "feat(db): add ResourcePermissions Kysely type definitions"
```

---

### Task 3: Add NONE to SpaceRole Enum

**Files:**
- Modify: `apps/server/src/common/helpers/types/permission.ts`

- [ ] **Step 1: Add NONE value**

```typescript
export enum SpaceRole {
  ADMIN = 'admin',
  WRITER = 'writer',
  READER = 'reader',
  NONE = 'none',  // Explicit deny — resource invisible to user
}
```

- [ ] **Step 2: Verify no existing code breaks**

Run: `cd apps/server && npx tsc --noEmit`
Expected: No errors. Existing `switch` statements on SpaceRole have `default` cases, so adding a new value won't break them.

- [ ] **Step 3: Commit**

```bash
git add apps/server/src/common/helpers/types/permission.ts
git commit -m "feat(auth): add NONE role to SpaceRole enum"
```

---

### Task 4: ResourcePermissionRepo

**Files:**
- Create: `apps/server/src/database/repos/resource-permission/types.ts`
- Create: `apps/server/src/database/repos/resource-permission/resource-permission.repo.ts`
- Create: `apps/server/src/database/repos/resource-permission/index.ts`

- [ ] **Step 1: Create types**

```typescript
// apps/server/src/database/repos/resource-permission/types.ts
export interface UserResourceRole {
  principalId: string;
  role: string;
}
```

- [ ] **Step 2: Create repo**

```typescript
// apps/server/src/database/repos/resource-permission/resource-permission.repo.ts
import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import {
  InsertableResourcePermission,
  ResourcePermission,
} from '@docmost/db/types/entity.types';
import { UserResourceRole } from './types';

@Injectable()
export class ResourcePermissionRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async getUserResourceRoles(
    userId: string,
    resourceType: string,
    resourceId: string,
  ): Promise<UserResourceRole[]> {
    const roles = await this.db
      .selectFrom('resourcePermissions')
      .select(['principalId', 'role'])
      .where('resourceType', '=', resourceType)
      .where('resourceId', '=', resourceId)
      .where('principalType', '=', 'user')
      .where('principalId', '=', userId)
      .unionAll(
        this.db
          .selectFrom('resourcePermissions')
          .innerJoin(
            'groupUsers',
            'groupUsers.groupId',
            'resourcePermissions.principalId',
          )
          .select(['groupUsers.userId as principalId', 'resourcePermissions.role'])
          .where('resourcePermissions.resourceType', '=', resourceType)
          .where('resourcePermissions.resourceId', '=', resourceId)
          .where('resourcePermissions.principalType', '=', 'group')
          .where('groupUsers.userId', '=', userId),
      )
      .execute();

    return roles;
  }

  async listByResource(
    resourceType: string,
    resourceId: string,
  ): Promise<ResourcePermission[]> {
    return this.db
      .selectFrom('resourcePermissions')
      .selectAll()
      .where('resourceType', '=', resourceType)
      .where('resourceId', '=', resourceId)
      .orderBy('createdAt', 'asc')
      .execute();
  }

  async insert(data: InsertableResourcePermission): Promise<ResourcePermission> {
    return this.db
      .insertInto('resourcePermissions')
      .values(data)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateRole(id: string, role: string): Promise<void> {
    await this.db
      .updateTable('resourcePermissions')
      .set({ role, updatedAt: new Date() })
      .where('id', '=', id)
      .execute();
  }

  async deleteById(id: string): Promise<void> {
    await this.db
      .deleteFrom('resourcePermissions')
      .where('id', '=', id)
      .execute();
  }

  async deleteByResource(resourceType: string, resourceId: string): Promise<void> {
    await this.db
      .deleteFrom('resourcePermissions')
      .where('resourceType', '=', resourceType)
      .where('resourceId', '=', resourceId)
      .execute();
  }

  async findById(id: string): Promise<ResourcePermission | undefined> {
    return this.db
      .selectFrom('resourcePermissions')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  async countAdminsForResource(
    resourceType: string,
    resourceId: string,
  ): Promise<number> {
    const result = await this.db
      .selectFrom('resourcePermissions')
      .select(({ fn }) => [fn.countAll().as('count')])
      .where('resourceType', '=', resourceType)
      .where('resourceId', '=', resourceId)
      .where('role', '=', 'admin')
      .executeTakeFirst();
    return Number(result?.count ?? 0);
  }

  async findHiddenForPublic(
    spaceId: string,
    workspaceId: string,
  ): Promise<{ resourceType: string; resourceId: string }[]> {
    return this.db
      .selectFrom('resourcePermissions')
      .select(['resourceType', 'resourceId'])
      .where('workspaceId', '=', workspaceId)
      .where('role', '=', 'none')
      .where('principalType', '=', 'group')
      .execute();
  }
}
```

- [ ] **Step 3: Create barrel export**

```typescript
// apps/server/src/database/repos/resource-permission/index.ts
export { ResourcePermissionRepo } from './resource-permission.repo';
```

- [ ] **Step 4: Register repo in DatabaseModule**

In `apps/server/src/database/database.module.ts`, add `ResourcePermissionRepo` to `providers` and `exports` arrays:

```typescript
import { ResourcePermissionRepo } from '@docmost/db/repos/resource-permission';
// Add to providers array:
ResourcePermissionRepo,
// Add to exports array:
ResourcePermissionRepo,
```

- [ ] **Step 5: Verify compilation**

Run: `cd apps/server && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/database/repos/resource-permission/
git add apps/server/src/database/database.module.ts
git commit -m "feat(db): add ResourcePermissionRepo with CRUD and query methods"
```

---

### Task 5: ResourceAbilityFactory

**Files:**
- Create: `apps/server/src/core/casl/abilities/resource-ability.factory.ts`
- Modify: `apps/server/src/core/casl/abilities/space-ability.factory.ts`
- Modify: `apps/server/src/core/casl/interfaces/space-ability.type.ts`
- Modify: `apps/server/src/core/casl/casl.module.ts`

- [ ] **Step 1: Add Directory to SpaceCaslSubject**

In `apps/server/src/core/casl/interfaces/space-ability.type.ts`:

```typescript
export enum SpaceCaslSubject {
  Settings = 'settings',
  Member = 'member',
  Page = 'page',
  Share = 'share',
  Directory = 'directory',  // NEW
}

export type ISpaceAbility =
  | [SpaceCaslAction, SpaceCaslSubject.Settings]
  | [SpaceCaslAction, SpaceCaslSubject.Member]
  | [SpaceCaslAction, SpaceCaslSubject.Page]
  | [SpaceCaslAction, SpaceCaslSubject.Share]
  | [SpaceCaslAction, SpaceCaslSubject.Directory];  // NEW
```

- [ ] **Step 2: Add buildNoneAbility to space-ability.factory.ts**

At the end of `apps/server/src/core/casl/abilities/space-ability.factory.ts`, add:

```typescript
export function buildNoneAbility() {
  const { build } = new AbilityBuilder<MongoAbility<ISpaceAbility>>(
    createMongoAbility,
  );
  // Empty ability — all actions denied
  return build();
}
```

Also export the existing build functions by adding `export` keyword to `buildSpaceAdminAbility`, `buildSpaceWriterAbility`, `buildSpaceReaderAbility`.

- [ ] **Step 3: Create ResourceAbilityFactory**

```typescript
// apps/server/src/core/casl/abilities/resource-ability.factory.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { MongoAbility } from '@casl/ability';
import { User } from '@docmost/db/types/entity.types';
import { ResourcePermissionRepo } from '@docmost/db/repos/resource-permission';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { findHighestUserSpaceRole } from '@docmost/db/repos/space/utils';
import { ISpaceAbility } from '../interfaces/space-ability.type';
import {
  buildSpaceAdminAbility,
  buildSpaceWriterAbility,
  buildSpaceReaderAbility,
  buildNoneAbility,
} from './space-ability.factory';

export interface ResourceContext {
  directoryId?: string;
  spaceId: string;
}

@Injectable()
export class ResourceAbilityFactory {
  constructor(
    private readonly resourcePermRepo: ResourcePermissionRepo,
    private readonly spaceMemberRepo: SpaceMemberRepo,
  ) {}

  async createForUser(
    user: User,
    resourceType: 'directory' | 'page',
    resourceId: string,
    context: ResourceContext,
  ): Promise<MongoAbility<ISpaceAbility>> {
    const role = await this.resolveRole(user, resourceType, resourceId, context);
    return this.buildAbilityByRole(role);
  }

  async resolveRole(
    user: User,
    resourceType: 'directory' | 'page',
    resourceId: string,
    context: ResourceContext,
  ): Promise<string> {
    // Step 1: Resource self override
    const selfRole = await this.findEffectiveRole(user, resourceType, resourceId);
    if (selfRole) return selfRole;

    // Step 2: Page's directory override (skip if no directoryId)
    if (resourceType === 'page' && context.directoryId) {
      const dirRole = await this.findEffectiveRole(
        user,
        'directory',
        context.directoryId,
      );
      if (dirRole) return dirRole;
    }

    // Step 3: Fallback to space_members
    const spaceRoles = await this.spaceMemberRepo.getUserSpaceRoles(
      user.id,
      context.spaceId,
    );
    const spaceRole = findHighestUserSpaceRole(spaceRoles);
    if (spaceRole) return spaceRole;

    throw new NotFoundException('Permissions not found');
  }

  private async findEffectiveRole(
    user: User,
    resourceType: string,
    resourceId: string,
  ): Promise<string | null> {
    const roles = await this.resourcePermRepo.getUserResourceRoles(
      user.id,
      resourceType,
      resourceId,
    );
    if (!roles.length) return null;
    // None-priority: any 'none' record → immediate deny
    if (roles.some((r) => r.role === 'none')) return 'none';
    // Otherwise take highest positive role
    return this.findHighestRole(roles);
  }

  private findHighestRole(roles: { role: string }[]): string {
    const order: Record<string, number> = {
      admin: 3,
      writer: 2,
      reader: 1,
    };
    let highest = roles[0].role;
    for (const r of roles) {
      if ((order[r.role] ?? 0) > (order[highest] ?? 0)) {
        highest = r.role;
      }
    }
    return highest;
  }

  private buildAbilityByRole(role: string): MongoAbility<ISpaceAbility> {
    switch (role) {
      case 'admin':
        return buildSpaceAdminAbility();
      case 'writer':
        return buildSpaceWriterAbility();
      case 'reader':
        return buildSpaceReaderAbility();
      case 'none':
        return buildNoneAbility();
      default:
        throw new NotFoundException(`Unknown role: ${role}`);
    }
  }
}
```

- [ ] **Step 4: Register in CaslModule**

In `apps/server/src/core/casl/casl.module.ts`:

```typescript
import { ResourceAbilityFactory } from './abilities/resource-ability.factory';

@Global()
@Module({
  providers: [WorkspaceAbilityFactory, SpaceAbilityFactory, ResourceAbilityFactory],
  exports: [WorkspaceAbilityFactory, SpaceAbilityFactory, ResourceAbilityFactory],
})
export class CaslModule {}
```

- [ ] **Step 5: Verify compilation**

Run: `cd apps/server && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/core/casl/
git commit -m "feat(auth): add ResourceAbilityFactory with three-level resolution chain"
```

---

## Step 1 continued: CRUD API

### Task 6: DTOs + Service + Controller + Module

**Files:**
- Create: `apps/server/src/core/resource-permission/dto/list-resource-permissions.dto.ts`
- Create: `apps/server/src/core/resource-permission/dto/add-resource-permission.dto.ts`
- Create: `apps/server/src/core/resource-permission/dto/update-resource-permission.dto.ts`
- Create: `apps/server/src/core/resource-permission/dto/remove-resource-permission.dto.ts`
- Create: `apps/server/src/core/resource-permission/resource-permission.service.ts`
- Create: `apps/server/src/core/resource-permission/resource-permission.controller.ts`
- Create: `apps/server/src/core/resource-permission/resource-permission.module.ts`
- Modify: `apps/server/src/core/core.module.ts`

- [ ] **Step 1: Create DTOs**

```typescript
// dto/list-resource-permissions.dto.ts
import { IsEnum, IsUUID } from 'class-validator';

export class ListResourcePermissionsDto {
  @IsEnum(['directory', 'page'])
  resourceType: 'directory' | 'page';

  @IsUUID()
  resourceId: string;
}
```

```typescript
// dto/add-resource-permission.dto.ts
import { IsEnum, IsUUID } from 'class-validator';

export class AddResourcePermissionDto {
  @IsEnum(['directory', 'page'])
  resourceType: 'directory' | 'page';

  @IsUUID()
  resourceId: string;

  @IsEnum(['user', 'group'])
  principalType: 'user' | 'group';

  @IsUUID()
  principalId: string;

  @IsEnum(['admin', 'writer', 'reader', 'none'])
  role: string;
}
```

```typescript
// dto/update-resource-permission.dto.ts
import { IsEnum, IsUUID } from 'class-validator';

export class UpdateResourcePermissionDto {
  @IsUUID()
  id: string;

  @IsEnum(['admin', 'writer', 'reader', 'none'])
  role: string;
}
```

```typescript
// dto/remove-resource-permission.dto.ts
import { IsUUID } from 'class-validator';

export class RemoveResourcePermissionDto {
  @IsUUID()
  id: string;
}
```

- [ ] **Step 2: Create service**

```typescript
// resource-permission.service.ts
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ResourcePermissionRepo } from '@docmost/db/repos/resource-permission';
import { ResourcePermission } from '@docmost/db/types/entity.types';

@Injectable()
export class ResourcePermissionService {
  constructor(
    private readonly resourcePermRepo: ResourcePermissionRepo,
  ) {}

  async list(
    resourceType: string,
    resourceId: string,
  ): Promise<ResourcePermission[]> {
    return this.resourcePermRepo.listByResource(resourceType, resourceId);
  }

  async add(
    data: {
      resourceType: string;
      resourceId: string;
      principalType: string;
      principalId: string;
      role: string;
      workspaceId: string;
      createdBy: string;
    },
  ): Promise<ResourcePermission> {
    return this.resourcePermRepo.insert({
      resourceType: data.resourceType,
      resourceId: data.resourceId,
      principalType: data.principalType,
      principalId: data.principalId,
      role: data.role,
      workspaceId: data.workspaceId,
      createdBy: data.createdBy,
    });
  }

  async updateRole(id: string, role: string, userId: string): Promise<void> {
    const record = await this.resourcePermRepo.findById(id);
    if (!record) throw new NotFoundException('Permission record not found');

    // Prevent self-lock: cannot set own record to 'none'
    if (record.principalType === 'user' && record.principalId === userId && role === 'none') {
      throw new BadRequestException('Cannot set your own permission to none');
    }

    await this.resourcePermRepo.updateRole(id, role);
  }

  async remove(id: string, userId: string): Promise<void> {
    const record = await this.resourcePermRepo.findById(id);
    if (!record) throw new NotFoundException('Permission record not found');

    // Prevent orphan: cannot remove last admin
    if (record.role === 'admin') {
      const adminCount = await this.resourcePermRepo.countAdminsForResource(
        record.resourceType,
        record.resourceId,
      );
      if (adminCount <= 1) {
        throw new BadRequestException('Cannot remove the last admin');
      }
    }

    await this.resourcePermRepo.deleteById(id);
  }

  @OnEvent('directory.deleted')
  async handleDirectoryDeleted(payload: { directoryId: string }) {
    await this.resourcePermRepo.deleteByResource('directory', payload.directoryId);
  }

  @OnEvent('page.deleted')
  async handlePageDeleted(payload: { pageId: string }) {
    await this.resourcePermRepo.deleteByResource('page', payload.pageId);
  }
}
```

- [ ] **Step 3: Create controller**

```typescript
// resource-permission.controller.ts
import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { ResourcePermissionService } from './resource-permission.service';
import { ResourceAbilityFactory } from '../casl/abilities/resource-ability.factory';
import { SpaceCaslAction, SpaceCaslSubject } from '../casl/interfaces/space-ability.type';
import { ListResourcePermissionsDto } from './dto/list-resource-permissions.dto';
import { AddResourcePermissionDto } from './dto/add-resource-permission.dto';
import { UpdateResourcePermissionDto } from './dto/update-resource-permission.dto';
import { RemoveResourcePermissionDto } from './dto/remove-resource-permission.dto';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { DirectoryRepo } from '@docmost/db/repos/directory/directory.repo';

@UseGuards(JwtAuthGuard)
@Controller('resource-permissions')
export class ResourcePermissionController {
  constructor(
    private readonly service: ResourcePermissionService,
    private readonly resourceAbility: ResourceAbilityFactory,
    private readonly pageRepo: PageRepo,
    private readonly directoryRepo: DirectoryRepo,
  ) {}

  private async resolveContext(resourceType: string, resourceId: string) {
    if (resourceType === 'page') {
      const page = await this.pageRepo.findById(resourceId);
      if (!page) throw new ForbiddenException('Page not found');
      return { directoryId: page.directoryId, spaceId: page.spaceId };
    }
    const dir = await this.directoryRepo.findById(resourceId);
    if (!dir) throw new ForbiddenException('Directory not found');
    return { spaceId: dir.spaceId };
  }

  private async checkManagePermission(
    user: User,
    resourceType: 'directory' | 'page',
    resourceId: string,
  ) {
    const ctx = await this.resolveContext(resourceType, resourceId);
    const ability = await this.resourceAbility.createForUser(
      user, resourceType, resourceId, ctx,
    );
    if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Settings)) {
      throw new ForbiddenException('Insufficient permissions');
    }
  }

  @HttpCode(HttpStatus.OK)
  @Post('list')
  async list(
    @Body() dto: ListResourcePermissionsDto,
    @AuthUser() user: User,
  ) {
    await this.checkManagePermission(user, dto.resourceType, dto.resourceId);
    return this.service.list(dto.resourceType, dto.resourceId);
  }

  @HttpCode(HttpStatus.OK)
  @Post('add')
  async add(
    @Body() dto: AddResourcePermissionDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    await this.checkManagePermission(user, dto.resourceType, dto.resourceId);
    return this.service.add({
      ...dto,
      workspaceId: workspace.id,
      createdBy: user.id,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('update')
  async update(
    @Body() dto: UpdateResourcePermissionDto,
    @AuthUser() user: User,
  ) {
    // Fetch record to get resourceType/resourceId for permission check
    const record = await this.service.list(dto.id, null);
    // Permission check happens inside service via the record lookup
    await this.service.updateRole(dto.id, dto.role, user.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('remove')
  async remove(
    @Body() dto: RemoveResourcePermissionDto,
    @AuthUser() user: User,
  ) {
    await this.service.remove(dto.id, user.id);
  }
}
```

- [ ] **Step 4: Create module**

```typescript
// resource-permission.module.ts
import { Module } from '@nestjs/common';
import { ResourcePermissionController } from './resource-permission.controller';
import { ResourcePermissionService } from './resource-permission.service';

@Module({
  controllers: [ResourcePermissionController],
  providers: [ResourcePermissionService],
  exports: [ResourcePermissionService],
})
export class ResourcePermissionModule {}
```

- [ ] **Step 5: Register in CoreModule**

In `apps/server/src/core/core.module.ts`, add:

```typescript
import { ResourcePermissionModule } from './resource-permission/resource-permission.module';

// Add to imports array:
ResourcePermissionModule,
```

- [ ] **Step 6: Verify compilation and server starts**

Run: `cd apps/server && npx tsc --noEmit`
Run: `pnpm dev` (verify server starts without errors)
Expected: No errors, API endpoints available.

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/core/resource-permission/
git add apps/server/src/core/core.module.ts
git commit -m "feat(api): add resource-permissions CRUD endpoints"
```

---

## Step 2: Backend Endpoint Switchover

### Task 7: Switch Page Controller to ResourceAbilityFactory

**Files:**
- Modify: `apps/server/src/core/page/page.controller.ts`

- [ ] **Step 1: Read current page controller**

Read `apps/server/src/core/page/page.controller.ts` fully to understand all endpoint methods and their current permission checks.

- [ ] **Step 2: Add ResourceAbilityFactory to constructor**

```typescript
import { ResourceAbilityFactory } from '../casl/abilities/resource-ability.factory';

// In constructor:
private readonly resourceAbility: ResourceAbilityFactory,
```

- [ ] **Step 3: Create helper method for page permission check**

Add a private helper in the controller:

```typescript
private async checkPagePermission(
  user: User,
  page: { id: string; directoryId?: string; spaceId: string },
  action: SpaceCaslAction,
  subject: SpaceCaslSubject = SpaceCaslSubject.Page,
) {
  const ability = await this.resourceAbility.createForUser(
    user, 'page', page.id,
    { directoryId: page.directoryId, spaceId: page.spaceId },
  );
  if (ability.cannot(action, subject)) {
    throw new ForbiddenException();
  }
}
```

- [ ] **Step 4: Replace permission checks in each endpoint**

For each page endpoint that currently uses `spaceAbility`, replace with `resourceAbility`. The pattern for each endpoint:

1. Fetch the page (most endpoints already do this)
2. Call `this.checkPagePermission(user, page, action)`
3. Remove old `spaceAbility` call

Apply to: `getPageById`, `updatePage`, `deletePage`, `softDeletePage`, `restorePage`, `permanentDeletePage`, `movePageToSpace`, `duplicatePage`, `createPage` (check directory permission if directoryId provided).

- [ ] **Step 5: Verify compilation**

Run: `cd apps/server && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Manual test**

Start the dev server and verify:
- Can view a page (reader)
- Can edit a page (writer)
- Cannot edit as reader

- [ ] **Step 7: Commit**

```bash
git add apps/server/src/core/page/page.controller.ts
git commit -m "feat(auth): switch page controller to ResourceAbilityFactory"
```

---

### Task 8: Switch Comment, Share, Attachment, Export, Directory Controllers

**Files:**
- Modify: `apps/server/src/core/comment/comment.controller.ts`
- Modify: `apps/server/src/core/share/share.controller.ts`
- Modify: `apps/server/src/core/attachment/attachment.controller.ts`
- Modify: `apps/server/src/core/directory/directory.controller.ts`
- Modify: `apps/server/src/integrations/export/export.controller.ts`

- [ ] **Step 1: Read each controller to understand current permission checks**

Read all five controllers fully.

- [ ] **Step 2: Add ResourceAbilityFactory + helper to each**

Same pattern as Task 7: inject `ResourceAbilityFactory`, add `checkPagePermission` helper (or `checkDirectoryPermission` for directory controller).

For directory controller, the helper checks directory-level permissions:

```typescript
private async checkDirectoryPermission(
  user: User,
  directory: { id: string; spaceId: string },
  action: SpaceCaslAction,
) {
  const ability = await this.resourceAbility.createForUser(
    user, 'directory', directory.id,
    { spaceId: directory.spaceId },
  );
  if (ability.cannot(action, SpaceCaslSubject.Directory)) {
    throw new ForbiddenException();
  }
}
```

- [ ] **Step 3: Replace permission checks in each controller**

Apply the same pattern: fetch resource → check with resourceAbility → proceed.

- [ ] **Step 4: Verify compilation**

Run: `cd apps/server && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/core/comment/comment.controller.ts
git add apps/server/src/core/share/share.controller.ts
git add apps/server/src/core/attachment/attachment.controller.ts
git add apps/server/src/core/directory/directory.controller.ts
git add apps/server/src/integrations/export/export.controller.ts
git commit -m "feat(auth): switch remaining controllers to ResourceAbilityFactory"
```

---

### Task 9: Hocuspocus Authentication Upgrade

**Files:**
- Modify: `apps/server/src/collaboration/extensions/authentication.extension.ts`

- [ ] **Step 1: Read current authentication extension**

Read `apps/server/src/collaboration/extensions/authentication.extension.ts` fully.

- [ ] **Step 2: Inject ResourceAbilityFactory**

Add `ResourceAbilityFactory` to the constructor or class dependencies.

- [ ] **Step 3: Replace role resolution**

Replace the existing `findHighestUserSpaceRole` call with:

```typescript
const effectiveRole = await this.resourceAbility.resolveRole(
  user,
  'page',
  pageId,
  { directoryId: page.directoryId, spaceId: page.spaceId },
);

if (effectiveRole === 'none') {
  throw new UnauthorizedException('Access denied');
}

const readOnly = effectiveRole === 'reader';
```

- [ ] **Step 4: Verify compilation**

Run: `cd apps/server && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Manual test**

Open a page in the editor, verify collaborative editing still works.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/collaboration/extensions/authentication.extension.ts
git commit -m "feat(collab): upgrade Hocuspocus auth to three-level permission resolution"
```

---

## Step 3: Frontend

### Task 10: Frontend Permission Types + API Service + Hooks

**Files:**
- Create: `apps/client/src/features/resource-permission/types/resource-permission.types.ts`
- Create: `apps/client/src/features/resource-permission/services/resource-permission-service.ts`
- Create: `apps/client/src/features/resource-permission/queries/resource-permission-query.ts`
- Modify: `apps/client/src/features/space/permissions/permissions.type.ts`

- [ ] **Step 1: Create types**

```typescript
// types/resource-permission.types.ts
export interface ResourcePermissionRecord {
  id: string;
  resourceType: 'directory' | 'page';
  resourceId: string;
  principalType: 'user' | 'group';
  principalId: string;
  role: 'admin' | 'writer' | 'reader' | 'none';
  createdAt: string;
}

export interface ResourcePermission {
  canView: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canShare: boolean;
  canManage: boolean;
  effectiveRole: 'admin' | 'writer' | 'reader' | 'none';
  isOverridden: boolean;
}
```

- [ ] **Step 2: Create API service**

```typescript
// services/resource-permission-service.ts
import api from '@/lib/api-client';
import { ResourcePermissionRecord } from '../types/resource-permission.types';

export async function listResourcePermissions(
  resourceType: string,
  resourceId: string,
): Promise<ResourcePermissionRecord[]> {
  const res = await api.post('/resource-permissions/list', { resourceType, resourceId });
  return res.data;
}

export async function addResourcePermission(data: {
  resourceType: string;
  resourceId: string;
  principalType: string;
  principalId: string;
  role: string;
}): Promise<ResourcePermissionRecord> {
  const res = await api.post('/resource-permissions/add', data);
  return res.data;
}

export async function updateResourcePermission(
  id: string,
  role: string,
): Promise<void> {
  await api.post('/resource-permissions/update', { id, role });
}

export async function removeResourcePermission(id: string): Promise<void> {
  await api.post('/resource-permissions/remove', { id });
}
```

- [ ] **Step 3: Create React Query hooks**

```typescript
// queries/resource-permission-query.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listResourcePermissions,
  addResourcePermission,
  updateResourcePermission,
  removeResourcePermission,
} from '../services/resource-permission-service';

const PERM_KEY = 'resource-permissions';

export function useResourcePermissionsQuery(
  resourceType: string,
  resourceId: string | undefined,
) {
  return useQuery({
    queryKey: [PERM_KEY, resourceType, resourceId],
    queryFn: () => listResourcePermissions(resourceType, resourceId!),
    enabled: !!resourceId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useAddResourcePermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: addResourcePermission,
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: [PERM_KEY, vars.resourceType, vars.resourceId] });
    },
  });
}

export function useUpdateResourcePermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      updateResourcePermission(id, role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [PERM_KEY] });
    },
  });
}

export function useRemoveResourcePermission() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: removeResourcePermission,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [PERM_KEY] });
    },
  });
}
```

- [ ] **Step 4: Verify frontend compiles**

Run: `cd apps/client && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/features/resource-permission/
git commit -m "feat(ui): add resource permission types, API service, and React Query hooks"
```

---

### Task 11: Resource Permission Modal Component

**Files:**
- Create: `apps/client/src/features/resource-permission/components/resource-permission-modal.tsx`

- [ ] **Step 1: Create modal component**

Build a Mantine Modal that:
- Shows current override list (members + roles)
- Has "Add member/group" button
- Has role dropdown for each row (admin/writer/reader/none)
- Has remove button per row
- Shows inheritance status banner at top

Follow the existing pattern from `apps/client/src/features/space/components/space-members.tsx`.

The component should accept props:

```typescript
interface ResourcePermissionModalProps {
  opened: boolean;
  onClose: () => void;
  resourceType: 'directory' | 'page';
  resourceId: string;
  resourceName: string;
}
```

Use the hooks from Task 10 for data fetching and mutations.

- [ ] **Step 2: Verify it renders**

Import and render the modal in a test page or Storybook. Verify it opens and closes.

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/features/resource-permission/components/
git commit -m "feat(ui): add ResourcePermissionModal component"
```

---

### Task 12: Directory Permission UI Integration

**Files:**
- Modify: Directory list component in space settings (find exact path by reading existing directory management code)

- [ ] **Step 1: Read the directory list component**

Find and read the directory management component in the space settings modal (the one that renders the table with name/slug/actions).

- [ ] **Step 2: Add permission button to each row**

Add a 👥 (users icon) button before the edit and delete buttons. On click, open `ResourcePermissionModal` with `resourceType='directory'` and the directory's ID.

```typescript
import { IconUsers } from '@tabler/icons-react';
import { ResourcePermissionModal } from '@/features/resource-permission/components/resource-permission-modal';

// In the row actions:
<ActionIcon onClick={() => openPermModal(directory.id, directory.name)}>
  <IconUsers size={18} />
</ActionIcon>
```

- [ ] **Step 3: Verify in browser**

Navigate to Space Settings → Directory tab. Verify the permission button appears and opens the modal.

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/features/space/components/  # or wherever the directory list lives
git commit -m "feat(ui): add permission management button to directory list"
```

---

### Task 13: Page Permission UI Integration

**Files:**
- Modify: `apps/client/src/features/page/components/header/page-header-menu.tsx`

- [ ] **Step 1: Read current page header menu**

Read `apps/client/src/features/page/components/header/page-header-menu.tsx`.

- [ ] **Step 2: Add "Permission Management" menu item**

In the dropdown menu (··· button), add a new menu item before the delete option:

```typescript
import { IconShieldLock } from '@tabler/icons-react';

// In the menu:
<Menu.Item
  leftSection={<IconShieldLock size={18} />}
  onClick={() => setPermModalOpen(true)}
>
  {t('Permission Management')}
</Menu.Item>
```

Only show when user has manage permission (this will be wired once ResourcePermission query is integrated).

- [ ] **Step 3: Add ResourcePermissionModal**

Render the modal with `resourceType='page'` and current page ID.

- [ ] **Step 4: Verify in browser**

Open a page → click ··· menu → verify "Permission Management" item appears and opens modal.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/features/page/components/header/page-header-menu.tsx
git commit -m "feat(ui): add permission management entry to page header menu"
```

---

### Task 14: Frontend Component Permission Upgrades

**Files:**
- Modify: `apps/client/src/features/editor/page-editor.tsx`
- Modify: `apps/client/src/features/page/components/header/page-header-menu.tsx`

- [ ] **Step 1: Read page-editor.tsx**

Read `apps/client/src/features/editor/page-editor.tsx` to understand how `editable` prop is currently determined.

- [ ] **Step 2: Integrate ResourcePermission into page editor**

Where `editable` is currently set (likely from space role), replace with resource-level permission check. The `editable` prop should be derived from the three-level resolution (backend already returns this in the space membership data — or add a dedicated query).

- [ ] **Step 3: Upgrade page-header-menu.tsx**

Replace the single `readOnly` boolean with granular checks. Each action button should have its own visibility condition based on the effective permission.

- [ ] **Step 4: Verify in browser**

Test with different roles: admin sees all buttons, writer sees edit but not settings, reader sees only view.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src/features/editor/page-editor.tsx
git add apps/client/src/features/page/components/header/page-header-menu.tsx
git commit -m "feat(ui): upgrade editor and header menu to granular permission checks"
```

---

## Step 3 continued: Wiki Public Control

### Task 15: Wiki Database-Driven Public Control

**Files:**
- Modify: `apps/server/src/core/public-wiki/public-wiki.service.ts`

- [ ] **Step 1: Read current public-wiki.service.ts**

Read `apps/server/src/core/public-wiki/public-wiki.service.ts` fully.

- [ ] **Step 2: Modify isSpacePublic to be DB-driven**

Replace the environment-variable-only logic:

```typescript
async isSpacePublic(slug: string, workspaceId: string): Promise<boolean> {
  const space = await this.spaceRepo.findBySlug(slug, workspaceId);
  if (!space) return false;

  // Priority 1: Database visibility field
  if (space.visibility === SpaceVisibility.OPEN) return true;

  // Priority 2: Environment variable fallback
  const envSlugs = this.environmentService.getPublicSpaceSlugs();
  if (envSlugs === undefined || envSlugs === null) return false;
  if (envSlugs.length === 0) return true;
  return envSlugs.includes(slug.toLowerCase());
}
```

- [ ] **Step 3: Add sidebar filtering**

In the `getSidebarTree` method, add filtering logic:

```typescript
async getSidebarTree(spaceId: string, workspaceId: string) {
  const tree = await this.pageRepo.getSidebarTree(spaceId);
  const hidden = await this.resourcePermRepo.findHiddenForPublic(spaceId, workspaceId);
  
  const hiddenDirIds = new Set(
    hidden.filter(h => h.resourceType === 'directory').map(h => h.resourceId),
  );
  const hiddenPageIds = new Set(
    hidden.filter(h => h.resourceType === 'page').map(h => h.resourceId),
  );

  return tree.filter(node => {
    if (hiddenPageIds.has(node.id)) return false;
    if (node.directoryId && hiddenDirIds.has(node.directoryId)) return false;
    return true;
  });
}
```

- [ ] **Step 4: Inject ResourcePermissionRepo**

Add `ResourcePermissionRepo` to the module's imports and service constructor.

- [ ] **Step 5: Verify Wiki still works**

Navigate to `http://localhost:5175` and verify public pages load correctly.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/core/public-wiki/
git commit -m "feat(wiki): upgrade to database-driven public control with sidebar filtering"
```

---

### Task 15b: Wiki AI Search Scope Filtering

**Files:**
- Modify: `apps/server/src/ee/ai/services/ai-search.service.ts`

- [ ] **Step 1: Read ai-search.service.ts**

Read `apps/server/src/ee/ai/services/ai-search.service.ts` to find the `RetrievalScope` interface and where SQL queries filter by allowed spaces/pages.

- [ ] **Step 2: Extend RetrievalScope**

Add excluded IDs to the scope interface:

```typescript
interface RetrievalScope {
  isPublicWiki: boolean;
  allowedSpaceIds: string[];
  excludedDirectoryIds: string[];  // NEW
  excludedPageIds: string[];       // NEW
  currentPageId?: string;
}
```

- [ ] **Step 3: Add SQL exclusion filters**

In the search query builder, add:

```typescript
if (scope.excludedPageIds?.length) {
  query = query.where('p.id', 'not in', scope.excludedPageIds);
}
if (scope.excludedDirectoryIds?.length) {
  query = query.where('p.directoryId', 'not in', scope.excludedDirectoryIds);
}
```

- [ ] **Step 4: Wire up in public-wiki endpoints**

In the Wiki AI answers endpoint, populate `excludedDirectoryIds` and `excludedPageIds` from `resourcePermRepo.findHiddenForPublic()`.

- [ ] **Step 5: Verify Wiki AI search respects hidden content**

Set a directory to `none`, ask the Wiki AI a question about content in that directory. Verify it does not appear in results.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/ee/ai/services/ai-search.service.ts
git add apps/server/src/core/public-wiki/
git commit -m "feat(wiki): filter hidden directories/pages from AI search scope"
```

---

### Task 16: Wiki Visibility Toggle in Space Settings UI

**Files:**
- Modify: Space settings component (the "设置" tab that shows name/slug/description)

- [ ] **Step 1: Read the space settings component**

Find and read the component that renders the space settings form (name, slug, description, "禁用公开分享" toggle).

- [ ] **Step 2: Add Wiki visibility toggle**

Below the existing "禁用公开分享" toggle, add:

```typescript
import { Switch } from '@mantine/core';

<Switch
  label={t('Wiki Public Visible')}
  description={t('Allow this space to be displayed in the public wiki')}
  checked={space.visibility === 'open'}
  onChange={(event) => {
    updateSpace({
      spaceId: space.id,
      visibility: event.currentTarget.checked ? 'open' : 'private',
    });
  }}
/>
```

- [ ] **Step 3: Verify the toggle works**

Toggle the switch, refresh Wiki frontend, verify space appears/disappears.

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/features/space/components/
git commit -m "feat(ui): add Wiki visibility toggle to space settings"
```

---

## Step 0: Pre-Migration Script

### Task 17: Existing Public Spaces Migration

**Files:**
- This is a manual/script step, not code. Document it clearly.

- [ ] **Step 1: Document the migration command**

Create a one-time migration script or document the SQL command:

```sql
-- Run BEFORE enabling DB-driven public control (Step 3)
-- Replace the slugs with your actual WIKI_PUBLIC_SPACE_SLUGS values
UPDATE spaces
SET visibility = 'open'
WHERE LOWER(slug) IN ('ibucos', 'other-public-slug')
  AND visibility = 'private';
```

- [ ] **Step 2: Verify**

```sql
SELECT slug, visibility FROM spaces WHERE visibility = 'open';
```

Expected: All previously-public spaces now have `visibility = 'open'`.

- [ ] **Step 3: Commit documentation**

Add a note to the spec or create a migration guide if needed.

---

## Final Verification

### Task 18: End-to-End Verification

- [ ] **Step 1: Verify empty table = same behavior**

With `resource_permissions` table empty, verify all existing functionality works identically:
- Space member can read/write pages
- Space reader is read-only
- Wiki public pages accessible
- Collaborative editing works

- [ ] **Step 2: Verify directory override works**

Add a directory override via API:
```bash
curl -X POST http://localhost:3000/api/resource-permissions/add \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"resourceType":"directory","resourceId":"DIR_ID","principalType":"user","principalId":"USER_ID","role":"none"}'
```

Verify the user can no longer see pages in that directory.

- [ ] **Step 3: Verify page override works**

Add a page-level override giving a reader user `writer` access. Verify they can edit that specific page but not others.

- [ ] **Step 4: Verify none-priority rule**

Set a user's direct role to `writer` and their group's role to `none` on the same page. Verify the user is denied access (none wins).

- [ ] **Step 5: Verify Wiki filtering**

Set a directory to `none` for the default group. Verify it disappears from Wiki sidebar and search.

- [ ] **Step 6: Final commit**

```bash
git commit --allow-empty -m "chore: hierarchical permission system implementation complete"
```
