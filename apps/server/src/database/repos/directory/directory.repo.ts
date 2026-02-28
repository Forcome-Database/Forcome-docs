import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';
import {
  Directory,
  InsertableDirectory,
  UpdatableDirectory,
} from '@docmost/db/types/entity.types';
import { sql } from 'kysely';
import { PaginationOptions } from '../../pagination/pagination-options';
import { executeWithCursorPagination } from '@docmost/db/pagination/cursor-pagination';
import { validate as isValidUUID } from 'uuid';

@Injectable()
export class DirectoryRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async findById(
    directoryId: string,
    workspaceId: string,
    opts?: { trx?: KyselyTransaction },
  ): Promise<Directory> {
    const db = dbOrTx(this.db, opts?.trx);

    let query = db
      .selectFrom('directories')
      .selectAll('directories')
      .where('workspaceId', '=', workspaceId);

    if (isValidUUID(directoryId)) {
      query = query.where('id', '=', directoryId);
    } else {
      query = query.where(
        sql`LOWER(slug)`,
        '=',
        sql`LOWER(${directoryId})`,
      );
    }

    return query.executeTakeFirst();
  }

  async slugExists(
    slug: string,
    spaceId: string,
    excludeId?: string,
  ): Promise<boolean> {
    let query = this.db
      .selectFrom('directories')
      .select((eb) => eb.fn.count('id').as('count'))
      .where(sql`LOWER(slug)`, '=', sql`LOWER(${slug})`)
      .where('spaceId', '=', spaceId);

    if (excludeId) {
      query = query.where('id', '!=', excludeId);
    }

    let { count } = await query.executeTakeFirst();
    count = count as number;
    return count != 0;
  }

  async insertDirectory(
    insertableDirectory: InsertableDirectory,
    trx?: KyselyTransaction,
  ): Promise<Directory> {
    const db = dbOrTx(this.db, trx);
    return db
      .insertInto('directories')
      .values(insertableDirectory)
      .returningAll()
      .executeTakeFirst();
  }

  async updateDirectory(
    updatableDirectory: UpdatableDirectory,
    directoryId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ) {
    const db = dbOrTx(this.db, trx);
    return db
      .updateTable('directories')
      .set({ ...updatableDirectory, updatedAt: new Date() })
      .where('id', '=', directoryId)
      .where('workspaceId', '=', workspaceId)
      .returningAll()
      .executeTakeFirst();
  }

  async getDirectoriesInSpace(
    spaceId: string,
    workspaceId: string,
    pagination: PaginationOptions,
  ) {
    let query = this.db
      .selectFrom('directories')
      .selectAll('directories')
      .where('spaceId', '=', spaceId)
      .where('workspaceId', '=', workspaceId);

    if (pagination.query) {
      query = query.where((eb) =>
        eb(
          sql`f_unaccent(name)`,
          'ilike',
          sql`f_unaccent(${'%' + pagination.query + '%'})`,
        ),
      );
    }

    return executeWithCursorPagination(query, {
      perPage: pagination.limit,
      cursor: pagination.cursor,
      beforeCursor: pagination.beforeCursor,
      fields: [{ expression: 'id', direction: 'asc' }],
      parseCursor: (cursor) => ({ id: cursor.id }),
    });
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
}
