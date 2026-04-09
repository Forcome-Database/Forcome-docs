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
  ): Promise<ResourcePermission[]> {
    return this.db
      .selectFrom('resourcePermissions')
      .selectAll()
      .where('resourceType', '=', resourceType)
      .where('resourceId', '=', resourceId)
      .orderBy('createdAt', 'asc')
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
