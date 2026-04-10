import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
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
          .select([
            'groupUsers.userId as principalId',
            'resourcePermissions.role',
          ])
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
  ): Promise<(ResourcePermission & { principalName: string | null; principalEmail: string | null; principalAvatarUrl: string | null })[]> {
    return this.db
      .selectFrom('resourcePermissions')
      .leftJoin('users', (join) =>
        join
          .onRef('users.id', '=', 'resourcePermissions.principalId')
          .on('resourcePermissions.principalType', '=', 'user'),
      )
      .leftJoin('groups', (join) =>
        join
          .onRef('groups.id', '=', 'resourcePermissions.principalId')
          .on('resourcePermissions.principalType', '=', 'group'),
      )
      .select([
        'resourcePermissions.id',
        'resourcePermissions.resourceType',
        'resourcePermissions.resourceId',
        'resourcePermissions.principalType',
        'resourcePermissions.principalId',
        'resourcePermissions.role',
        'resourcePermissions.workspaceId',
        'resourcePermissions.createdBy',
        'resourcePermissions.createdAt',
        'resourcePermissions.updatedAt',
        (eb) =>
          eb
            .case()
            .when('resourcePermissions.principalType', '=', 'user')
            .then(eb.ref('users.name'))
            .when('resourcePermissions.principalType', '=', 'group')
            .then(eb.ref('groups.name'))
            .else(eb.val(null))
            .end()
            .as('principalName'),
        (eb) =>
          eb
            .case()
            .when('resourcePermissions.principalType', '=', 'user')
            .then(eb.ref('users.email'))
            .else(eb.val(null))
            .end()
            .as('principalEmail'),
        (eb) =>
          eb
            .case()
            .when('resourcePermissions.principalType', '=', 'user')
            .then(eb.ref('users.avatarUrl'))
            .else(eb.val(null))
            .end()
            .as('principalAvatarUrl'),
      ])
      .where('resourcePermissions.resourceType', '=', resourceType)
      .where('resourcePermissions.resourceId', '=', resourceId)
      .orderBy('resourcePermissions.createdAt', 'asc')
      .execute();
  }

  async insert(
    data: InsertableResourcePermission,
  ): Promise<ResourcePermission> {
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

  async deleteByResource(
    resourceType: string,
    resourceId: string,
  ): Promise<void> {
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

  /**
   * Get all resource permission overrides a user has within a given space.
   * Includes both direct user permissions and permissions via group membership.
   * Used for efficient sidebar filtering when space role is 'none'.
   */
  async getUserOverridesInSpace(
    userId: string,
    spaceId: string,
    workspaceId: string,
  ): Promise<{
    resourceType: string;
    resourceId: string;
    role: string;
    directoryId: string | null;
    topicId: string | null;
  }[]> {
    // Direct user overrides on directories in this space
    const dirUserOverrides = this.db
      .selectFrom('resourcePermissions')
      .innerJoin('directories', 'directories.id', 'resourcePermissions.resourceId')
      .select([
        'resourcePermissions.resourceType',
        'resourcePermissions.resourceId',
        'resourcePermissions.role',
        sql<string | null>`null::uuid`.as('directoryId'),
        sql<string | null>`null::uuid`.as('topicId'),
      ])
      .where('resourcePermissions.workspaceId', '=', workspaceId)
      .where('resourcePermissions.principalType', '=', 'user')
      .where('resourcePermissions.principalId', '=', userId)
      .where('resourcePermissions.resourceType', '=', 'directory')
      .where('directories.spaceId', '=', spaceId);

    // Group overrides on directories in this space
    const dirGroupOverrides = this.db
      .selectFrom('resourcePermissions')
      .innerJoin('directories', 'directories.id', 'resourcePermissions.resourceId')
      .innerJoin('groupUsers', 'groupUsers.groupId', 'resourcePermissions.principalId')
      .select([
        'resourcePermissions.resourceType',
        'resourcePermissions.resourceId',
        'resourcePermissions.role',
        sql<string | null>`null::uuid`.as('directoryId'),
        sql<string | null>`null::uuid`.as('topicId'),
      ])
      .where('resourcePermissions.workspaceId', '=', workspaceId)
      .where('resourcePermissions.principalType', '=', 'group')
      .where('resourcePermissions.resourceType', '=', 'directory')
      .where('groupUsers.userId', '=', userId)
      .where('directories.spaceId', '=', spaceId);

    // Direct user overrides on pages in this space (include parent directoryId + topicId)
    const pageUserOverrides = this.db
      .selectFrom('resourcePermissions')
      .innerJoin('pages', 'pages.id', 'resourcePermissions.resourceId')
      .select([
        'resourcePermissions.resourceType',
        'resourcePermissions.resourceId',
        'resourcePermissions.role',
        'pages.directoryId',
        'pages.topicId',
      ])
      .where('resourcePermissions.workspaceId', '=', workspaceId)
      .where('resourcePermissions.principalType', '=', 'user')
      .where('resourcePermissions.principalId', '=', userId)
      .where('resourcePermissions.resourceType', '=', 'page')
      .where('pages.spaceId', '=', spaceId);

    // Group overrides on pages in this space
    const pageGroupOverrides = this.db
      .selectFrom('resourcePermissions')
      .innerJoin('pages', 'pages.id', 'resourcePermissions.resourceId')
      .innerJoin('groupUsers', 'groupUsers.groupId', 'resourcePermissions.principalId')
      .select([
        'resourcePermissions.resourceType',
        'resourcePermissions.resourceId',
        'resourcePermissions.role',
        'pages.directoryId',
        'pages.topicId',
      ])
      .where('resourcePermissions.workspaceId', '=', workspaceId)
      .where('resourcePermissions.principalType', '=', 'group')
      .where('resourcePermissions.resourceType', '=', 'page')
      .where('groupUsers.userId', '=', userId)
      .where('pages.spaceId', '=', spaceId);

    return dirUserOverrides
      .unionAll(dirGroupOverrides)
      .unionAll(pageUserOverrides)
      .unionAll(pageGroupOverrides)
      .execute();
  }

  /**
   * Delete all resource permissions for a principal within a space.
   * Uses select+delete pattern for Kysely compatibility.
   */
  async deleteByPrincipalInSpace(
    principalType: 'user' | 'group',
    principalId: string,
    spaceId: string,
    workspaceId: string,
  ): Promise<void> {
    const dirPerms = await this.db
      .selectFrom('resourcePermissions')
      .innerJoin('directories', 'directories.id', 'resourcePermissions.resourceId')
      .select('resourcePermissions.id')
      .where('resourcePermissions.principalType', '=', principalType)
      .where('resourcePermissions.principalId', '=', principalId)
      .where('resourcePermissions.workspaceId', '=', workspaceId)
      .where('resourcePermissions.resourceType', '=', 'directory')
      .where('directories.spaceId', '=', spaceId)
      .execute();

    const pagePerms = await this.db
      .selectFrom('resourcePermissions')
      .innerJoin('pages', 'pages.id', 'resourcePermissions.resourceId')
      .select('resourcePermissions.id')
      .where('resourcePermissions.principalType', '=', principalType)
      .where('resourcePermissions.principalId', '=', principalId)
      .where('resourcePermissions.workspaceId', '=', workspaceId)
      .where('resourcePermissions.resourceType', '=', 'page')
      .where('pages.spaceId', '=', spaceId)
      .execute();

    const idsToDelete = [
      ...dirPerms.map((r) => r.id),
      ...pagePerms.map((r) => r.id),
    ];

    if (idsToDelete.length > 0) {
      await this.db
        .deleteFrom('resourcePermissions')
        .where('id', 'in', idsToDelete)
        .execute();
    }
  }

  /**
   * Delete all resource permissions for a principal across the workspace.
   */
  async deleteByPrincipalInWorkspace(
    principalType: 'user' | 'group',
    principalId: string,
    workspaceId: string,
  ): Promise<void> {
    await this.db
      .deleteFrom('resourcePermissions')
      .where('principalType', '=', principalType)
      .where('principalId', '=', principalId)
      .where('workspaceId', '=', workspaceId)
      .execute();
  }

  async findHiddenForPublic(
    spaceId: string,
    workspaceId: string,
  ): Promise<{ resourceType: string; resourceId: string }[]> {
    const dirNone = this.db
      .selectFrom('resourcePermissions')
      .innerJoin('directories', 'directories.id', 'resourcePermissions.resourceId')
      .select(['resourcePermissions.resourceType', 'resourcePermissions.resourceId'])
      .where('resourcePermissions.workspaceId', '=', workspaceId)
      .where('resourcePermissions.role', '=', 'none')
      .where('resourcePermissions.principalType', '=', 'group')
      .where('resourcePermissions.resourceType', '=', 'directory')
      .where('directories.spaceId', '=', spaceId);

    const pageNone = this.db
      .selectFrom('resourcePermissions')
      .innerJoin('pages', 'pages.id', 'resourcePermissions.resourceId')
      .select(['resourcePermissions.resourceType', 'resourcePermissions.resourceId'])
      .where('resourcePermissions.workspaceId', '=', workspaceId)
      .where('resourcePermissions.role', '=', 'none')
      .where('resourcePermissions.principalType', '=', 'group')
      .where('resourcePermissions.resourceType', '=', 'page')
      .where('pages.spaceId', '=', spaceId);

    return dirNone.unionAll(pageNone).execute();
  }
}
