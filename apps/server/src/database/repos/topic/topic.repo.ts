import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';
import {
  Topic,
  InsertableTopic,
  UpdatableTopic,
} from '@docmost/db/types/entity.types';
import { sql } from 'kysely';
import { PaginationOptions } from '../../pagination/pagination-options';
import { executeWithCursorPagination } from '@docmost/db/pagination/cursor-pagination';
import { validate as isValidUUID } from 'uuid';

@Injectable()
export class TopicRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async findById(
    topicId: string,
    workspaceId: string,
    opts?: { trx?: KyselyTransaction },
  ): Promise<Topic> {
    const db = dbOrTx(this.db, opts?.trx);

    let query = db
      .selectFrom('topics')
      .selectAll('topics')
      .where('workspaceId', '=', workspaceId);

    if (isValidUUID(topicId)) {
      query = query.where('id', '=', topicId);
    } else {
      query = query.where(
        sql`LOWER(slug)`,
        '=',
        sql`LOWER(${topicId})`,
      );
    }

    return query.executeTakeFirst();
  }

  async slugExists(
    slug: string,
    directoryId: string,
    excludeId?: string,
  ): Promise<boolean> {
    let query = this.db
      .selectFrom('topics')
      .select((eb) => eb.fn.count('id').as('count'))
      .where(sql`LOWER(slug)`, '=', sql`LOWER(${slug})`)
      .where('directoryId', '=', directoryId);

    if (excludeId) {
      query = query.where('id', '!=', excludeId);
    }

    let { count } = await query.executeTakeFirst();
    count = count as number;
    return count != 0;
  }

  async insertTopic(
    insertableTopic: InsertableTopic,
    trx?: KyselyTransaction,
  ): Promise<Topic> {
    const db = dbOrTx(this.db, trx);
    return db
      .insertInto('topics')
      .values(insertableTopic)
      .returningAll()
      .executeTakeFirst();
  }

  async updateTopic(
    updatableTopic: UpdatableTopic,
    topicId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ) {
    const db = dbOrTx(this.db, trx);
    return db
      .updateTable('topics')
      .set({ ...updatableTopic, updatedAt: new Date() })
      .where('id', '=', topicId)
      .where('workspaceId', '=', workspaceId)
      .returningAll()
      .executeTakeFirst();
  }

  async getTopicsInDirectory(
    directoryId: string,
    workspaceId: string,
    pagination: PaginationOptions,
  ) {
    let query = this.db
      .selectFrom('topics')
      .selectAll('topics')
      .where('directoryId', '=', directoryId)
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

  async deleteTopic(
    topicId: string,
    workspaceId: string,
  ): Promise<void> {
    await this.db
      .deleteFrom('topics')
      .where('id', '=', topicId)
      .where('workspaceId', '=', workspaceId)
      .execute();
  }
}
