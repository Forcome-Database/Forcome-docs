import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { ApiKeys } from '@docmost/db/types/db';
import {
  ApiKey,
  InsertableApiKey,
  UpdatableApiKey,
} from '@docmost/db/types/entity.types';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import {
  executeWithCursorPagination,
  CursorPaginationResult,
} from '@docmost/db/pagination/cursor-pagination';
import { jsonObjectFrom } from 'kysely/helpers/postgres';

@Injectable()
export class ApiKeyRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  private baseFields: Array<keyof ApiKeys> = [
    'id',
    'name',
    'creatorId',
    'workspaceId',
    'expiresAt',
    'lastUsedAt',
    'createdAt',
    'updatedAt',
    'deletedAt',
  ];

  async findById(
    id: string,
    workspaceId: string,
  ): Promise<ApiKey | undefined> {
    return this.db
      .selectFrom('apiKeys')
      .select(this.baseFields)
      .where('id', '=', id)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();
  }

  async findByWorkspaceId(
    workspaceId: string,
    pagination: PaginationOptions,
  ): Promise<CursorPaginationResult<any>> {
    const query = this.db
      .selectFrom('apiKeys')
      .select(this.baseFields)
      .select((eb) => [
        jsonObjectFrom(
          eb
            .selectFrom('users')
            .select(['users.id', 'users.name', 'users.avatarUrl'])
            .whereRef('users.id', '=', 'apiKeys.creatorId'),
        ).as('creator'),
      ])
      .where('apiKeys.workspaceId', '=', workspaceId)
      .where('apiKeys.deletedAt', 'is', null);

    return executeWithCursorPagination(query, {
      perPage: pagination.limit,
      cursor: pagination.cursor,
      beforeCursor: pagination.beforeCursor,
      fields: [{ expression: 'apiKeys.createdAt', direction: 'desc', key: 'createdAt' }],
      parseCursor: (cursor) => ({
        createdAt: new Date(cursor.createdAt),
      }),
    });
  }

  async findByCreatorId(
    creatorId: string,
    workspaceId: string,
    pagination: PaginationOptions,
  ): Promise<CursorPaginationResult<any>> {
    const query = this.db
      .selectFrom('apiKeys')
      .select(this.baseFields)
      .select((eb) => [
        jsonObjectFrom(
          eb
            .selectFrom('users')
            .select(['users.id', 'users.name', 'users.avatarUrl'])
            .whereRef('users.id', '=', 'apiKeys.creatorId'),
        ).as('creator'),
      ])
      .where('apiKeys.workspaceId', '=', workspaceId)
      .where('apiKeys.creatorId', '=', creatorId)
      .where('apiKeys.deletedAt', 'is', null);

    return executeWithCursorPagination(query, {
      perPage: pagination.limit,
      cursor: pagination.cursor,
      beforeCursor: pagination.beforeCursor,
      fields: [{ expression: 'apiKeys.createdAt', direction: 'desc', key: 'createdAt' }],
      parseCursor: (cursor) => ({
        createdAt: new Date(cursor.createdAt),
      }),
    });
  }

  async insertApiKey(data: InsertableApiKey): Promise<ApiKey> {
    return this.db
      .insertInto('apiKeys')
      .values(data)
      .returning(this.baseFields)
      .executeTakeFirst();
  }

  async updateApiKey(
    id: string,
    workspaceId: string,
    data: UpdatableApiKey,
  ): Promise<ApiKey> {
    return this.db
      .updateTable('apiKeys')
      .set({ ...data, updatedAt: new Date() })
      .where('id', '=', id)
      .where('workspaceId', '=', workspaceId)
      .returning(this.baseFields)
      .executeTakeFirst();
  }

  async softDelete(id: string, workspaceId: string): Promise<void> {
    await this.db
      .updateTable('apiKeys')
      .set({ deletedAt: new Date() })
      .where('id', '=', id)
      .where('workspaceId', '=', workspaceId)
      .execute();
  }

  async updateLastUsedAt(id: string): Promise<void> {
    await this.db
      .updateTable('apiKeys')
      .set({ lastUsedAt: new Date() })
      .where('id', '=', id)
      .execute();
  }
}
